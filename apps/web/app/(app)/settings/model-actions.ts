"use server";

// 모델·요금 관리 (OpenAI·Gemini·DeepSeek 등). 요금은 사용자가 공식 페이지를 보고 입력·확인한다 (2026-10-18 결정)
import { OFFICE_THEMES, type OfficeTheme } from "@agentorg/shared/agents/templates";
import { writeAudit } from "@agentorg/shared/audit";
import { getDb, schema } from "@agentorg/shared/db";
import { listModelChoices, PROVIDERS, type ProviderName } from "@agentorg/shared/llm/models";
import { isBuiltinModel } from "@agentorg/shared/llm/pricing";
import { eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getT } from "@/lib/i18n";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export type ModelFormState = { error?: string; ok?: string } | undefined;

function price(form: FormData, name: string, required: boolean): number | null | "bad" {
  const raw = String(form.get(name) ?? "").trim();
  if (raw === "") return required ? "bad" : null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : "bad";
}

/** 모델 추가 또는 고치기 (id가 같으면 고친다). 저장하면 켜진 상태가 된다 — 요금을 확인했다는 뜻 */
export async function saveModel(_prev: ModelFormState, form: FormData): Promise<ModelFormState> {
  const user = await requireUser();
  const provider = String(form.get("provider")) as ProviderName;
  const t = await getT();
  if (provider === "anthropic" || !PROVIDERS.includes(provider)) return { error: t("제공사를 골라 주세요 (Claude 모델은 기본으로 들어 있습니다)") };
  const id = String(form.get("id") ?? "").trim();
  if (!/^[A-Za-z0-9._:/-]{2,100}$/.test(id)) return { error: t("모델 이름은 제공사 문서에 있는 그대로 입력해 주세요 (예: gpt-6.1-sol)") };
  if (isBuiltinModel(id)) return { error: t("이미 기본으로 들어 있는 Claude 모델입니다") };
  const label = String(form.get("label") ?? "").trim().slice(0, 60) || id;
  const input = price(form, "inputUsd", true);
  const output = price(form, "outputUsd", true);
  const cached = price(form, "cachedInputUsd", false);
  if (input === "bad" || output === "bad" || cached === "bad") return { error: t("요금은 100만 토큰당 달러로 0~1000 사이 숫자를 입력해 주세요") };

  const values = { provider, label, inputUsd: String(input), outputUsd: String(output), cachedInputUsd: cached === null ? null : String(cached), enabled: true, updatedAt: new Date() };
  await getDb().transaction(async (tx) => {
    await tx.insert(schema.llmModels).values({ id, ...values }).onConflictDoUpdate({ target: schema.llmModels.id, set: values });
    await writeAudit(tx, {
      actorType: "USER",
      actorId: user.id,
      action: "llm_model.save",
      targetType: "llm_model",
      targetId: id,
      reasoning: `${label}: 입력 $${input} / 출력 $${output}${cached !== null ? ` / 캐시 $${cached}` : ""} (100만 토큰당), 사용 켬`, // i18n-ignore
    });
  });
  revalidatePath("/settings");
  return { ok: t("저장하고 켰습니다. 에이전트 프로필에서 고를 수 있습니다.") };
}

export async function toggleModel(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id"));
  const [row] = await getDb().select().from(schema.llmModels).where(eq(schema.llmModels.id, id));
  if (!row) return;
  await getDb().transaction(async (tx) => {
    await tx.update(schema.llmModels).set({ enabled: !row.enabled, updatedAt: new Date() }).where(eq(schema.llmModels.id, id));
    await writeAudit(tx, {
      actorType: "USER",
      actorId: user.id,
      action: row.enabled ? "llm_model.disable" : "llm_model.enable",
      targetType: "llm_model",
      targetId: id,
      reasoning: row.enabled ? `${row.label} 끔` : `${row.label} 요금 확인 후 켬 (입력 $${Number(row.inputUsd)} / 출력 $${Number(row.outputUsd)})`, // i18n-ignore
    });
  });
  revalidatePath("/settings");
}

export async function deleteModel(_prev: ModelFormState, form: FormData): Promise<ModelFormState> {
  const user = await requireUser();
  const id = String(form.get("id"));
  const t = await getT();
  const users = await getDb()
    .select({ name: schema.agents.name })
    .from(schema.agents)
    .where(or(eq(schema.agents.modelPrimary, id), eq(schema.agents.modelEconomy, id)));
  if (users.length) return { error: t("{names}이(가) 쓰고 있어 지울 수 없습니다. 먼저 프로필에서 모델을 바꿔 주세요", { names: users.map((u) => u.name).join(", ") }) };
  await getDb().transaction(async (tx) => {
    const [row] = await tx.delete(schema.llmModels).where(eq(schema.llmModels.id, id)).returning();
    if (row) await writeAudit(tx, { actorType: "USER", actorId: user.id, action: "llm_model.delete", targetType: "llm_model", targetId: id, reasoning: `${row.label} 삭제` }); // i18n-ignore
  });
  revalidatePath("/settings");
  return { ok: t("지웠습니다") };
}

/** F109 장애 시 대체 모델 (선택한 조직). 비우면 대체 없이 실패 처리 */
export async function saveFallbackModel(form: FormData) {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) return;
  const raw = String(form.get("fallbackModel") ?? "").trim();
  const choices = await listModelChoices(getDb());
  const model = choices.some((c) => c.id === raw) ? raw : null;
  if (raw && !model) return;
  await getDb().transaction(async (tx) => {
    await tx.update(schema.organizations).set({ fallbackModel: model }).where(eq(schema.organizations.id, org.id));
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "org.fallback_model",
      targetType: "organization",
      targetId: org.id,
      reasoning: model ? `장애 시 대체 모델: ${model}` : "장애 시 대체 모델 쓰지 않음", // i18n-ignore
    });
  });
  revalidatePath("/settings");
}

/** 조직 하루 예산 (원). 이 금액을 쓰면 그날은 AI 호출을 멈춘다 (F013) */
export async function saveBudgetDaily(form: FormData) {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) return;
  const value = Math.round(Number(form.get("budgetDaily")));
  if (!Number.isFinite(value) || value < 100 || value > 1_000_000) return;
  await getDb().transaction(async (tx) => {
    await tx.update(schema.organizations).set({ budgetDaily: value }).where(eq(schema.organizations.id, org.id));
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "org.budget_daily",
      targetType: "organization",
      targetId: org.id,
      reasoning: `하루 예산 ${org.budgetDaily.toLocaleString("ko-KR")}원 → ${value.toLocaleString("ko-KR")}원`, // i18n-ignore
    });
  });
  revalidatePath("/settings");
}

/** F202 사무실 테마 (버튼으로 고른다) */
export async function saveOfficeTheme(form: FormData) {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) return;
  const theme = String(form.get("theme"));
  if (!(theme in OFFICE_THEMES) || theme === org.officeTheme) return;
  await getDb().transaction(async (tx) => {
    await tx.update(schema.organizations).set({ officeTheme: theme }).where(eq(schema.organizations.id, org.id));
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "org.office_theme",
      targetType: "organization",
      targetId: org.id,
      reasoning: `사무실 테마 ${OFFICE_THEMES[org.officeTheme as OfficeTheme]?.label ?? org.officeTheme} → ${OFFICE_THEMES[theme as OfficeTheme].label}`, // i18n-ignore
    });
  });
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/office");
}
