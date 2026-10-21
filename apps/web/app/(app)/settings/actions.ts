"use server";

// F001 API 키 · F002 조직. 모든 변경은 AuditLog에 기록한다 (CLAUDE.md 절대 규칙 4).
import { writeAudit } from "@agentorg/shared/audit";
import { checkBudget } from "@agentorg/shared/budget";
import { encryptSecret } from "@agentorg/shared/crypto";
import { getDb, schema } from "@agentorg/shared/db";
import { BudgetExceededError, callLLM, EmergencyStopError, MissingApiKeyError } from "@agentorg/shared/llm/gateway";
import { PROVIDER_LABEL, PROVIDERS, type ProviderName, UnknownModelError } from "@agentorg/shared/llm/models";
import { DEFAULT_MODELS } from "@agentorg/shared/llm/pricing";
import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getT } from "@/lib/i18n";
import { getCurrentOrg, ORG_COOKIE } from "@/lib/org";
import { requireUser } from "@/lib/session";

export type ActionResult = { error?: string; ok?: string } | undefined;


function orgName(form: FormData): string | null {
  const name = String(form.get("name") ?? "").trim();
  return name.length >= 1 && name.length <= 50 ? name : null;
}

// ── F002 조직 ─────────────────────────────────────────

export async function createOrg(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const name = orgName(form);
  const t = await getT();
  if (!name) return { error: t("조직 이름은 1~50자로 입력해 주세요") };

  const db = getDb();
  const org = await db.transaction(async (tx) => {
    const [org] = await tx.insert(schema.organizations).values({ ownerId: user.id, name }).returning();
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "org.create",
      targetType: "organization",
      targetId: org.id,
      payload: { name },
    });
    return org;
  });

  (await cookies()).set(ORG_COOKIE, org.id, { httpOnly: true, sameSite: "lax", path: "/" });
  revalidatePath("/settings");
  return { ok: t("\"{name}\" 조직을 만들었습니다", { name }) };
}

export async function selectOrg(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const [org] = await getDb()
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(and(eq(schema.organizations.id, id), eq(schema.organizations.ownerId, user.id)));
  if (!org) return;
  (await cookies()).set(ORG_COOKIE, org.id, { httpOnly: true, sameSite: "lax", path: "/" });
  revalidatePath("/settings");
}

export async function renameOrg(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const name = orgName(form);
  const t = await getT();
  if (!name) return { error: t("조직 이름은 1~50자로 입력해 주세요") };

  const renamed = await getDb().transaction(async (tx) => {
    const [org] = await tx
      .update(schema.organizations)
      .set({ name })
      .where(and(eq(schema.organizations.id, id), eq(schema.organizations.ownerId, user.id)))
      .returning({ id: schema.organizations.id });
    if (!org) return false;
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "org.rename",
      targetType: "organization",
      targetId: org.id,
      payload: { name },
    });
    return true;
  });

  revalidatePath("/settings");
  return renamed ? { ok: t("이름을 바꿨습니다") } : { error: t("조직을 찾을 수 없습니다") };
}

export async function deleteOrg(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");

  await getDb().transaction(async (tx) => {
    const [org] = await tx
      .delete(schema.organizations)
      .where(and(eq(schema.organizations.id, id), eq(schema.organizations.ownerId, user.id)))
      .returning({ id: schema.organizations.id, name: schema.organizations.name });
    if (!org) return;
    // 조직이 지워지면 그 조직의 로그도 함께 사라지므로, 삭제 기록은 계정 단위(org_id 없음)로 남긴다
    await writeAudit(tx, {
      actorType: "USER",
      actorId: user.id,
      action: "org.delete",
      targetType: "organization",
      targetId: org.id,
      payload: { name: org.name },
    });
  });

  const jar = await cookies();
  if (jar.get(ORG_COOKIE)?.value === id) jar.delete(ORG_COOKIE);
  revalidatePath("/settings");
}

// ── F001 API 키 ───────────────────────────────────────

export async function saveApiKey(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const provider = String(form.get("provider") ?? "");
  const key = String(form.get("key") ?? "").trim();
  const t = await getT();
  if (!PROVIDERS.includes(provider as ProviderName)) return { error: t("지원하지 않는 제공사입니다") };
  if (key.length < 20 || key.length > 300 || /\s/.test(key)) return { error: t("API 키 형식이 올바르지 않습니다") };

  let encryptedKey: string;
  try {
    encryptedKey = encryptSecret(key);
  } catch {
    return { error: t("서버 암호화 설정(ENCRYPTION_KEY)이 없습니다. 잠시 후 다시 시도해 주세요") };
  }

  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.apiKeys)
      .values({ userId: user.id, provider, encryptedKey })
      .onConflictDoUpdate({
        target: [schema.apiKeys.userId, schema.apiKeys.provider],
        set: { encryptedKey, createdAt: new Date() },
      })
      .returning({ id: schema.apiKeys.id });
    await writeAudit(tx, {
      actorType: "USER",
      actorId: user.id,
      action: "api_key.save",
      targetType: "api_key",
      targetId: row.id,
      payload: { provider }, // 키 값은 기록하지 않는다
    });
  });

  revalidatePath("/settings");
  return { ok: t("API 키를 암호화해서 저장했습니다") };
}

export async function deleteApiKey(form: FormData) {
  const user = await requireUser();
  const provider = String(form.get("provider") ?? "");

  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .delete(schema.apiKeys)
      .where(and(eq(schema.apiKeys.userId, user.id), eq(schema.apiKeys.provider, provider)))
      .returning({ id: schema.apiKeys.id });
    if (!row) return;
    await writeAudit(tx, {
      actorType: "USER",
      actorId: user.id,
      action: "api_key.delete",
      targetType: "api_key",
      targetId: row.id,
      payload: { provider },
    });
  });

  revalidatePath("/settings");
}

// ── F013 연결 테스트: gateway를 거친 실제 호출 1회 (제공사의 가장 싼 모델, 1원 미만) ──

export type TestResult = { error?: string; reply?: string; model?: string; costKrw?: number; todayRatio?: number; budgetDaily?: number } | undefined;

export async function testConnection(_prev: TestResult, form: FormData): Promise<TestResult> {
  const user = await requireUser();
  const db = getDb();
  const org = await getCurrentOrg(user.id);
  const t = await getT();
  if (!org) return { error: t("먼저 조직을 만들어 주세요 (비용은 조직 예산에 기록됩니다)") };
  const provider = String(form.get("provider") ?? "anthropic") as ProviderName;
  if (!PROVIDERS.includes(provider)) return { error: t("지원하지 않는 제공사입니다") };

  let model: string = DEFAULT_MODELS.economy;
  if (provider !== "anthropic") {
    const [cheapest] = await db
      .select({ id: schema.llmModels.id })
      .from(schema.llmModels)
      .where(and(eq(schema.llmModels.provider, provider), eq(schema.llmModels.enabled, true)))
      .orderBy(asc(schema.llmModels.outputUsd))
      .limit(1);
    if (!cheapest) return { error: t("{provider} 모델이 꺼져 있습니다. 아래 '모델·요금'에서 요금을 확인하고 하나 켜 주세요", { provider: PROVIDER_LABEL[provider] }) };
    model = cheapest.id;
  }

  try {
    const r = await callLLM(db, {
      orgId: org.id,
      actor: { type: "USER", id: user.id },
      purpose: `API 키 연결 테스트 (설정 화면, ${PROVIDER_LABEL[provider]})`, // i18n-ignore (기록용)
      model,
      messages: [{ role: "user", content: "연결 확인입니다. '연결됨'이라고만 답해 주세요." }], // i18n-ignore (LLM 프롬프트)
      maxTokens: 1000,
      noFallback: true,
    });
    const budget = await checkBudget(db, { orgId: org.id });
    return { reply: r.text.trim() || t("(빈 응답)"), model: r.model, costKrw: r.costKrw, todayRatio: budget.ratio, budgetDaily: org.budgetDaily };
  } catch (e) {
    if (e instanceof EmergencyStopError || e instanceof BudgetExceededError || e instanceof MissingApiKeyError || e instanceof UnknownModelError) return { error: e.message };
    const status = (e as { status?: number }).status;
    if (status === 401) return { error: t("API 키가 올바르지 않습니다 (401). 키를 다시 확인해 주세요") };
    if (status === 429) return { error: t("요청이 너무 많거나 크레딧이 부족합니다 (429)") };
    if (status === 404) return { error: t("모델 이름({model})을 제공사가 모릅니다 (404). '모델·요금'에서 모델 이름을 확인해 주세요", { model }) };
    return { error: t("{provider} 호출에 실패했습니다{status}. 잠시 후 다시 시도해 주세요", { provider: PROVIDER_LABEL[provider], status: status ? ` (${status})` : "" }) };
  }
}
