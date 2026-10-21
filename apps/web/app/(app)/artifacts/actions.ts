"use server";

// F011 산출물: 평가(1~5) · 이전 버전으로 되돌리기(새 버전으로 복사). 변경은 AuditLog에 기록
import { writeAudit } from "@agentorg/shared/audit";
import { getDb, schema } from "@agentorg/shared/db";
import { publishOrgEvent } from "@agentorg/shared/events";
import { EXPORT_CHANNELS, type ExportChannel, requestExport } from "@agentorg/shared/export";
import { awardXp, ratingBonus } from "@agentorg/shared/growth";
import { addArtifactToKnowledge, KNOWLEDGE_MIN_RATING } from "@agentorg/shared/knowledge";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { artifactVersions } from "@/lib/artifacts";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

async function context(form: FormData) {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) redirect("/settings");
  const id = String(form.get("id"));
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { user, org, art: undefined };
  const [art] = await getDb()
    .select()
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.id, id), eq(schema.artifacts.orgId, org.id)));
  return { user, org, art };
}

/** 별 버튼마다 점수를 묶어 부른다 (formAction={rateArtifact.bind(null, n)}) — 누른 버튼의 name/value는 서버 액션에 오지 않을 수 있다 */
export async function rateArtifact(rating: number, form: FormData) {
  const { user, org, art } = await context(form);
  if (!art || !Number.isInteger(rating) || rating < 1 || rating > 5) return;
  await getDb().transaction(async (tx) => {
    await tx.update(schema.artifacts).set({ rating }).where(eq(schema.artifacts.id, art.id));
    await writeAudit(tx, { orgId: org.id, actorType: "USER", actorId: user.id, action: "artifact.rate", targetType: "artifact", targetId: art.id, reasoning: `"${art.title}" v${art.version} 평가 ${rating}점` });
  });
  // F102: 별점 보너스 경험치 (점수를 올린 만큼만)
  const bonus = ratingBonus(art.rating, rating);
  if (bonus > 0 && art.agentId) await awardXp(getDb(), { agentId: art.agentId, amount: bonus, reason: `"${art.title}" 별점 ${rating}점` });
  // F105: 좋은 결과(4점 이상)는 지식 베이스에 넣는다
  if (rating >= KNOWLEDGE_MIN_RATING) await addArtifactToKnowledge(getDb(), art, { type: "USER", id: user.id }, `평가 ${rating}점`);
  revalidatePath(`/artifacts/${art.id}`);
  revalidatePath("/artifacts");
}

/** 고른 버전의 내용을 새 버전(최신+1)으로 저장한다 — 기록은 지우지 않는다 */
export async function revertArtifact(form: FormData) {
  const { user, org, art } = await context(form);
  if (!art) return;
  const versions = await artifactVersions(org.id, art);
  const latest = versions[0];
  if (!latest || latest.id === art.id) return;
  const copy = await getDb().transaction(async (tx) => {
    const [c] = await tx
      .insert(schema.artifacts)
      .values({
        orgId: org.id,
        missionId: art.missionId,
        taskId: art.taskId,
        agentId: art.agentId,
        title: art.title,
        format: art.format,
        content: art.content,
        version: latest.version + 1,
        parentVersionId: latest.id,
      })
      .returning({ id: schema.artifacts.id });
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "artifact.revert",
      targetType: "artifact",
      targetId: c.id,
      reasoning: `"${art.title}"을(를) v${art.version} 내용으로 되돌림 (새 버전 v${latest.version + 1})`,
    });
    return c;
  });
  redirect(`/artifacts/${copy.id}`);
}

// ── F205 보내기: 승인함에 외부 발송 요청을 올린다 (승인해야 실제로 보낸다) ──

export type ExportState = { error?: string; approvalId?: string; existing?: boolean } | undefined;

export async function requestExportAction(_prev: ExportState, form: FormData): Promise<ExportState> {
  const { user, org, art } = await context(form);
  if (!art) return { error: "산출물을 찾을 수 없습니다" };
  const channel = String(form.get("channel"));
  if (!(EXPORT_CHANNELS as readonly string[]).includes(channel)) return { error: "보낼 곳을 골라 주세요" };
  const r = await requestExport(getDb(), { orgId: org.id, userId: user.id, artifactId: art.id, channel: channel as ExportChannel, to: String(form.get("to") ?? "") });
  if ("error" in r) return { error: r.error };
  if (!r.existing) await publishOrgEvent(org.id, { type: "approval" });
  revalidatePath("/approvals");
  return { approvalId: r.approvalId, existing: r.existing };
}
