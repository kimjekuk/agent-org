// 에이전트 루프 매 턴 시작 공통 체크 (CLAUDE.md 절대 규칙 1, PRD 5장 F007/F008 "팀원 루프")
// 순서: 긴급 정지 → 사용자 메시지 우선 → 예산 → 턴 수
import { writeAudit } from "@agentorg/shared/audit";
import { checkBudget } from "@agentorg/shared/budget";
import type { AnyDb } from "@agentorg/shared/db";
import { agents, messages, organizations } from "@agentorg/shared/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";

export interface TurnContext {
  orgId: string;
  agentId: string;
  missionId?: string | null;
  /** 이번 턴 번호 (1부터) */
  turn: number;
}

/** CALL_LIMIT: 미션 AI 호출 상한 도달 (F109, gateway가 판단) */
export type StopReason = "EMERGENCY_STOP" | "AGENT_INACTIVE" | "AGENT_PAUSED" | "BUDGET" | "MAX_TURNS" | "CALL_LIMIT";

export type GuardDecision =
  | { action: "STOP"; reason: StopReason; detail?: string }
  /** 사용자 메시지가 있으면 다른 일보다 먼저 처리한다 */
  | { action: "USER_MESSAGES"; messages: (typeof messages.$inferSelect)[]; economyMode: boolean }
  | { action: "CONTINUE"; economyMode: boolean };

export async function checkTurn(db: AnyDb, ctx: TurnContext): Promise<GuardDecision> {
  // 1. 긴급 정지 — 다른 어떤 것보다 먼저
  const [org] = await db.select({ emergencyStop: organizations.emergencyStop }).from(organizations).where(eq(organizations.id, ctx.orgId));
  if (!org || org.emergencyStop) return { action: "STOP", reason: "EMERGENCY_STOP" };

  const [agent] = await db
    .select({ isActive: agents.isActive, status: agents.status, maxTurns: agents.maxTurns })
    .from(agents)
    .where(and(eq(agents.id, ctx.agentId), eq(agents.orgId, ctx.orgId)));
  if (!agent || !agent.isActive) return { action: "STOP", reason: "AGENT_INACTIVE" };
  if (agent.status === "PAUSED") return { action: "STOP", reason: "AGENT_PAUSED" }; // 사용자가 이 에이전트만 멈춤

  // 3. 예산 (사용자 메시지 처리도 LLM을 쓰므로 먼저 계산해 둔다)
  const budget = await checkBudget(db, { orgId: ctx.orgId, agentId: ctx.agentId, missionId: ctx.missionId });
  if (budget.level === "STOP") return { action: "STOP", reason: "BUDGET", detail: budget.limitName ?? undefined };
  const economyMode = budget.level === "ECONOMY";

  // 2. 사용자 메시지 우선 (sender_type = USER, 아직 읽지 않음)
  const pending = await db
    .select()
    .from(messages)
    .where(and(eq(messages.receiverAgentId, ctx.agentId), eq(messages.senderType, "USER"), isNull(messages.readAt)))
    .orderBy(asc(messages.createdAt));
  if (pending.length > 0) return { action: "USER_MESSAGES", messages: pending, economyMode };

  // 4. 턴 수
  if (ctx.turn > agent.maxTurns) return { action: "STOP", reason: "MAX_TURNS", detail: `${agent.maxTurns}턴 초과` };

  return { action: "CONTINUE", economyMode };
}

/**
 * 에이전트 루프의 한 턴. 모든 루프는 이 함수로만 턴을 실행한다 — 가드를 건너뛸 수 없다.
 * 멈출 때는 이유를 AuditLog에 남기고 step을 실행하지 않는다.
 */
export async function runTurn(
  db: AnyDb,
  ctx: TurnContext,
  step: (decision: Exclude<GuardDecision, { action: "STOP" }>) => Promise<void>,
): Promise<GuardDecision> {
  const decision = await checkTurn(db, ctx);
  if (decision.action === "STOP") {
    await writeAudit(db, {
      orgId: ctx.orgId,
      actorType: "SYSTEM",
      action: "agent.turn_stopped",
      targetType: "agent",
      targetId: ctx.agentId,
      reasoning: decision.detail ? `${decision.reason}: ${decision.detail}` : decision.reason,
      payload: { turn: ctx.turn, missionId: ctx.missionId ?? null },
    });
    return decision;
  }
  await step(decision);
  return decision;
}
