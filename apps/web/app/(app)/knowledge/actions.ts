"use server";

// F105 지식 베이스: 직접 쓰기·고치기·지우기, 산출물 넣기. 변경은 AuditLog에 기록 (CLAUDE.md 절대 규칙 4)
import { writeAudit } from "@agentorg/shared/audit";
import { getDb, schema } from "@agentorg/shared/db";
import { addArtifactToKnowledge, saveKnowledgeDoc } from "@agentorg/shared/knowledge";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export type KnowledgeFormState = { error?: string } | undefined;

async function context() {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) redirect("/settings");
  return { user, org };
}

const UUID = /^[0-9a-f-]{36}$/i;

export async function saveDoc(_prev: KnowledgeFormState, form: FormData): Promise<KnowledgeFormState> {
  const { user, org } = await context();
  const id = String(form.get("id") ?? "");
  const title = String(form.get("title") ?? "").trim();
  const content = String(form.get("content") ?? "").trim();
  const tags = String(form.get("tags") ?? "").split(/[,#\n]/);
  if (!title) return { error: "제목을 입력해 주세요" };
  if (!content) return { error: "내용을 입력해 주세요" };
  let docId: string;
  try {
    docId = await saveKnowledgeDoc(getDb(), { orgId: org.id, userId: user.id, id: UUID.test(id) ? id : null, title, content, tags });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/knowledge");
  redirect(`/knowledge/${docId}`);
}

export async function deleteDoc(form: FormData) {
  const { user, org } = await context();
  const id = String(form.get("id"));
  if (!UUID.test(id)) return;
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .delete(schema.knowledgeDocs)
      .where(and(eq(schema.knowledgeDocs.id, id), eq(schema.knowledgeDocs.orgId, org.id)))
      .returning();
    if (row) await writeAudit(tx, { orgId: org.id, actorType: "USER", actorId: user.id, action: "knowledge.delete", targetType: "knowledge_doc", targetId: id, reasoning: `"${row.title}" 삭제` });
  });
  revalidatePath("/knowledge");
  redirect("/knowledge");
}

/** 산출물 화면의 '위키에 넣기' */
export async function addArtifact(form: FormData) {
  const { user, org } = await context();
  const id = String(form.get("artifactId"));
  if (!UUID.test(id)) return;
  const [art] = await getDb()
    .select()
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.id, id), eq(schema.artifacts.orgId, org.id)));
  if (!art) return;
  await addArtifactToKnowledge(getDb(), art, { type: "USER", id: user.id }, "사용자가 위키에 넣음");
  revalidatePath(`/artifacts/${art.id}`);
  revalidatePath("/knowledge");
}
