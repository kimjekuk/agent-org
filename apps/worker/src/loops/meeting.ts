// F104 회의 — 참여자의 한 턴: 회의록을 보고 의견을 한 번 말한 뒤 다음 참여자에게, 마지막이면 리더에게 결론을 넘긴다.
// 회의 시작·결론은 leader.ts가 한다. 턴은 runAgent → runTurn(guards)으로 실행된다 (CLAUDE.md 절대 규칙 1).
import { stylePrompt } from "@agentorg/shared/agents/personality";
import { writeAudit } from "@agentorg/shared/audit";
import type { AnyDb } from "@agentorg/shared/db";
import { agents, artifacts, meetings, meetingTurns, messages, tasks } from "@agentorg/shared/db/schema";
import { BudgetExceededError, callLLM, EmergencyStopError, MissionCallLimitError } from "@agentorg/shared/llm/gateway";
import { DEFAULT_MODELS } from "@agentorg/shared/llm/pricing";
import { MEETING_LABEL } from "@agentorg/shared/meetings";
import type { MissionMessagePayload } from "@agentorg/shared/missions";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { StopReason } from "../guards";
import { buildSystemPrompt } from "../prompts/system";
import { type Agent, clip, type Deps, type Message, type Mission, missionBrief, preview, setStatus, agentLanguage } from "./common";

export type Meeting = typeof meetings.$inferSelect;

const MEETING_PRIORITY = 50; // 미션 Task와 같게

const ASK: Record<Meeting["kind"], string> = {
  KICKOFF: "킥오프 회의다. 계획에서 내가 맡은 Task를 어떻게 할지, 걱정되는 점이나 앞뒤 담당과 맞춰야 할 점을 말하라.",
  RETRO: "회고 회의다. 이 미션에서 잘된 점, 아쉬운 점, 다음에 바꿀 점을 내가 맡은 일을 중심으로 말하라.",
};

/** 회의 안건과 지금까지의 발언 (참여자 의견·리더 결론에 함께 쓴다) */
export async function meetingTranscript(db: AnyDb, mission: Mission, meeting: Meeting): Promise<string> {
  const list = await db.select().from(tasks).where(eq(tasks.missionId, mission.id)).orderBy(asc(tasks.order), asc(tasks.createdAt));
  const people = await db.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.orgId, mission.orgId));
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? "(없음)";
  const turns = await db.select().from(meetingTurns).where(eq(meetingTurns.meetingId, meeting.id)).orderBy(asc(meetingTurns.createdAt));

  const parts = [missionBrief(mission), `# 계획 (Task 순서·담당)\n${list.map((t, i) => `${i + 1}. ${t.title} — ${nameOf(t.assigneeId)}${t.description ? `: ${clip(t.description, 300)}` : ""}`).join("\n")}`];
  if (meeting.kind === "RETRO") {
    const [final] = await db
      .select({ content: artifacts.content })
      .from(artifacts)
      .where(and(eq(artifacts.missionId, mission.id), isNull(artifacts.taskId)))
      .orderBy(desc(artifacts.version))
      .limit(1);
    if (final) parts.push(`# 최종 결과 (앞부분)\n${clip(final.content, 3000)}`);
  }
  parts.push(
    `# ${MEETING_LABEL[meeting.kind]} 발언`,
    turns.length ? turns.map((t) => `- ${t.speakerType === "USER" ? "사용자 (최우선으로 반영)" : nameOf(t.agentId)}: ${clip(t.content, 1500)}`).join("\n") : "(아직 발언 없음)",
  );
  return parts.join("\n\n");
}

/** 참여자의 회의 한 턴. 멈춰야 하면 그 이유를 반환한다 (메시지는 읽지 않은 채로 남아 나중에 이어서) */
export async function handleMeetingTurn(db: AnyDb, agent: Agent, mission: Mission, msg: Message, deps: Deps): Promise<StopReason | undefined> {
  const meetingId = (msg.payload as MissionMessagePayload).meetingId;
  const [meeting] = meetingId ? await db.select().from(meetings).where(eq(meetings.id, meetingId)) : [];
  if (!meeting || meeting.status !== "RUNNING" || mission.status === "CANCELLED") {
    await db.update(messages).set({ readAt: new Date() }).where(eq(messages.id, msg.id));
    return undefined;
  }
  const label = MEETING_LABEL[meeting.kind];
  await setStatus(db, agent, "WORKING", `미션 "${preview(mission.title)}" — ${label} 참석`, deps.publish);

  let content: string;
  let cost: { costKrw: number; model: string } | null = null;
  try {
    const skills = (agent.skills ?? []) as string[];
    const r = await callLLM(
      db,
      {
        orgId: mission.orgId,
        agentId: agent.id,
        missionId: mission.id,
        actor: { type: "AGENT", id: agent.id },
        purpose: `미션 "${preview(mission.title)}": ${label} 의견`,
        model: agent.modelPrimary ?? DEFAULT_MODELS.primary,
        economyModel: agent.modelEconomy ?? DEFAULT_MODELS.economy,
        system: buildSystemPrompt({
          name: agent.name,
          role: `팀원${skills.length ? ` (${skills.join(", ")})` : ""}`,
          personality: agent.personality,
          style: stylePrompt(agent),
          language: await agentLanguage(db, agent),
          skills,
          instructions: "- 회의에서 내 차례에 3~5문장으로 짧게 말한다. 앞 사람 말을 되풀이하지 않고, 사용자 답글이 있으면 먼저 반영한다.\n- 제목·목록 없이 말하듯 쓴다. 모르는 것은 지어내지 않는다.",
        }),
        messages: [{ role: "user", content: `${await meetingTranscript(db, mission, meeting)}\n\n# 내 차례 (${agent.name})\n${ASK[meeting.kind]}` }],
        maxTokens: 800,
      },
      deps.provider,
    );
    content = r.text.trim() || "(의견 없음)";
    cost = { costKrw: r.costKrw, model: r.model };
  } catch (e) {
    if (e instanceof EmergencyStopError) {
      await setStatus(db, agent, "IDLE", "긴급 정지로 작업 중단", deps.publish);
      return "EMERGENCY_STOP";
    }
    if (e instanceof BudgetExceededError) {
      await setStatus(db, agent, "BLOCKED", "예산 초과로 중단", deps.publish);
      return "BUDGET";
    }
    if (e instanceof MissionCallLimitError) {
      await setStatus(db, agent, "BLOCKED", "미션 AI 호출 상한 — 승인 대기", deps.publish);
      return "CALL_LIMIT";
    }
    // 회의 때문에 미션이 멈추지 않게: 실패를 회의록에 남기고 다음 사람에게 넘긴다
    content = `(의견을 내지 못했습니다: ${(e as Error).message ?? "알 수 없는 오류"})`;
  }

  const participants = (meeting.participants ?? []) as string[];
  const next = await nextSpeaker(db, participants, agent.id);
  await db.transaction(async (tx) => {
    await tx.insert(meetingTurns).values({ meetingId: meeting.id, speakerType: "AGENT", agentId: agent.id, content });
    await tx.update(messages).set({ readAt: new Date() }).where(eq(messages.id, msg.id));
    await writeAudit(tx, {
      orgId: mission.orgId,
      actorType: "AGENT",
      actorId: agent.id,
      action: "meeting.turn",
      targetType: "meeting",
      targetId: meeting.id,
      reasoning: `${label}: ${preview(content)}${cost ? ` (${cost.model}, ${cost.costKrw.toFixed(2)}원)` : ""}`,
    });
    const payload: MissionMessagePayload = { kind: next ? "MEETING" : "MEETING_WRAP", meetingId: meeting.id };
    await tx.insert(messages).values({
      orgId: mission.orgId,
      missionId: mission.id,
      senderType: "AGENT",
      senderAgentId: agent.id,
      receiverAgentId: next ?? mission.leaderId,
      type: "DIRECTIVE",
      content: next ? `${label}에서 의견을 말해 주세요.` : `${label} 발언이 모두 끝났습니다. 결론을 정리해 주세요.`,
      payload,
      priority: MEETING_PRIORITY,
    });
  });
  const receiver = next ?? mission.leaderId;
  if (receiver && receiver !== agent.id) await deps.enqueue({ orgId: mission.orgId, agentId: receiver });
  await deps.publish(mission.orgId, { type: "mission", missionId: mission.id });
  await setStatus(db, agent, "IDLE", `${label} 발언 완료`, deps.publish);
  return undefined;
}

/** 내 다음 발언자 (해고·비활성 참여자는 건너뛴다). 없으면 null → 리더가 결론 */
async function nextSpeaker(db: AnyDb, participants: string[], me: string): Promise<string | null> {
  const at = participants.indexOf(me);
  const rest = at < 0 ? [] : participants.slice(at + 1);
  if (rest.length === 0) return null;
  const active = await db.select({ id: agents.id }).from(agents).where(and(inArray(agents.id, rest), eq(agents.isActive, true)));
  return rest.find((id) => active.some((a) => a.id === id)) ?? null;
}

/** 진행 중인 킥오프가 있으면 Task 진행을 기다린다 */
export async function kickoffRunning(db: AnyDb, missionId: string): Promise<boolean> {
  const [m] = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(and(eq(meetings.missionId, missionId), eq(meetings.kind, "KICKOFF"), eq(meetings.status, "RUNNING")))
    .limit(1);
  return Boolean(m);
}
