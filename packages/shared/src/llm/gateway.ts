// 모든 LLM 호출의 단일 진입점 (CLAUDE.md 절대 규칙 2, PRD 9장 "비용").
// 순서: 긴급 정지 확인 → 예산 확인(80% 절약 모델, 100% 중단) → 키 복호화 → 호출 → CostLog·AuditLog 기록
import { and, eq } from "drizzle-orm";
import { writeAudit } from "../audit";
import { checkBudget } from "../budget";
import { decryptSecret } from "../crypto";
import type { AnyDb } from "../db/client";
import { apiKeys, approvalRequests, costLogs, organizations } from "../db/schema";
import { anthropicProvider } from "./anthropic";
import { assertKnownModel, costKrw } from "./pricing";
import type { LLMMessage, LLMProvider } from "./provider";

export class EmergencyStopError extends Error {
  constructor() {
    super("긴급 정지 중입니다. 사용자가 재개할 때까지 LLM을 호출하지 않습니다");
    this.name = "EmergencyStopError";
  }
}

export class BudgetExceededError extends Error {
  constructor(public limitName: string | null) {
    super(`예산 한도(${limitName ?? "알 수 없음"})를 넘어 자동 중단했습니다. 승인 대기함에서 결정해 주세요`);
    this.name = "BudgetExceededError";
  }
}

export class MissingApiKeyError extends Error {
  constructor(provider: string) {
    super(`${provider} API 키가 등록되지 않았습니다 (설정 → API 키)`);
    this.name = "MissingApiKeyError";
  }
}

export interface GatewayCall {
  orgId: string;
  agentId?: string | null;
  missionId?: string | null;
  taskId?: string | null;
  /** 행동 주체 (AuditLog). 에이전트가 부르면 AGENT, 사용자 화면의 시험 호출은 USER */
  actor: { type: "USER" | "AGENT" | "SYSTEM"; id?: string | null };
  /** 감사 로그에 남길 호출 목적 */
  purpose: string;
  model: string;
  /** 예산 80% 이상일 때 대신 쓸 절약 모델 */
  economyModel?: string | null;
  system?: string;
  messages: LLMMessage[];
  maxTokens?: number;
}

export interface GatewayResult {
  text: string;
  model: string;
  stopReason: string | null;
  costKrw: number;
  economyMode: boolean;
}

const providers: Record<string, LLMProvider> = { anthropic: anthropicProvider };

export async function callLLM(db: AnyDb, call: GatewayCall, provider: LLMProvider = providers.anthropic): Promise<GatewayResult> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, call.orgId));
  if (!org) throw new Error("조직을 찾을 수 없습니다");
  if (org.emergencyStop) throw new EmergencyStopError();

  const budget = await checkBudget(db, call);
  if (budget.level === "STOP") {
    await requestBudgetApproval(db, call, budget.limitName);
    throw new BudgetExceededError(budget.limitName);
  }
  const economyMode = budget.level === "ECONOMY" && Boolean(call.economyModel);
  const model = economyMode ? call.economyModel! : call.model;
  assertKnownModel(model);

  // API 키는 조직 소유자의 것을 쓴다 (PRD 2장: 사용자 본인 API 키)
  const [key] = await db
    .select({ encryptedKey: apiKeys.encryptedKey })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, org.ownerId), eq(apiKeys.provider, provider.name)));
  if (!key) throw new MissingApiKeyError(provider.name);

  const result = await provider.complete(decryptSecret(key.encryptedKey), {
    model,
    system: call.system,
    messages: call.messages,
    maxTokens: call.maxTokens ?? 16000,
  });
  const cost = costKrw(result.usage);

  await db.transaction(async (tx) => {
    const inputTokens = result.usage.reduce((s, u) => s + u.inputTokens + u.cacheWriteTokens + u.cacheReadTokens, 0);
    const outputTokens = result.usage.reduce((s, u) => s + u.outputTokens, 0);
    const [log] = await tx
      .insert(costLogs)
      .values({
        orgId: call.orgId,
        agentId: call.agentId ?? null,
        missionId: call.missionId ?? null,
        taskId: call.taskId ?? null,
        provider: provider.name,
        model: result.model,
        inputTokens,
        outputTokens,
        cost: cost.toFixed(4),
      })
      .returning({ id: costLogs.id });
    await writeAudit(tx, {
      orgId: call.orgId,
      actorType: call.actor.type,
      actorId: call.actor.id ?? null,
      action: "llm.call",
      targetType: "cost_log",
      targetId: log.id,
      reasoning: call.purpose,
      payload: {
        requestedModel: call.model,
        model: result.model,
        economyMode,
        budgetRatio: Number(budget.ratio.toFixed(4)),
        inputTokens,
        outputTokens,
        costKrw: Number(cost.toFixed(4)),
        stopReason: result.stopReason,
      },
    });
  });

  return { text: result.text, model: result.model, stopReason: result.stopReason, costKrw: cost, economyMode };
}

/** 예산 초과 시 사용자 결정을 요청한다. 같은 조직에 대기 중인 BUDGET 요청이 있으면 새로 만들지 않는다. */
async function requestBudgetApproval(db: AnyDb, call: GatewayCall, limitName: string | null) {
  await db.transaction(async (tx) => {
    const [pending] = await tx
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(and(eq(approvalRequests.orgId, call.orgId), eq(approvalRequests.type, "BUDGET"), eq(approvalRequests.status, "PENDING")));
    if (pending) return;
    const [req] = await tx
      .insert(approvalRequests)
      .values({
        orgId: call.orgId,
        agentId: call.agentId ?? null,
        missionId: call.missionId ?? null,
        type: "BUDGET",
        content: `${limitName ?? "예산"}을 모두 사용해 자동 중단했습니다. 한도를 늘리거나 작업을 멈춰 주세요.`,
      })
      .returning({ id: approvalRequests.id });
    await writeAudit(tx, {
      orgId: call.orgId,
      actorType: "SYSTEM",
      action: "budget.exceeded",
      targetType: "approval_request",
      targetId: req.id,
      reasoning: `${limitName} 100% 도달 — LLM 호출 차단`,
    });
  });
}
