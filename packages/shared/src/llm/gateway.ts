// 모든 LLM 호출의 단일 진입점 (CLAUDE.md 절대 규칙 2, PRD 9장 "비용").
// 순서: 긴급 정지 확인 → 예산 확인(80% 절약 모델, 100% 중단) → 미션 호출 상한(F109) → 키 복호화 → 호출(장애면 대체 모델, F109) → CostLog·AuditLog 기록
import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { writeAudit } from "../audit";
import { checkBudget } from "../budget";
import { decryptSecret } from "../crypto";
import type { AnyDb } from "../db/client";
import { apiKeys, approvalRequests, auditLogs, costLogs, missions, organizations } from "../db/schema";
import { type ApprovalPayload, CALL_LIMIT_STEP } from "../missions";
import { notifyOrgOwner } from "../push";
import { anthropicProvider } from "./anthropic";
import { PROVIDER_LABEL, type ProviderName, type ResolvedModel, resolveModel, UnknownModelError } from "./models";
import { createOpenAICompatibleProvider, OPENAI_COMPATIBLE } from "./openaiCompatible";
import { costKrw } from "./pricing";
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
    super(`${PROVIDER_LABEL[provider as ProviderName] ?? provider} API 키가 등록되지 않았습니다 (설정 → API 키)`);
    this.name = "MissingApiKeyError";
  }
}

export class MissionCallLimitError extends Error {
  constructor(public limit: number) {
    super(`이 미션의 AI 호출이 상한(${limit}회)에 도달해 멈췄습니다. 승인 대기함에서 계속할지 정해 주세요`);
    this.name = "MissionCallLimitError";
  }
}

/** 잠시 뒤 다시 하면 될 수 있는 제공사 장애인가 (과부하·서버 오류·시간 초과·연결 실패). 키 오류(401) 등은 아니다 */
export function isTransientError(e: unknown): boolean {
  const err = e as { status?: unknown; name?: unknown; message?: unknown } | null;
  if (typeof err?.status === "number") return err.status === 408 || err.status === 409 || err.status === 429 || err.status >= 500;
  const name = String(err?.name ?? "");
  if (["APIConnectionError", "APIConnectionTimeoutError", "TimeoutError", "AbortError"].includes(name)) return true;
  return e instanceof TypeError && /fetch failed|network|socket/i.test(String(err?.message ?? ""));
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
  /** 웹 검색 허용 횟수 (에이전트 도구 권한이 있을 때만 넘긴다) */
  webSearchMaxUses?: number;
  /** F110 코드 실행 도구 (에이전트 도구 권한이 있을 때만 넘긴다) */
  codeExecution?: boolean;
  /** 대체 모델을 쓰지 않는다 (설정 화면의 연결 테스트: 그 제공사가 되는지 확인해야 하므로) */
  noFallback?: boolean;
}

export interface GatewayResult {
  text: string;
  model: string;
  stopReason: string | null;
  costKrw: number;
  economyMode: boolean;
  webSearchRequests: number;
  /** F110 실행된 코드 실행 횟수 */
  codeExecutions: number;
  /** 장애로 대체 모델을 썼으면 원래 모델 (F109) */
  fallbackFrom?: string;
}

// 제공사는 모델로 정해진다 (Claude → anthropic, 그 외 → DB llm_models의 provider)
const providers: Record<string, LLMProvider> = {
  anthropic: anthropicProvider,
  openai: createOpenAICompatibleProvider(OPENAI_COMPATIBLE.openai),
  gemini: createOpenAICompatibleProvider(OPENAI_COMPATIBLE.gemini),
  deepseek: createOpenAICompatibleProvider(OPENAI_COMPATIBLE.deepseek),
};

/** override: 테스트용 가짜 제공사. 없으면 모델에 맞는 제공사를 쓴다 */
export async function callLLM(db: AnyDb, call: GatewayCall, override?: LLMProvider): Promise<GatewayResult> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, call.orgId));
  if (!org) throw new Error("조직을 찾을 수 없습니다");
  if (org.emergencyStop) throw new EmergencyStopError();

  const budget = await checkBudget(db, call);
  if (budget.level === "STOP") {
    await requestBudgetApproval(db, call, budget.limitName);
    throw new BudgetExceededError(budget.limitName);
  }
  if (budget.level === "WARN" || budget.level === "ECONOMY") await warnBudgetOnce(db, call, budget.ratio, budget.limitName);
  const economyMode = budget.level === "ECONOMY" && Boolean(call.economyModel);
  const requested = economyMode ? call.economyModel! : call.model;
  if (call.missionId) await checkMissionCallLimit(db, call);

  let model = requested;
  let fallbackFrom: string | undefined;
  let attempt: Attempt;
  try {
    attempt = await callModel(db, org.ownerId, call, requested, override);
  } catch (e) {
    // F109: 제공사 장애면 설정의 대체 모델로 한 번 더 (키가 없거나 대체 모델이 같으면 원래 오류)
    const fallback = org.fallbackModel?.trim();
    if (!fallback || fallback === requested || call.noFallback || !isTransientError(e)) throw e;
    try {
      attempt = await callModel(db, org.ownerId, call, fallback, override);
    } catch (e2) {
      if (e2 instanceof MissingApiKeyError || e2 instanceof UnknownModelError) throw e; // 대체 모델을 쓸 수 없으면 원래 장애를 알린다
      throw e2;
    }
    model = fallback;
    fallbackFrom = requested;
    await writeAudit(db, {
      orgId: call.orgId,
      actorType: "SYSTEM",
      action: "llm.fallback",
      targetType: "organization",
      targetId: call.orgId,
      reasoning: `${requested} 장애로 대체 모델 ${fallback} 사용: ${String((e as Error).message ?? e).slice(0, 200)}`,
      payload: { requestedModel: requested, fallbackModel: fallback, agentId: call.agentId ?? null, missionId: call.missionId ?? null },
    });
  }
  const { result, resolved, provider } = attempt;
  const cost = costKrw(result.usage, undefined, result.webSearchRequests, resolved.price ? { [model]: resolved.price } : {});

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
        fallbackFrom: fallbackFrom ?? null,
        budgetRatio: Number(budget.ratio.toFixed(4)),
        inputTokens,
        outputTokens,
        costKrw: Number(cost.toFixed(4)),
        webSearchRequests: result.webSearchRequests,
        codeExecutions: result.codeExecutions ?? 0,
        stopReason: result.stopReason,
      },
    });
  });

  return {
    text: result.text,
    model: result.model,
    stopReason: result.stopReason,
    costKrw: cost,
    economyMode,
    webSearchRequests: result.webSearchRequests,
    codeExecutions: result.codeExecutions ?? 0,
    ...(fallbackFrom ? { fallbackFrom } : {}),
  };
}

interface Attempt {
  result: Awaited<ReturnType<LLMProvider["complete"]>>;
  resolved: ResolvedModel;
  provider: LLMProvider;
}

/** 모델 하나로 호출: 제공사 찾기 → 조직 소유자의 키 → 호출 */
async function callModel(db: AnyDb, ownerId: string, call: GatewayCall, model: string, override?: LLMProvider): Promise<Attempt> {
  const resolved = await resolveModel(db, model); // 요금표에 없거나 꺼진 모델이면 여기서 멈춘다
  const provider = override ?? providers[resolved.provider];

  // API 키는 조직 소유자의 것을 쓴다 (PRD 2장: 사용자 본인 API 키)
  const [key] = await db
    .select({ encryptedKey: apiKeys.encryptedKey })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, ownerId), eq(apiKeys.provider, provider.name)));
  if (!key) throw new MissingApiKeyError(provider.name);

  const result = await provider.complete(decryptSecret(key.encryptedKey), {
    model,
    system: call.system,
    messages: call.messages,
    maxTokens: call.maxTokens ?? 16000,
    webSearchMaxUses: call.webSearchMaxUses,
    codeExecution: call.codeExecution,
  });
  return { result, resolved, provider };
}

/**
 * F109 무한 반복 차단: 미션의 AI 호출 수가 상한에 닿으면 사용자에게 계속할지 묻고 멈춘다.
 * 같은 미션에 대기 중인 질문이 있으면 새로 만들지 않는다. 승인하면 리더가 상한을 늘린다.
 */
async function checkMissionCallLimit(db: AnyDb, call: GatewayCall) {
  const [mission] = await db.select({ callLimit: missions.callLimit, title: missions.title, leaderId: missions.leaderId }).from(missions).where(eq(missions.id, call.missionId!));
  if (!mission) return;
  const [{ n }] = await db.select({ n: count() }).from(costLogs).where(eq(costLogs.missionId, call.missionId!));
  if (n < mission.callLimit) return;

  const reqId = await db.transaction(async (tx) => {
    const [pending] = await tx
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.missionId, call.missionId!),
          inArray(approvalRequests.status, ["PENDING", "HELD"]),
          sql`${approvalRequests.payload}->>'reason' = 'CALL_LIMIT'`,
        ),
      );
    if (pending) return null;
    const payload: ApprovalPayload = { reason: "CALL_LIMIT" };
    const [req] = await tx
      .insert(approvalRequests)
      .values({
        orgId: call.orgId,
        agentId: mission.leaderId ?? call.agentId ?? null,
        missionId: call.missionId!,
        type: "QUESTION",
        content: `미션 "${mission.title}"의 AI 호출이 ${n}회로 상한(${mission.callLimit}회)에 도달해 멈췄습니다. 같은 일을 되풀이하고 있을 수 있습니다.\n\n승인 = ${CALL_LIMIT_STEP}회 더 진행 / 거절 = 미션 일시정지`,
        payload,
      })
      .returning({ id: approvalRequests.id });
    await writeAudit(tx, {
      orgId: call.orgId,
      actorType: "SYSTEM",
      action: "mission.call_limit",
      targetType: "approval_request",
      targetId: req.id,
      reasoning: `AI 호출 ${n}회 / 상한 ${mission.callLimit}회 — 호출 차단`,
      payload: { missionId: call.missionId },
    });
    return req.id;
  });
  if (reqId) await notifyOrgOwner(db, call.orgId, { title: "✋ 미션이 멈췄습니다", body: `${mission.title} — AI 호출 상한 도달. 계속할지 정해 주세요`.slice(0, 120), url: `/approvals/${reqId}`, tag: `approval-${reqId}` });
  throw new MissionCallLimitError(mission.callLimit);
}

/** 예산 70% 경고 (PRD F013) — 조직당 하루 한 번 감사 로그 + 웹 푸시 (F017) */
async function warnBudgetOnce(db: AnyDb, call: GatewayCall, ratio: number, limitName: string | null) {
  const startOfToday = sql`(date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`;
  const [warned] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.orgId, call.orgId), eq(auditLogs.action, "budget.warn"), gte(auditLogs.createdAt, startOfToday)))
    .limit(1);
  if (warned) return;
  const pct = Math.round(ratio * 100);
  await writeAudit(db, {
    orgId: call.orgId,
    actorType: "SYSTEM",
    action: "budget.warn",
    targetType: "organization",
    targetId: call.orgId,
    reasoning: `${limitName ?? "예산"} ${pct}% 사용 — 80%부터 절약 모델, 100%에서 중단`,
  });
  await notifyOrgOwner(db, call.orgId, { title: "⚠️ 예산 경고", body: `${limitName ?? "예산"}의 ${pct}%를 썼습니다`, url: "/dashboard", tag: "budget-warn" });
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
    return req.id;
  }).then(async (reqId) => {
    if (reqId) await notifyOrgOwner(db, call.orgId, { title: "⛔ 예산 한도 도달", body: `${limitName ?? "예산"}을 모두 써서 멈췄습니다. 결정해 주세요`, url: `/approvals/${reqId}`, tag: "budget-stop" });
  });
}
