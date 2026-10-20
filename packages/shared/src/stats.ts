// F203 통계 대시보드 (2026-10-20 결정): 비용(날짜·에이전트·모델) · 생산성(끝낸 일·검토 통과율·별점) · 병목(승인 대기·오래 걸린 Task) · 미션 요약
// 기간 = 오늘 / 7일 / 30일 (한국 날짜 기준). AI 호출 없이 기록(cost_logs·audit_logs·tasks·artifacts)만 모은다
import { and, avg, count, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { AnyDb } from "./db/client";
import { agents, approvalRequests, artifacts, auditLogs, costLogs, messages, missions, tasks } from "./db/schema";
import { kstDayRange, shiftDay } from "./journal";

export type StatsPeriod = "today" | "7d" | "30d";
export const STATS_PERIODS: { key: StatsPeriod; label: string; days: number }[] = [
  { key: "today", label: "오늘", days: 1 },
  { key: "7d", label: "7일", days: 7 },
  { key: "30d", label: "30일", days: 30 },
];

export interface StatsRange {
  period: StatsPeriod;
  start: Date;
  end: Date;
  /** 한국 날짜 (오래된 것부터) */
  days: string[];
}

export function statsRange(period: string | null | undefined, now = new Date()): StatsRange {
  const p = STATS_PERIODS.find((x) => x.key === period) ?? STATS_PERIODS[1];
  const today = kstDayRange(null, now);
  const days = Array.from({ length: p.days }, (_, i) => shiftDay(today.day, i - (p.days - 1)));
  return { period: p.key, start: kstDayRange(days[0]).start, end: today.end, days };
}

const KST_DAY = (col: unknown) => sql<string>`to_char(${col} at time zone 'Asia/Seoul', 'YYYY-MM-DD')`;
const num = (v: unknown) => Number(v ?? 0);

export interface CostRow {
  key: string;
  label: string;
  krw: number;
  calls: number;
}

export interface CostStats {
  totalKrw: number;
  calls: number;
  byDay: { day: string; krw: number; calls: number }[];
  byAgent: CostRow[];
  byModel: CostRow[];
}

export async function costStats(db: AnyDb, orgId: string, range: StatsRange): Promise<CostStats> {
  const inRange = and(eq(costLogs.orgId, orgId), gte(costLogs.createdAt, range.start), lt(costLogs.createdAt, range.end));
  const sum = sql<string>`coalesce(sum(${costLogs.cost}), 0)`;
  const [days, byAgent, byModel] = await Promise.all([
    db.select({ day: KST_DAY(costLogs.createdAt), krw: sum, calls: count() }).from(costLogs).where(inRange).groupBy(KST_DAY(costLogs.createdAt)),
    db
      .select({ key: costLogs.agentId, label: agents.name, krw: sum, calls: count() })
      .from(costLogs)
      .leftJoin(agents, eq(agents.id, costLogs.agentId))
      .where(inRange)
      .groupBy(costLogs.agentId, agents.name),
    db.select({ key: costLogs.model, krw: sum, calls: count() }).from(costLogs).where(inRange).groupBy(costLogs.model),
  ]);
  const byDay = range.days.map((day) => {
    const d = days.find((r) => r.day === day);
    return { day, krw: num(d?.krw), calls: num(d?.calls) };
  });
  const sortDesc = (rows: CostRow[]) => rows.sort((a, b) => b.krw - a.krw || b.calls - a.calls);
  return {
    totalKrw: byDay.reduce((s, d) => s + d.krw, 0),
    calls: byDay.reduce((s, d) => s + d.calls, 0),
    byDay,
    byAgent: sortDesc(byAgent.map((r) => ({ key: r.key ?? "system", label: r.label ?? "시스템", krw: num(r.krw), calls: num(r.calls) }))),
    byModel: sortDesc(byModel.map((r) => ({ key: r.key, label: r.key, krw: num(r.krw), calls: num(r.calls) }))),
  };
}

export interface AgentProductivity {
  agentId: string;
  name: string;
  /** 검토를 통과해 끝낸 Task */
  tasksDone: number;
  rejects: number;
  failures: number;
  /** 검토 통과율 = 통과 / (통과 + 반려), 검토가 없으면 null */
  passRate: number | null;
  avgRating: number | null;
  costKrw: number;
  /** 끝낸 Task 1개당 비용 */
  costPerTask: number | null;
}

export async function productivityStats(db: AnyDb, orgId: string, range: StatsRange): Promise<AgentProductivity[]> {
  const auditIn = (action: string) => and(eq(auditLogs.orgId, orgId), eq(auditLogs.action, action), gte(auditLogs.createdAt, range.start), lt(auditLogs.createdAt, range.end));
  const byAssignee = (action: string) =>
    db
      .select({ agentId: tasks.assigneeId, n: count() })
      .from(auditLogs)
      .innerJoin(tasks, eq(sql`${tasks.id}::text`, auditLogs.targetId))
      .where(auditIn(action))
      .groupBy(tasks.assigneeId);
  const [team, passes, rejects, failures, ratings, costs] = await Promise.all([
    db.select({ id: agents.id, name: agents.name }).from(agents).where(and(eq(agents.orgId, orgId), eq(agents.isActive, true))),
    byAssignee("task.review_pass"),
    byAssignee("task.reject"),
    db
      .select({ agentId: messages.senderAgentId, n: count() })
      .from(messages)
      .where(and(eq(messages.orgId, orgId), eq(messages.type, "REPORT"), sql`${messages.payload}->>'failed' = 'true'`, gte(messages.createdAt, range.start), lt(messages.createdAt, range.end)))
      .groupBy(messages.senderAgentId),
    db
      .select({ agentId: artifacts.agentId, avg: avg(artifacts.rating) })
      .from(artifacts)
      .where(and(eq(artifacts.orgId, orgId), isNotNull(artifacts.rating), gte(artifacts.createdAt, range.start), lt(artifacts.createdAt, range.end)))
      .groupBy(artifacts.agentId),
    db
      .select({ agentId: costLogs.agentId, krw: sql<string>`coalesce(sum(${costLogs.cost}), 0)` })
      .from(costLogs)
      .where(and(eq(costLogs.orgId, orgId), gte(costLogs.createdAt, range.start), lt(costLogs.createdAt, range.end)))
      .groupBy(costLogs.agentId),
  ]);
  const pick = <T extends { agentId: string | null }>(rows: T[], id: string) => rows.find((r) => r.agentId === id);
  return team
    .map((a) => {
      const done = num(pick(passes, a.id)?.n);
      const rej = num(pick(rejects, a.id)?.n);
      const krw = num(pick(costs, a.id)?.krw);
      const rating = pick(ratings, a.id)?.avg;
      return {
        agentId: a.id,
        name: a.name,
        tasksDone: done,
        rejects: rej,
        failures: num(pick(failures, a.id)?.n),
        passRate: done + rej > 0 ? done / (done + rej) : null,
        avgRating: rating == null ? null : Number(rating),
        costKrw: krw,
        costPerTask: done > 0 ? krw / done : null,
      };
    })
    .sort((x, y) => y.tasksDone - x.tasksDone || y.costKrw - x.costKrw);
}

export interface BottleneckStats {
  /** 결정된 승인 요청의 평균·최대 대기 (분) */
  approvalAvgMin: number | null;
  approvalMaxMin: number | null;
  decided: number;
  /** 지금 기다리는 승인 요청 수와 가장 오래 기다린 시간 (분) */
  pending: number;
  pendingOldestMin: number | null;
  /** 지시부터 검토 통과까지 오래 걸린 Task (분) */
  slowTasks: { taskId: string; title: string; missionId: string; missionTitle: string; assignee: string | null; minutes: number }[];
}

export async function bottleneckStats(db: AnyDb, orgId: string, range: StatsRange, now = new Date()): Promise<BottleneckStats> {
  const minutes = (a: unknown, b: unknown) => sql<string>`extract(epoch from (${a} - ${b})) / 60`;
  const [[decided], [pending], slow] = await Promise.all([
    db
      .select({ n: count(), avgMin: sql<string | null>`avg(${minutes(approvalRequests.decidedAt, approvalRequests.createdAt)})`, maxMin: sql<string | null>`max(${minutes(approvalRequests.decidedAt, approvalRequests.createdAt)})` })
      .from(approvalRequests)
      .where(and(eq(approvalRequests.orgId, orgId), isNotNull(approvalRequests.decidedAt), gte(approvalRequests.decidedAt, range.start), lt(approvalRequests.decidedAt, range.end))),
    db
      .select({ n: count(), oldest: sql<Date | null>`min(${approvalRequests.createdAt})` })
      .from(approvalRequests)
      .where(and(eq(approvalRequests.orgId, orgId), isNull(approvalRequests.decidedAt), inArray(approvalRequests.status, ["PENDING", "HELD"]))),
    // 검토 통과 시각 - 처음 지시한 시각 (같은 Task를 다시 해도 처음부터 잰다). 날짜는 문자열로 넘긴다 (postgres 드라이버는 raw SQL의 Date를 못 받음)
    db.execute(sql`
      select t.id as task_id, t.title, m.id as mission_id, m.title as mission_title, a.name as assignee,
             extract(epoch from (p.passed_at - d.dispatched_at)) / 60 as minutes
      from (select target_id, max(created_at) as passed_at from ${auditLogs}
            where org_id = ${orgId} and action = 'task.review_pass' and created_at >= ${range.start.toISOString()}::timestamptz and created_at < ${range.end.toISOString()}::timestamptz
            group by target_id) p
      join (select target_id, min(created_at) as dispatched_at from ${auditLogs}
            where org_id = ${orgId} and action = 'task.dispatch' group by target_id) d on d.target_id = p.target_id
      join ${tasks} t on t.id::text = p.target_id
      join ${missions} m on m.id = t.mission_id
      left join ${agents} a on a.id = t.assignee_id
      order by minutes desc
      limit 5`),
  ]);
  const rows = ((slow as { rows?: unknown[] }).rows ?? (slow as unknown[])) as Record<string, unknown>[];
  const oldest = pending?.oldest ? new Date(pending.oldest) : null;
  return {
    approvalAvgMin: decided?.n ? num(decided.avgMin) : null,
    approvalMaxMin: decided?.n ? num(decided.maxMin) : null,
    decided: num(decided?.n),
    pending: num(pending?.n),
    pendingOldestMin: oldest ? (now.getTime() - oldest.getTime()) / 60000 : null,
    slowTasks: rows.map((r) => ({
      taskId: String(r.task_id),
      title: String(r.title),
      missionId: String(r.mission_id),
      missionTitle: String(r.mission_title),
      assignee: r.assignee == null ? null : String(r.assignee),
      minutes: num(r.minutes),
    })),
  };
}

export interface MissionSummary {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  /** 끝난 미션은 완료까지, 진행 중이면 지금까지 (분) */
  minutes: number;
  costKrw: number;
  calls: number;
  tasks: number;
  rating: number | null;
}

/** 기간 안에 만든 미션 (최근 것부터 20개) */
export async function missionSummaries(db: AnyDb, orgId: string, range: StatsRange, now = new Date()): Promise<MissionSummary[]> {
  const list = await db
    .select({ id: missions.id, title: missions.title, status: missions.status, createdAt: missions.createdAt })
    .from(missions)
    .where(and(eq(missions.orgId, orgId), gte(missions.createdAt, range.start), lt(missions.createdAt, range.end)))
    .orderBy(sql`${missions.createdAt} desc`)
    .limit(20);
  if (list.length === 0) return [];
  const ids = list.map((m) => m.id);
  const [costs, taskCounts, completes, finals] = await Promise.all([
    db
      .select({ missionId: costLogs.missionId, krw: sql<string>`coalesce(sum(${costLogs.cost}), 0)`, calls: count() })
      .from(costLogs)
      .where(inArray(costLogs.missionId, ids))
      .groupBy(costLogs.missionId),
    db.select({ missionId: tasks.missionId, n: count() }).from(tasks).where(inArray(tasks.missionId, ids)).groupBy(tasks.missionId),
    db
      .select({ targetId: auditLogs.targetId, at: sql<Date>`max(${auditLogs.createdAt})` })
      .from(auditLogs)
      .where(and(eq(auditLogs.orgId, orgId), inArray(auditLogs.action, ["mission.complete", "mission.cancel"]), inArray(auditLogs.targetId, ids)))
      .groupBy(auditLogs.targetId),
    db
      .select({ missionId: artifacts.missionId, rating: sql<number | null>`max(${artifacts.rating})` })
      .from(artifacts)
      .where(and(inArray(artifacts.missionId, ids), isNull(artifacts.taskId)))
      .groupBy(artifacts.missionId),
  ]);
  return list.map((m) => {
    const end = completes.find((c) => c.targetId === m.id)?.at;
    const c = costs.find((x) => x.missionId === m.id);
    const rating = finals.find((x) => x.missionId === m.id)?.rating;
    return {
      ...m,
      minutes: ((end ? new Date(end) : now).getTime() - m.createdAt.getTime()) / 60000,
      costKrw: num(c?.krw),
      calls: num(c?.calls),
      tasks: num(taskCounts.find((x) => x.missionId === m.id)?.n),
      rating: rating == null ? null : Number(rating),
    };
  });
}

/** 분 → "3분", "2시간 5분", "1일 3시간" */
export function formatMinutes(min: number | null | undefined): string {
  if (min == null || Number.isNaN(min)) return "-";
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
  return h % 24 ? `${Math.floor(h / 24)}일 ${h % 24}시간` : `${Math.floor(h / 24)}일`;
}
