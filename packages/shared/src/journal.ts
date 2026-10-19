// F103 하루 일지 (2026-10-18 결정: AI 호출 없이 하루 기록을 자동으로 모아 보여 준다)
// 하루 = 한국 시간 0시~24시. 처리한 지시·보고, 실패, 만든 산출물, 끝낸 Task, 참여 미션, 새 기억, AI 호출·비용
import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { AnyDb } from "./db/client";
import { artifacts, costLogs, memories, messages, missions, tasks } from "./db/schema";

const KST_MS = 9 * 60 * 60 * 1000;

/** "YYYY-MM-DD"(한국 날짜)의 시작·끝 시각. 잘못된 값이면 오늘 */
export function kstDayRange(day?: string | null, now = new Date()): { day: string; start: Date; end: Date } {
  const valid = day && /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00+09:00`));
  const key = valid ? day! : new Date(now.getTime() + KST_MS).toISOString().slice(0, 10);
  const start = new Date(`${key}T00:00:00+09:00`);
  return { day: key, start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** 하루 앞뒤 날짜 */
export function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface DailyJournal {
  day: string;
  reports: number;
  failures: { content: string; at: Date }[];
  artifacts: { id: string; title: string; version: number; rating: number | null }[];
  tasksDone: number;
  missions: { id: string; title: string; status: string }[];
  memories: string[];
  llmCalls: number;
  costKrw: number;
  firstAt: Date | null;
  lastAt: Date | null;
}

export async function agentDailyJournal(db: AnyDb, agentId: string, day?: string | null, now = new Date()): Promise<DailyJournal> {
  const { day: key, start, end } = kstDayRange(day, now);
  const inDay = (col: typeof messages.createdAt) => and(gte(col, start), lt(col, end));

  const [sent, arts, mems, [cost]] = await Promise.all([
    db
      .select({ content: messages.content, payload: messages.payload, taskId: messages.taskId, missionId: messages.missionId, createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.senderAgentId, agentId), eq(messages.type, "REPORT"), inDay(messages.createdAt)))
      .orderBy(desc(messages.createdAt)),
    db
      .select({ id: artifacts.id, title: artifacts.title, version: artifacts.version, rating: artifacts.rating, missionId: artifacts.missionId })
      .from(artifacts)
      .where(and(eq(artifacts.agentId, agentId), gte(artifacts.createdAt, start), lt(artifacts.createdAt, end)))
      .orderBy(desc(artifacts.createdAt)),
    db
      .select({ content: memories.content })
      .from(memories)
      .where(and(eq(memories.agentId, agentId), gte(memories.createdAt, start), lt(memories.createdAt, end)))
      .orderBy(desc(memories.createdAt)),
    db
      .select({ n: count(), total: sql<string>`coalesce(sum(${costLogs.cost}), 0)`, first: sql<Date | null>`min(${costLogs.createdAt})`, last: sql<Date | null>`max(${costLogs.createdAt})` })
      .from(costLogs)
      .where(and(eq(costLogs.agentId, agentId), gte(costLogs.createdAt, start), lt(costLogs.createdAt, end))),
  ]);

  // 보낸 보고(리더라면 검토 의견·사용자 보고 포함) 중 실패 보고는 따로 센다
  const failures = sent
    .filter((m) => (m.payload as { failed?: boolean } | null)?.failed)
    .map((m) => ({ content: m.content.slice(0, 200), at: m.createdAt }));
  const reports = sent.length - failures.length;

  const taskIds = [...new Set(sent.map((m) => m.taskId).filter((x): x is string => Boolean(x)))];
  const [{ done }] = taskIds.length
    ? await db.select({ done: count() }).from(tasks).where(and(inArray(tasks.id, taskIds), eq(tasks.status, "DONE"), eq(tasks.assigneeId, agentId)))
    : [{ done: 0 }];

  const missionIds = [...new Set([...sent.map((m) => m.missionId), ...arts.map((a) => a.missionId)].filter((x): x is string => Boolean(x)))];
  const ms = missionIds.length ? await db.select({ id: missions.id, title: missions.title, status: missions.status }).from(missions).where(inArray(missions.id, missionIds)) : [];

  const toDate = (v: Date | string | null) => (v ? new Date(v) : null);
  return {
    day: key,
    reports,
    failures,
    artifacts: arts.map(({ missionId: _m, ...a }) => a),
    tasksDone: done,
    missions: ms,
    memories: mems.map((m) => m.content),
    llmCalls: cost?.n ?? 0,
    costKrw: Number(cost?.total ?? 0),
    firstAt: toDate(cost?.first ?? null),
    lastAt: toDate(cost?.last ?? null),
  };
}
