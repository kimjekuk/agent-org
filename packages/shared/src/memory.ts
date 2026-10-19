// F101 기억 3단계 (2026-10-18 결정)
// - 단기(SHORT): 직접 지시 한 건에서 배운 점 / 중기(MID): 미션 안의 Task에서 배운 점 / 장기(LONG): 미션이 끝날 때 리더가 정리한 교훈
// - 만들기: 에이전트가 결과 끝에 '## 기억할 점'을 함께 적고, 그 부분을 떼어 저장한다 (추가 LLM 호출 없음)
// - 쓰기: 다음 일의 시스템 프롬프트에 참고로 넣는다. 사용자 지시가 항상 우선한다 (대전제)
// - 사용자는 에이전트 화면에서 보고·고치고·지우고·초기화할 수 있다
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { writeAudit } from "./audit";
import type { AnyDb } from "./db/client";
import { memories } from "./db/schema";

export type MemoryScope = "SHORT" | "MID" | "LONG";
export const MEMORY_LABEL: Record<MemoryScope, string> = { SHORT: "단기", MID: "중기 (미션)", LONG: "장기 (교훈)" };

/** 에이전트가 결과 끝에 붙이는 섹션 제목 */
export const MEMO_HEADING = "기억할 점";
/** 리더가 최종 결과 끝에 붙이는 섹션 제목 */
export const LESSON_HEADING = "팀 교훈";

/** 보관 개수 (오래된 것부터 지운다) */
const KEEP: Record<MemoryScope, number> = { SHORT: 20, MID: 20, LONG: 30 };
const MAX_ITEM = 300;

/**
 * 마크다운에서 '## 제목' 섹션을 떼어 낸다. 남은 본문과 섹션의 항목(줄마다, 글머리표 제거)을 돌려준다.
 * 섹션은 다음 '## ' 제목이나 글 끝까지.
 */
export function extractSection(markdown: string, heading: string, max = 5): { body: string; items: string[] } {
  const re = new RegExp(`^##\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
  const m = re.exec(markdown);
  if (!m) return { body: markdown, items: [] };
  const start = m.index;
  const after = markdown.slice(start + m[0].length);
  const next = after.search(/^##\s/m);
  const section = next >= 0 ? after.slice(0, next) : after;
  const rest = next >= 0 ? after.slice(next) : "";
  const items = section
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((l) => l.length > 1 && !/^(없음|해당 없음|none)\.?$/i.test(l))
    .slice(0, max)
    .map((l) => l.slice(0, MAX_ITEM));
  return { body: (markdown.slice(0, start).trimEnd() + (rest ? `\n\n${rest.trimStart()}` : "")).trim(), items };
}

/** 기억 저장 + 개수 제한 + 감사 로그 */
export async function saveMemories(
  tx: AnyDb,
  input: { orgId: string; agentId: string; scope: MemoryScope; missionId?: string | null; source: string; items: string[] },
) {
  if (input.items.length === 0) return;
  const rows = await tx
    .insert(memories)
    .values(input.items.map((content) => ({ agentId: input.agentId, scope: input.scope, missionId: input.missionId ?? null, content, source: input.source })))
    .returning({ id: memories.id });
  // 범위별로 최근 것만 남긴다 (중기는 미션별)
  const keepWhere =
    input.scope === "MID" && input.missionId
      ? and(eq(memories.agentId, input.agentId), eq(memories.scope, "MID"), eq(memories.missionId, input.missionId))
      : and(eq(memories.agentId, input.agentId), eq(memories.scope, input.scope));
  const keep = await tx.select({ id: memories.id }).from(memories).where(keepWhere).orderBy(desc(memories.createdAt)).limit(KEEP[input.scope]);
  if (keep.length >= KEEP[input.scope]) {
    await tx.delete(memories).where(and(keepWhere, notInArray(memories.id, keep.map((k) => k.id))));
  }
  await writeAudit(tx, {
    orgId: input.orgId,
    actorType: "AGENT",
    actorId: input.agentId,
    action: "memory.save",
    targetType: "agent",
    targetId: input.agentId,
    reasoning: `${MEMORY_LABEL[input.scope]} 기억 ${rows.length}개: ${input.items.join(" / ").slice(0, 200)}`,
    payload: { scope: input.scope, missionId: input.missionId ?? null, source: input.source },
  });
}

/** 같은 출처(예: 미션 최종 통합)의 기억을 지운다 — 다시 만들 때 겹치지 않게 */
export async function clearMemoriesBySource(tx: AnyDb, agentIds: string[], source: string) {
  if (agentIds.length === 0) return;
  await tx.delete(memories).where(and(inArray(memories.agentId, agentIds), eq(memories.source, source)));
}

/**
 * 다음 일에 참고할 기억 (시스템 프롬프트에 넣는 글). 장기 최근 15, 이 미션의 중기 10, 단기 최근 5. 없으면 빈 문자열
 */
export async function memoryContext(db: AnyDb, agentId: string, missionId?: string | null): Promise<string> {
  const pick = (scope: MemoryScope, limit: number, mission?: string | null) =>
    db
      .select({ content: memories.content })
      .from(memories)
      .where(and(eq(memories.agentId, agentId), eq(memories.scope, scope), ...(mission ? [eq(memories.missionId, mission)] : [])))
      .orderBy(desc(memories.createdAt))
      .limit(limit);
  const [long, mid, short] = await Promise.all([pick("LONG", 15), missionId ? pick("MID", 10, missionId) : Promise.resolve([]), pick("SHORT", 5)]);
  const block = (title: string, rows: { content: string }[]) => (rows.length ? `${title}\n${rows.map((r) => `- ${r.content}`).join("\n")}` : "");
  const text = [block("교훈 (장기)", long), block("이 미션에서 (중기)", mid), block("최근 일 (단기)", short)].filter(Boolean).join("\n\n");
  return text ? `${text.slice(0, 4000)}\n(기억은 참고용이다. 사용자 지시와 다르면 사용자 지시를 따른다.)` : "";
}
