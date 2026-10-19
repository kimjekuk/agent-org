// F107 QA 담당의 한 턴: 리더가 맡긴 Task 결과를 검토해 통과·반려를 리더에게 돌려준다 (반영은 리더가 한다).
// 턴은 runAgent → runTurn(guards)으로 실행된다 (CLAUDE.md 절대 규칙 1). LLM은 gateway로만 (규칙 2).
import { personalityPrompt } from "@agentorg/shared/agents/personality";
import { writeAudit } from "@agentorg/shared/audit";
import type { AnyDb } from "@agentorg/shared/db";
import { messages, tasks } from "@agentorg/shared/db/schema";
import { BudgetExceededError, callLLM, EmergencyStopError, MissionCallLimitError } from "@agentorg/shared/llm/gateway";
import { DEFAULT_MODELS } from "@agentorg/shared/llm/pricing";
import type { MissionMessagePayload } from "@agentorg/shared/missions";
import { eq } from "drizzle-orm";
import type { StopReason } from "../guards";
import { buildSystemPrompt } from "../prompts/system";
import { type Agent, type Deps, type Message, type Mission, preview, setStatus } from "./common";
import { parseJsonObject } from "./leader";

const QA_PRIORITY = 50; // 미션 Task와 같게

export async function handleQaReview(db: AnyDb, agent: Agent, mission: Mission, msg: Message, deps: Deps): Promise<StopReason | undefined> {
  const [task] = msg.taskId ? await db.select().from(tasks).where(eq(tasks.id, msg.taskId)) : [];
  if (!task || task.status !== "REVIEW" || mission.status === "CANCELLED" || !mission.leaderId) {
    await db.update(messages).set({ readAt: new Date() }).where(eq(messages.id, msg.id));
    return undefined;
  }
  await setStatus(db, agent, "WORKING", `"${preview(task.title)}" 품질 검토`, deps.publish);

  let result: MissionMessagePayload;
  try {
    const skills = (agent.skills ?? []) as string[];
    const r = await callLLM(
      db,
      {
        orgId: mission.orgId,
        agentId: agent.id,
        missionId: mission.id,
        taskId: task.id,
        actor: { type: "AGENT", id: agent.id },
        purpose: `미션 "${preview(mission.title)}": "${preview(task.title)}" QA 검토`,
        model: agent.modelPrimary ?? DEFAULT_MODELS.primary,
        economyModel: agent.modelEconomy ?? DEFAULT_MODELS.economy,
        system: buildSystemPrompt({
          name: agent.name,
          role: `품질 검토 담당 (QA)${skills.length ? ` (${skills.join(", ")})` : ""}`,
          personality: agent.personality,
          style: personalityPrompt(agent.personalityType),
          skills,
          instructions: "- 팀원의 Task 결과를 미션 기준으로 검토한다. 빠진 내용·틀린 사실·근거 없는 주장을 찾는다.\n- 요청한 JSON 형식을 정확히 지킨다. 모르는 것은 지어내지 않는다.",
        }),
        messages: [{ role: "user", content: msg.content }],
        maxTokens: 1500,
      },
      deps.provider,
    );
    const verdict = parseJsonObject<{ pass?: boolean; feedback?: string }>(r.text);
    // 답을 읽지 못하면 리더가 직접 검토한다
    result = verdict
      ? { kind: "QA_RESULT", pass: verdict.pass !== false, feedback: String(verdict.feedback ?? "").slice(0, 2000), costKrw: Number(r.costKrw.toFixed(4)), model: r.model }
      : { kind: "QA_RESULT", qaFailed: true, feedback: "QA 검토 결과(JSON)를 읽지 못했습니다" };
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
    // QA 때문에 미션이 멈추지 않게: 리더가 직접 검토한다
    result = { kind: "QA_RESULT", qaFailed: true, feedback: `QA 검토 실패: ${(e as Error).message ?? "알 수 없는 오류"}` };
  }

  await db.transaction(async (tx) => {
    await tx.insert(messages).values({
      orgId: mission.orgId,
      missionId: mission.id,
      taskId: task.id,
      senderType: "AGENT",
      senderAgentId: agent.id,
      receiverAgentId: mission.leaderId,
      type: "DIRECTIVE",
      content: result.qaFailed ? `${result.feedback} — 리더가 직접 검토해 주세요.` : `QA 검토 ${result.pass ? "통과" : "반려"}: ${result.feedback || "좋습니다"}`,
      payload: result,
      priority: QA_PRIORITY,
    });
    await tx.update(messages).set({ readAt: new Date() }).where(eq(messages.id, msg.id));
    await writeAudit(tx, {
      orgId: mission.orgId,
      actorType: "AGENT",
      actorId: agent.id,
      action: "task.qa_review",
      targetType: "task",
      targetId: task.id,
      reasoning: result.qaFailed ? (result.feedback ?? "QA 검토 실패") : `${result.pass ? "통과" : "반려"}: ${preview(result.feedback ?? "")}`,
    });
  });
  await deps.enqueue({ orgId: mission.orgId, agentId: mission.leaderId });
  await deps.publish(mission.orgId, { type: "mission", missionId: mission.id });
  await setStatus(db, agent, "IDLE", `"${preview(task.title)}" 품질 검토 완료`, deps.publish);
  return undefined;
}
