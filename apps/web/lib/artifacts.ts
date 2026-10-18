import { getDb, schema } from "@agentorg/shared/db";
import { and, desc, eq, isNull } from "drizzle-orm";

export type Artifact = typeof schema.artifacts.$inferSelect;

/**
 * 같은 산출물의 모든 버전 (최신 먼저).
 * 미션 Task 결과는 같은 Task, 미션 최종 결과는 같은 미션의 최종본, 직접 지시 결과는 버전 연결(parent)로 묶는다.
 */
export async function artifactVersions(orgId: string, art: Artifact): Promise<Artifact[]> {
  const db = getDb();
  const t = schema.artifacts;
  if (art.taskId) return db.select().from(t).where(and(eq(t.orgId, orgId), eq(t.taskId, art.taskId))).orderBy(desc(t.version));
  if (art.missionId) return db.select().from(t).where(and(eq(t.orgId, orgId), eq(t.missionId, art.missionId), isNull(t.taskId))).orderBy(desc(t.version));
  // 직접 지시 결과: parent 연결을 위아래로 따라간다 (보통 버전 1개)
  const all = await db.select().from(t).where(and(eq(t.orgId, orgId), isNull(t.missionId))).orderBy(desc(t.version));
  const byId = new Map(all.map((a) => [a.id, a]));
  let root = art;
  for (let i = 0; root.parentVersionId && byId.has(root.parentVersionId) && i < 100; i++) root = byId.get(root.parentVersionId)!;
  const chain = new Set([root.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const a of all) {
      if (a.parentVersionId && chain.has(a.parentVersionId) && !chain.has(a.id)) {
        chain.add(a.id);
        grew = true;
      }
    }
  }
  return all.filter((a) => chain.has(a.id));
}
