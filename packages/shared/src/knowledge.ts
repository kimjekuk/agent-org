// F105 조직 지식 베이스 (2026-10-18 결정)
// - 넣기: 미션 최종 결과(완료 시 자동) · 사용자가 4~5점 준 산출물(자동) · 산출물 화면의 '위키에 넣기' · 직접 쓰기
// - 쓰기: 에이전트가 일을 시작할 때 지시 내용으로 관련 문서를 키워드 검색해 최대 3개를 참고로 붙인다 (추가 AI 호출 없음)
import { and, desc, eq, ilike, isNull, ne, or, type SQL } from "drizzle-orm";
import { writeAudit } from "./audit";
import type { AnyDb } from "./db/client";
import { artifacts, knowledgeDocs } from "./db/schema";

/** 4점 이상이면 좋은 결과로 보고 자동으로 넣는다 */
export const KNOWLEDGE_MIN_RATING = 4;
const MAX_CONTENT = 50_000;
const CONTEXT_DOCS = 3;
const CONTEXT_CHARS = 1500;

type Artifact = typeof artifacts.$inferSelect;
type Actor = { type: "USER" | "AGENT" | "SYSTEM"; id?: string | null };

// 한국어 조사·어미 일부를 떼어 낸다 (트렌드를 → 트렌드). 2글자 이하가 되면 그대로 둔다
const JOSA = /(으로|에서|에게|까지|부터|이나|보다|처럼|하고|은|는|이|가|을|를|의|에|와|과|로|도|만)$/;
// 지시문 끝의 말투 (정리해줘 → 정리)
const ENDING = /(해\s*주세요|해\s*줘|해라|하라|하기|합니다|해요|해)$/;
const STOP = new Set(["그리고", "하지만", "대한", "관련", "위한", "해줘", "해주세요", "정리", "작성", "만들어", "the", "and", "for"]);

/** 검색어 → 키워드 (최대 8개). 2글자 미만·불용어 제외 */
export function keywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => {
      const cut = w.replace(ENDING, "").replace(JOSA, "");
      return cut.length >= 2 ? cut : w;
    })
    .filter((w) => w.length >= 2 && !STOP.has(w));
  return [...new Set(words)].slice(0, 8);
}

export interface KnowledgeHit {
  id: string;
  title: string;
  content: string;
  tags: string[];
  score: number;
}

/** 키워드가 제목(3점)·태그(2점)·본문(1점)에 몇 개 들어 있는지로 점수를 매겨 높은 순으로 */
export async function searchKnowledge(db: AnyDb, orgId: string, query: string, limit = 10, excludeMissionId?: string | null): Promise<KnowledgeHit[]> {
  const words = keywords(query);
  if (words.length === 0) return [];
  const conds: SQL[] = words.flatMap((w) => [ilike(knowledgeDocs.title, `%${escapeLike(w)}%`), ilike(knowledgeDocs.content, `%${escapeLike(w)}%`)]);
  const rows = await db
    .select({ id: knowledgeDocs.id, title: knowledgeDocs.title, content: knowledgeDocs.content, tags: knowledgeDocs.tags })
    .from(knowledgeDocs)
    .where(
      and(
        eq(knowledgeDocs.orgId, orgId),
        or(...conds),
        // 지금 하는 미션에서 나온 자료는 이미 앞 Task 결과로 전달된다
        excludeMissionId ? or(isNull(knowledgeDocs.missionId), ne(knowledgeDocs.missionId, excludeMissionId)) : undefined,
      ),
    )
    .orderBy(desc(knowledgeDocs.updatedAt))
    .limit(100);
  return rows
    .map((r) => {
      const title = r.title.toLowerCase();
      const body = r.content.toLowerCase();
      const tags = (r.tags ?? []).map((t) => t.toLowerCase());
      const score = words.reduce((s, w) => s + (title.includes(w) ? 3 : 0) + (tags.some((t) => t.includes(w)) ? 2 : 0) + (body.includes(w) ? 1 : 0), 0);
      return { ...r, tags: r.tags ?? [], score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * 일을 시작할 때 시스템 프롬프트에 붙일 관련 지식 (최대 3개, 문서당 앞부분 1,500자). 없으면 빈 문자열.
 * 키워드가 2개 이상 맞거나 제목에 맞은 문서만 (우연히 한 단어만 겹친 문서는 넣지 않는다)
 */
export async function knowledgeContext(db: AnyDb, orgId: string, query: string, missionId?: string | null): Promise<string> {
  const hits = (await searchKnowledge(db, orgId, query, CONTEXT_DOCS * 2, missionId)).filter((h) => h.score >= 2).slice(0, CONTEXT_DOCS);
  if (hits.length === 0) return "";
  const parts = hits.map((h) => {
    const body = h.content.length > CONTEXT_CHARS ? `${h.content.slice(0, CONTEXT_CHARS)}\n…(이하 생략)` : h.content;
    return `## ${h.title}\n${body}`;
  });
  return `${parts.join("\n\n")}\n\n(조직이 이전에 만든 자료다. 도움이 되면 활용하고, 같은 조사를 반복하지 않는다. 오래된 정보일 수 있고, 사용자 지시와 다르면 사용자 지시를 따른다.)`;
}

/** 산출물 계열 키: 같은 Task·같은 미션 최종 결과의 새 버전은 같은 문서를 고친다 */
export function artifactSourceKey(art: Pick<Artifact, "id" | "taskId" | "missionId">): string {
  if (art.taskId) return `task:${art.taskId}`;
  if (art.missionId) return `mission:${art.missionId}`;
  return `artifact:${art.id}`;
}

/** 산출물을 지식 베이스에 넣는다 (같은 계열이 있으면 최신 내용으로 고친다). 문서 id를 돌려준다 */
export async function addArtifactToKnowledge(db: AnyDb, art: Artifact, actor: Actor, reason: string): Promise<string> {
  const sourceKey = artifactSourceKey(art);
  const source = art.missionId && !art.taskId ? "MISSION" : "ARTIFACT";
  return db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(knowledgeDocs)
      .values({ orgId: art.orgId, title: art.title, content: art.content.slice(0, MAX_CONTENT), source, sourceKey, artifactId: art.id, missionId: art.missionId })
      .onConflictDoUpdate({
        target: [knowledgeDocs.orgId, knowledgeDocs.sourceKey],
        set: { title: art.title, content: art.content.slice(0, MAX_CONTENT), artifactId: art.id, updatedAt: new Date() },
      })
      .returning({ id: knowledgeDocs.id });
    await writeAudit(tx, {
      orgId: art.orgId,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: "knowledge.add",
      targetType: "knowledge_doc",
      targetId: doc.id,
      reasoning: `"${art.title}" v${art.version} — ${reason}`,
      payload: { artifactId: art.id, sourceKey },
    });
    return doc.id;
  });
}

/** 사용자가 직접 쓰거나 고친 문서 저장 (id가 있으면 고친다) */
export async function saveKnowledgeDoc(
  db: AnyDb,
  input: { orgId: string; userId: string; id?: string | null; title: string; content: string; tags: string[] },
): Promise<string> {
  const title = input.title.trim().slice(0, 200);
  const content = input.content.trim().slice(0, MAX_CONTENT);
  const tags = [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))].slice(0, 10).map((t) => t.slice(0, 30));
  return db.transaction(async (tx) => {
    let id = input.id ?? null;
    if (id) {
      const [row] = await tx
        .update(knowledgeDocs)
        .set({ title, content, tags, updatedAt: new Date() })
        .where(and(eq(knowledgeDocs.id, id), eq(knowledgeDocs.orgId, input.orgId)))
        .returning({ id: knowledgeDocs.id });
      if (!row) throw new Error("문서를 찾을 수 없습니다");
    } else {
      const [row] = await tx.insert(knowledgeDocs).values({ orgId: input.orgId, title, content, tags, source: "MANUAL" }).returning({ id: knowledgeDocs.id });
      id = row.id;
    }
    await writeAudit(tx, {
      orgId: input.orgId,
      actorType: "USER",
      actorId: input.userId,
      action: input.id ? "knowledge.update" : "knowledge.create",
      targetType: "knowledge_doc",
      targetId: id,
      reasoning: `"${title}"${tags.length ? ` (태그: ${tags.join(", ")})` : ""}`,
    });
    return id;
  });
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
