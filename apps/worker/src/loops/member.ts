// F008 팀원 루프 (PRD 5장 F007/F008). 매 턴: guards → 지시 1개 처리 → 산출물 저장 → 보고.
// 턴은 runTurn으로만 실행한다 (CLAUDE.md 절대 규칙 1). LLM은 gateway로만 (규칙 2).
import type { AgentTemplate, ToolPermissions } from "@agentorg/shared/agents/templates";
import { writeAudit } from "@agentorg/shared/audit";
import type { AnyDb } from "@agentorg/shared/db";
import { type AgentStatus, agents, artifacts, messages } from "@agentorg/shared/db/schema";
import { type OrgEvent, publishOrgEvent } from "@agentorg/shared/events";
import { BudgetExceededError, callLLM, EmergencyStopError, MissingApiKeyError } from "@agentorg/shared/llm/gateway";
import { DEFAULT_MODELS } from "@agentorg/shared/llm/pricing";
import type { LLMProvider } from "@agentorg/shared/llm/provider";
import type { RunAgentJob } from "@agentorg/shared/queue";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { runTurn, type StopReason } from "../guards";
import { buildSystemPrompt } from "../prompts/system";

type Message = typeof messages.$inferSelect;
type Agent = typeof agents.$inferSelect;
type Publish = (orgId: string, event: OrgEvent) => Promise<void>;

export interface RunDeps {
  provider?: LLMProvider; // 테스트에서 가짜 제공사 주입
  publish?: Publish;
}

export interface RunResult {
  turns: number; // 처리를 마친 지시 수
  stopped?: StopReason;
}

const RANK_LABEL: Record<AgentTemplate["rank"], string> = { LEADER: "리더", MANAGER: "팀장", MEMBER: "팀원" };
const WEB_SEARCH_MAX_USES = 5;

/** 처리할 지시가 없거나 guards가 멈출 때까지 한 턴씩 처리한다. */
export async function runAgent(db: AnyDb, job: RunAgentJob, deps: RunDeps = {}): Promise<RunResult> {
  const publish = deps.publish ?? publishOrgEvent;
  let done = 0;

  for (let turn = 1; ; turn++) {
    let idle = false;
    let stopReason: StopReason | undefined;

    const decision = await runTurn(db, { ...job, turn }, async (d) => {
      // 사용자 메시지가 있으면 그것부터 (guards가 골라 준다)
      const msg = d.action === "USER_MESSAGES" ? d.messages[0] : await nextAgentDirective(db, job.agentId);
      if (!msg) {
        idle = true;
        return;
      }
      stopReason = await handleDirective(db, job, msg, deps.provider, publish);
      if (!stopReason) done++;
    });

    if (decision.action === "STOP") {
      await reportStopIfWaiting(db, job, decision.reason, publish);
      return { turns: done, stopped: decision.reason };
    }
    if (stopReason) return { turns: done, stopped: stopReason };
    if (idle) return { turns: done };
  }
}

/** 다른 에이전트(상사)가 보낸 미처리 지시 — 우선순위 높은 것, 오래된 것부터 */
async function nextAgentDirective(db: AnyDb, agentId: string): Promise<Message | undefined> {
  const [msg] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.receiverAgentId, agentId), eq(messages.type, "DIRECTIVE"), isNull(messages.readAt)))
    .orderBy(desc(messages.priority), asc(messages.createdAt))
    .limit(1);
  return msg;
}

/** 지시 1개 처리. 루프를 멈춰야 하면 그 이유를 반환한다. */
async function handleDirective(db: AnyDb, job: RunAgentJob, msg: Message, provider: LLMProvider | undefined, publish: Publish): Promise<StopReason | undefined> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, job.agentId));
  const perms = (agent.toolPermissions ?? {}) as ToolPermissions;
  await setStatus(db, agent, "WORKING", `지시 처리 시작: ${preview(msg.content)}`, publish);

  try {
    const r = await callLLM(
      db,
      {
        orgId: job.orgId,
        agentId: agent.id,
        missionId: msg.missionId,
        taskId: msg.taskId,
        actor: { type: "AGENT", id: agent.id },
        purpose: `지시 처리: ${preview(msg.content)}`,
        model: agent.modelPrimary ?? DEFAULT_MODELS.primary,
        economyModel: agent.modelEconomy ?? DEFAULT_MODELS.economy,
        system: systemPromptFor(agent, perms),
        messages: [{ role: "user", content: msg.content }],
        webSearchMaxUses: perms.web_search ? WEB_SEARCH_MAX_USES : undefined,
      },
      provider,
    );

    const text = r.text.trim();
    await db.transaction(async (tx) => {
      let artifactId: string | null = null;
      let title: string | null = null;
      if (perms.document && text) {
        title = titleOf(text);
        const [art] = await tx
          .insert(artifacts)
          .values({ orgId: job.orgId, missionId: msg.missionId, taskId: msg.taskId, agentId: agent.id, title, format: "markdown", content: text })
          .returning({ id: artifacts.id });
        artifactId = art.id;
        await writeAudit(tx, {
          orgId: job.orgId,
          actorType: "AGENT",
          actorId: agent.id,
          action: "artifact.create",
          targetType: "artifact",
          targetId: art.id,
          reasoning: `지시에 대한 결과물: ${title}`,
        });
      }
      const [rep] = await tx
        .insert(messages)
        .values({
          orgId: job.orgId,
          missionId: msg.missionId,
          taskId: msg.taskId,
          senderType: "AGENT",
          senderAgentId: agent.id,
          receiverAgentId: msg.senderType === "AGENT" ? msg.senderAgentId : null, // 사용자 지시면 사용자에게 보고
          type: "REPORT",
          content: artifactId ? `"${title}" 결과물을 만들었습니다.` : text || "(빈 응답)",
          payload: {
            directiveId: msg.id,
            artifactId,
            model: r.model,
            costKrw: Number(r.costKrw.toFixed(4)),
            webSearchRequests: r.webSearchRequests,
            economyMode: r.economyMode,
          },
        })
        .returning({ id: messages.id });
      await tx.update(messages).set({ readAt: new Date() }).where(eq(messages.id, msg.id));
      await writeAudit(tx, {
        orgId: job.orgId,
        actorType: "AGENT",
        actorId: agent.id,
        action: "message.report",
        targetType: "message",
        targetId: rep.id,
        reasoning: `지시 처리 완료 (${r.model}, ${r.costKrw.toFixed(2)}원)`,
        payload: { directiveId: msg.id, artifactId },
      });
    });
    await publish(job.orgId, { type: "message", agentId: agent.id });
    await setStatus(db, agent, "IDLE", "지시 처리 완료", publish);
    return undefined;
  } catch (e) {
    if (e instanceof EmergencyStopError) {
      // 지시는 읽지 않은 채로 둔다 → 사용자가 재개하면 이어서 처리
      await setStatus(db, agent, "IDLE", "긴급 정지로 작업 중단", publish);
      return "EMERGENCY_STOP";
    }
    if (e instanceof BudgetExceededError) {
      await report(db, job, agent, msg, `예산 한도(${e.limitName ?? "예산"})에 도달해 멈췄습니다. 승인 대기함에서 결정해 주세요.`, false, publish);
      await setStatus(db, agent, "BLOCKED", "예산 초과로 중단", publish);
      return "BUDGET";
    }
    if (e instanceof MissingApiKeyError) {
      await report(db, job, agent, msg, e.message, false, publish);
      await setStatus(db, agent, "BLOCKED", e.message, publish);
      return "AGENT_INACTIVE";
    }
    const reason = `처리에 실패했습니다: ${(e as Error).message ?? "알 수 없는 오류"}`;
    await report(db, job, agent, msg, reason, true, publish);
    await setStatus(db, agent, "IDLE", reason, publish);
    return undefined;
  }
}

function systemPromptFor(agent: Agent, perms: ToolPermissions): string {
  const skills = (agent.skills ?? []) as string[];
  const rules = [
    "지시를 처리해 결과물을 한국어 마크다운으로 작성한다. 첫 줄은 '# 제목'으로 시작한다.",
    "자료를 인용하면 출처(URL)를 함께 적는다. 모르는 것은 지어내지 않는다.",
    "지시가 불명확하면 합리적으로 가정해 진행하고, 맨 끝 '## 확인이 필요한 점'에 가정한 내용을 적는다.",
    perms.web_search
      ? "필요하면 웹 검색으로 최신 정보를 확인한다."
      : "웹 검색 권한이 없다. 알고 있는 지식으로만 작성하고, 최신 정보가 필요하면 그렇다고 밝힌다.",
  ];
  return buildSystemPrompt({
    name: agent.name,
    role: `${RANK_LABEL[agent.rank]}${skills.length ? ` (${skills.join(", ")})` : ""}`,
    personality: agent.personality,
    skills,
    instructions: rules.map((r) => `- ${r}`).join("\n"),
  });
}

/** 실패·중단을 사용자(또는 지시한 상사)에게 보고한다. markRead=false면 지시를 남겨 두어 나중에 다시 처리한다. */
async function report(db: AnyDb, job: RunAgentJob, agent: Agent, msg: Message, content: string, markRead: boolean, publish: Publish) {
  await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(messages)
      .values({
        orgId: job.orgId,
        missionId: msg.missionId,
        taskId: msg.taskId,
        senderType: "AGENT",
        senderAgentId: agent.id,
        receiverAgentId: msg.senderType === "AGENT" ? msg.senderAgentId : null,
        type: "REPORT",
        content,
        payload: { directiveId: msg.id, failed: true },
      })
      .returning({ id: messages.id });
    if (markRead) await tx.update(messages).set({ readAt: new Date() }).where(eq(messages.id, msg.id));
    await writeAudit(tx, {
      orgId: job.orgId,
      actorType: "AGENT",
      actorId: agent.id,
      action: "message.report_failure",
      targetType: "message",
      targetId: r.id,
      reasoning: content,
    });
  });
  await publish(job.orgId, { type: "message", agentId: agent.id });
}

/** 예산·턴 수로 멈췄는데 아직 지시가 남아 있으면 사용자에게 알린다 (PRD: "중단 + 상위 보고") */
async function reportStopIfWaiting(db: AnyDb, job: RunAgentJob, reason: StopReason, publish: Publish) {
  if (reason !== "BUDGET" && reason !== "MAX_TURNS") return;
  const [waiting] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.receiverAgentId, job.agentId), eq(messages.type, "DIRECTIVE"), isNull(messages.readAt)))
    .limit(1);
  if (!waiting) return;
  const [agent] = await db.select().from(agents).where(eq(agents.id, job.agentId));
  const text =
    reason === "BUDGET"
      ? "예산 한도에 도달해 남은 지시를 멈췄습니다."
      : `최대 턴 수(${agent.maxTurns})에 도달해 남은 지시를 멈췄습니다. 다시 지시하면 이어서 처리합니다.`;
  await report(db, job, agent, waiting, text, false, publish);
}

/** 상태 변경 + 감사 로그. 사용자가 작업 중에 '멈춤'을 눌렀다면 PAUSED를 덮어쓰지 않는다. */
async function setStatus(db: AnyDb, agent: Agent, status: AgentStatus, reasoning: string, publish: Publish) {
  const updated = await db
    .update(agents)
    .set({ status })
    .where(and(eq(agents.id, agent.id), ne(agents.status, "PAUSED")))
    .returning({ id: agents.id });
  if (updated.length === 0) return;
  await writeAudit(db, {
    orgId: agent.orgId,
    actorType: "AGENT",
    actorId: agent.id,
    action: "agent.status",
    targetType: "agent",
    targetId: agent.id,
    reasoning,
    payload: { to: status },
  });
  await publish(agent.orgId, { type: "agent", agentId: agent.id });
}

function titleOf(markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return (heading || markdown.split("\n")[0].trim() || "결과물").slice(0, 80);
}

function preview(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}
