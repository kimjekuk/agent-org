"use server";

// F001 API 키 · F002 조직. 모든 변경은 AuditLog에 기록한다 (CLAUDE.md 절대 규칙 4).
import { writeAudit } from "@agentorg/shared/audit";
import { encryptSecret } from "@agentorg/shared/crypto";
import { getDb, schema } from "@agentorg/shared/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/session";

export type ActionResult = { error?: string; ok?: string } | undefined;

const ORG_COOKIE = "org";
const PROVIDERS = ["anthropic"] as const; // OpenAI·Gemini 어댑터는 이후 단계

function orgName(form: FormData): string | null {
  const name = String(form.get("name") ?? "").trim();
  return name.length >= 1 && name.length <= 50 ? name : null;
}

// ── F002 조직 ─────────────────────────────────────────

export async function createOrg(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const name = orgName(form);
  if (!name) return { error: "조직 이름은 1~50자로 입력해 주세요" };

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
  return { ok: `"${name}" 조직을 만들었습니다` };
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
  if (!name) return { error: "조직 이름은 1~50자로 입력해 주세요" };

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
  return renamed ? { ok: "이름을 바꿨습니다" } : { error: "조직을 찾을 수 없습니다" };
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
  if (!PROVIDERS.includes(provider as (typeof PROVIDERS)[number])) return { error: "지원하지 않는 제공사입니다" };
  if (key.length < 20 || key.length > 300 || /\s/.test(key)) return { error: "API 키 형식이 올바르지 않습니다" };

  let encryptedKey: string;
  try {
    encryptedKey = encryptSecret(key);
  } catch {
    return { error: "서버 암호화 설정(ENCRYPTION_KEY)이 없습니다. 잠시 후 다시 시도해 주세요" };
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
  return { ok: "API 키를 암호화해서 저장했습니다" };
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
