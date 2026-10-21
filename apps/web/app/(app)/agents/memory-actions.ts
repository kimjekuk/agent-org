"use server";

// F101 기억: 사용자가 보고·고치고·지우고·추가하고·초기화한다. 모든 변경은 AuditLog
import { writeAudit } from "@agentorg/shared/audit";
import { getDb, schema } from "@agentorg/shared/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOrgAgent } from "@/lib/agents";
import { getT } from "@/lib/i18n";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export type MemoryFormState = { error?: string; ok?: string } | undefined;

async function context(form: FormData) {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) redirect("/settings");
  const agent = await getOrgAgent(org.id, String(form.get("agentId")));
  return { user, org, agent };
}

async function ownMemory(agentId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [m] = await getDb().select().from(schema.memories).where(and(eq(schema.memories.id, id), eq(schema.memories.agentId, agentId)));
  return m;
}

export async function updateMemory(_prev: MemoryFormState, form: FormData): Promise<MemoryFormState> {
  const { user, org, agent } = await context(form);
  const t = await getT();
  if (!agent) return { error: t("에이전트를 찾을 수 없습니다") };
  const m = await ownMemory(agent.id, String(form.get("id")));
  if (!m) return { error: t("기억을 찾을 수 없습니다") };
  const content = String(form.get("content") ?? "").trim();
  if (content.length < 2 || content.length > 300) return { error: t("기억은 2~300자로 입력해 주세요") };
  await getDb().transaction(async (tx) => {
    await tx.update(schema.memories).set({ content, source: m.source?.startsWith("user") ? m.source : `user-edited:${m.source ?? ""}` }).where(eq(schema.memories.id, m.id));
    await writeAudit(tx, { orgId: org.id, actorType: "USER", actorId: user.id, action: "memory.update", targetType: "memory", targetId: m.id, reasoning: `"${agent.name}" 기억 수정: ${m.content} → ${content}` }); // i18n-ignore
  });
  revalidatePath(`/agents/${agent.id}`);
  return { ok: t("고쳤습니다") };
}

export async function deleteMemory(form: FormData) {
  const { user, org, agent } = await context(form);
  if (!agent) return;
  const m = await ownMemory(agent.id, String(form.get("id")));
  if (!m) return;
  await getDb().transaction(async (tx) => {
    await tx.delete(schema.memories).where(eq(schema.memories.id, m.id));
    await writeAudit(tx, { orgId: org.id, actorType: "USER", actorId: user.id, action: "memory.delete", targetType: "memory", targetId: m.id, reasoning: `"${agent.name}" 기억 삭제: ${m.content}` }); // i18n-ignore
  });
  revalidatePath(`/agents/${agent.id}`);
}

/** 사용자가 직접 넣는 장기 기억 (예: "보고서는 항상 3줄 요약부터") */
export async function addMemory(_prev: MemoryFormState, form: FormData): Promise<MemoryFormState> {
  const { user, org, agent } = await context(form);
  const t = await getT();
  if (!agent) return { error: t("에이전트를 찾을 수 없습니다") };
  const content = String(form.get("content") ?? "").trim();
  if (content.length < 2 || content.length > 300) return { error: t("기억은 2~300자로 입력해 주세요") };
  await getDb().transaction(async (tx) => {
    const [m] = await tx.insert(schema.memories).values({ agentId: agent.id, scope: "LONG", content, source: "user" }).returning({ id: schema.memories.id });
    await writeAudit(tx, { orgId: org.id, actorType: "USER", actorId: user.id, action: "memory.add", targetType: "memory", targetId: m.id, reasoning: `"${agent.name}" 장기 기억 추가: ${content}` }); // i18n-ignore
  });
  revalidatePath(`/agents/${agent.id}`);
  return { ok: t("장기 기억에 넣었습니다") };
}

export async function resetMemories(form: FormData) {
  const { user, org, agent } = await context(form);
  if (!agent) return;
  await getDb().transaction(async (tx) => {
    const removed = await tx.delete(schema.memories).where(eq(schema.memories.agentId, agent.id)).returning({ id: schema.memories.id });
    await writeAudit(tx, { orgId: org.id, actorType: "USER", actorId: user.id, action: "memory.reset", targetType: "agent", targetId: agent.id, reasoning: `"${agent.name}" 기억 초기화 (${removed.length}개 삭제)` }); // i18n-ignore
  });
  revalidatePath(`/agents/${agent.id}`);
}
