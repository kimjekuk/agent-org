// F208 지시 템플릿 (2026-10-23 결정): 자주 쓰는 지시를 버튼으로. 누르면 지시칸·새 미션 칸을 채우고, 확인한 뒤 보낸다 (바로 보내지 않음).
// 기본 템플릿 몇 개 + 보낸 지시를 '템플릿으로 저장'. 위치: 대시보드 + 지시칸 위 + 새 미션 화면
import { and, asc, eq } from "drizzle-orm";
import { writeAudit } from "./audit";
import type { AnyDb } from "./db/client";
import { directiveTemplates } from "./db/schema";

export interface DirectiveTemplate {
  /** 기본 템플릿은 "default:…", 저장한 것은 uuid */
  id: string;
  title: string;
  content: string;
  builtin: boolean;
}

/** 기본 템플릿 (화면에서 t()로 번역해 보여 준다) */
export const DEFAULT_DIRECTIVE_TEMPLATES: readonly DirectiveTemplate[] = [
  {
    id: "default:market",
    title: "시장 조사",
    content: "○○ 시장의 최근 동향을 조사해 줘\n주요 업체 3곳, 성장 이유, 앞으로 1년 전망을 출처와 함께 정리",
    builtin: true,
  },
  {
    id: "default:blog",
    title: "블로그 글",
    content: "○○ 주제로 블로그 글을 써 줘\n독자는 초보자, 2,000자 안팎, 소제목 3~4개",
    builtin: true,
  },
  {
    id: "default:weekly",
    title: "주간 요약",
    content: "이번 주 ○○ 관련 소식을 요약해 줘\n중요한 것 5개를 한 줄씩, 끝에 다음 주에 볼 것",
    builtin: true,
  },
  {
    id: "default:compare",
    title: "비교표",
    content: "○○와 △△를 비교해 줘\n가격·장점·단점을 표로, 끝에 추천 한 줄",
    builtin: true,
  },
];

export const MAX_TEMPLATES = 30;
const TITLE_MAX = 20;
const CONTENT_MAX = 4000;

/** 저장한 템플릿(최근 것 뒤) + 기본 템플릿 */
export async function listDirectiveTemplates(db: AnyDb, orgId: string): Promise<DirectiveTemplate[]> {
  const rows = await db.select().from(directiveTemplates).where(eq(directiveTemplates.orgId, orgId)).orderBy(asc(directiveTemplates.createdAt));
  return [...rows.map((r) => ({ id: r.id, title: r.title, content: r.content, builtin: false })), ...DEFAULT_DIRECTIVE_TEMPLATES];
}

/** 제목이 없으면 내용 첫 줄로 */
export function templateTitle(content: string, title?: string | null): string {
  const t = (title ?? "").trim() || content.trim().split("\n")[0];
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
}

/** 새 미션 칸에 넣을 때: 첫 줄 = 주제, 나머지 = 목표 */
export function splitForMission(content: string): { topic: string; goal: string } {
  const [first, ...rest] = content.trim().split("\n");
  return { topic: first.trim().slice(0, 200), goal: rest.join("\n").trim().slice(0, 1000) };
}

export async function saveDirectiveTemplate(
  db: AnyDb,
  input: { orgId: string; userId: string; content: string; title?: string | null },
): Promise<{ error: string } | { id: string }> {
  const content = input.content.trim().slice(0, CONTENT_MAX);
  if (content.length < 2) return { error: "내용을 입력해 주세요" };
  const existing = await db.select({ id: directiveTemplates.id, content: directiveTemplates.content }).from(directiveTemplates).where(eq(directiveTemplates.orgId, input.orgId));
  const same = existing.find((r) => r.content === content);
  if (same) return { id: same.id }; // 같은 내용은 한 번만
  if (existing.length >= MAX_TEMPLATES) return { error: "템플릿은 30개까지 저장할 수 있습니다. 안 쓰는 것을 지워 주세요" };
  const title = templateTitle(content, input.title);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(directiveTemplates).values({ orgId: input.orgId, title, content }).returning({ id: directiveTemplates.id });
    await writeAudit(tx, {
      orgId: input.orgId,
      actorType: "USER",
      actorId: input.userId,
      action: "template.create",
      targetType: "directive_template",
      targetId: row.id,
      reasoning: `지시 템플릿 "${title}" 저장`,
    });
    return { id: row.id };
  });
}

export async function deleteDirectiveTemplate(db: AnyDb, input: { orgId: string; userId: string; id: string }) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(directiveTemplates)
      .where(and(eq(directiveTemplates.id, input.id), eq(directiveTemplates.orgId, input.orgId)))
      .returning({ id: directiveTemplates.id, title: directiveTemplates.title });
    if (!row) return;
    await writeAudit(tx, {
      orgId: input.orgId,
      actorType: "USER",
      actorId: input.userId,
      action: "template.delete",
      targetType: "directive_template",
      targetId: row.id,
      reasoning: `지시 템플릿 "${row.title}" 삭제`,
    });
  });
}
