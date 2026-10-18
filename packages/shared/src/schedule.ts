// F106 스케줄: 반복 미션·예약 지시·근무 시간 (2026-10-18 결정)
// - 시간은 한국 시간(KST, UTC+9 고정) 기준
// - 근무 시간 밖에는 예약 실행과 에이전트끼리의 일을 멈추고, 사용자가 직접 내린 지시·미션은 언제든 처리한다
// - 반복 미션의 이전 회차가 안 끝났으면 이번 회차는 건너뛰고 알린다
import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import { writeAudit } from "./audit";
import type { AnyDb } from "./db/client";
import { agents, messages, missions, organizations, schedules } from "./db/schema";
import { AUTONOMY_LABEL, type Autonomy, type MissionMessagePayload } from "./missions";
import { notifyOrgOwner } from "./push";

const KST_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Schedule = typeof schedules.$inferSelect;
export type Repeat = Schedule["repeat"];

export const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"] as const;
export const REPEAT_LABEL: Record<Repeat, string> = { ONCE: "한 번", DAILY: "매일", WEEKLY: "매주", MONTHLY: "매월" };

/** 근무 시간 (organizations.work_hours). 없거나 꺼져 있으면 항상 근무 */
export interface WorkHours {
  enabled: boolean;
  days: number[]; // 0=일 … 6=토
  start: string; // "09:00"
  end: string; // "18:00"
}

/** 미션 반복의 내용 (schedules.spec, kind=MISSION) */
export interface MissionSpec {
  topic: string;
  goal?: string | null;
  successCriteria?: string[];
  outputFormat?: string;
  budgetLimit?: number;
  autonomy?: Autonomy;
  priority?: number;
  referenceNotes?: string | null;
}

/** 지시 예약의 내용 (schedules.spec, kind=DIRECTIVE) */
export interface DirectiveSpec {
  content: string;
}

// ── 시간 계산 (KST) ─────────────────────────────────────

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** KST 날짜(그날 0시의 UTC 시각)와 요일·일 */
function kstDay(t: Date) {
  const k = new Date(t.getTime() + KST_MS);
  const midnightUtc = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST_MS;
  return { midnight: midnightUtc, weekday: k.getUTCDay(), date: k.getUTCDate(), minutes: k.getUTCHours() * 60 + k.getUTCMinutes() };
}

/** "YYYY-MM-DD" + "HH:MM" (KST) → Date */
export function kstDateTime(date: string, hhmm: string): Date {
  return new Date(new Date(`${date}T00:00:00+09:00`).getTime() + minutesOf(hhmm) * 60_000);
}

/** from 이후(초과) 첫 실행 시각. 한 번 실행이 이미 지났으면 null */
export function computeNextRun(s: Pick<Schedule, "repeat" | "time" | "weekdays" | "dayOfMonth" | "runDate">, from: Date): Date | null {
  if (s.repeat === "ONCE") {
    if (!s.runDate) return null;
    const at = kstDateTime(s.runDate, s.time);
    return at.getTime() > from.getTime() ? at : null;
  }
  const minutes = minutesOf(s.time);
  const start = kstDay(from).midnight;
  for (let i = 0; i <= 62; i++) {
    const dayMidnight = start + i * DAY_MS;
    const at = new Date(dayMidnight + minutes * 60_000);
    if (at.getTime() <= from.getTime()) continue;
    const d = kstDay(new Date(dayMidnight + 60_000));
    if (s.repeat === "DAILY") return at;
    if (s.repeat === "WEEKLY" && (s.weekdays ?? []).includes(d.weekday)) return at;
    if (s.repeat === "MONTHLY" && d.date === (s.dayOfMonth ?? 1)) return at;
  }
  return null;
}

export function parseWorkHours(raw: unknown): WorkHours | null {
  const w = raw as Partial<WorkHours> | null;
  // 근무 요일이 하나도 없으면 제한하지 않는다 (예약이 영원히 미뤄지지 않게)
  if (!w?.enabled || !Array.isArray(w.days) || w.days.length === 0 || !w.start || !w.end) return null;
  return { enabled: true, days: w.days, start: w.start, end: w.end };
}

export function isWithinWorkHours(wh: WorkHours | null, at: Date): boolean {
  if (!wh) return true;
  const d = kstDay(at);
  return wh.days.includes(d.weekday) && d.minutes >= minutesOf(wh.start) && d.minutes < minutesOf(wh.end);
}

/** at이 근무 시간이면 at, 아니면 다음 근무 시작 시각 */
export function nextWorkStart(wh: WorkHours | null, at: Date): Date {
  if (!wh || isWithinWorkHours(wh, at)) return at;
  const start = kstDay(at).midnight;
  for (let i = 0; i <= 8; i++) {
    const dayMidnight = start + i * DAY_MS;
    const open = new Date(dayMidnight + minutesOf(wh.start) * 60_000);
    if (open.getTime() > at.getTime() && wh.days.includes(kstDay(new Date(dayMidnight + 60_000)).weekday)) return open;
  }
  return at; // 근무 요일이 비어 있으면 막지 않는다
}

/** 사람이 읽는 일정 ("매주 월·수 09:00") */
export function describeSchedule(s: Pick<Schedule, "repeat" | "time" | "weekdays" | "dayOfMonth" | "runDate">): string {
  if (s.repeat === "ONCE") return `${s.runDate ?? ""} ${s.time} 한 번`;
  if (s.repeat === "DAILY") return `매일 ${s.time}`;
  if (s.repeat === "WEEKLY") return `매주 ${[...(s.weekdays ?? [])].sort().map((d) => WEEKDAY_LABEL[d]).join("·")} ${s.time}`;
  return `매월 ${s.dayOfMonth ?? 1}일 ${s.time}`;
}

// ── 근무 시간 밖 일 거르기 (worker의 다음 일 고르기에서 사용) ─────────────

/**
 * 근무 시간 밖에도 처리할 메시지인가: 사용자가 직접 보낸 것, 또는 사용자가 직접 만든 미션의 일.
 * 예약으로 만든 미션의 일과 미션 없는 에이전트·예약 지시는 근무 시간까지 기다린다.
 */
export function allowedAfterHours(msg: { senderType: string }, mission: { scheduleId: string | null } | null | undefined): boolean {
  if (msg.senderType === "USER") return true;
  return Boolean(mission) && mission!.scheduleId === null;
}

// ── 미션 시작 (사용자 화면 · 예약 공용) ──────────────────────────────

export interface StartMissionInput extends MissionSpec {
  orgId: string;
  leaderId: string;
  leaderName: string;
  deadline?: Date | null;
  scheduleId?: string | null;
  /** 누가 시작했나 — 사용자 화면이면 USER, 예약이면 SYSTEM */
  actor: { type: "USER" | "SYSTEM"; id?: string | null };
}

/** Mission 생성 → 리더에게 MISSION_START 지시 (트랜잭션 안에서). 큐 등록은 호출한 쪽에서 */
export async function startMission(tx: AnyDb, input: StartMissionInput) {
  const autonomy = input.autonomy ?? "CHECKPOINT";
  const budgetLimit = input.budgetLimit ?? 5000;
  const [m] = await tx
    .insert(missions)
    .values({
      orgId: input.orgId,
      title: input.topic.slice(0, 80),
      topic: input.topic,
      goal: input.goal ?? null,
      successCriteria: input.successCriteria ?? [],
      deadline: input.deadline ?? null,
      budgetLimit,
      priority: [0, 1, 2].includes(input.priority ?? 0) ? (input.priority ?? 0) : 0,
      outputFormat: input.outputFormat ?? "보고서",
      autonomy,
      referenceNotes: input.referenceNotes ?? null,
      leaderId: input.leaderId,
      scheduleId: input.scheduleId ?? null,
      status: "RUNNING",
    })
    .returning();
  await writeAudit(tx, {
    orgId: input.orgId,
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    action: "mission.create",
    targetType: "mission",
    targetId: m.id,
    reasoning: `미션 "${m.title}" 생성 → 리더 ${input.leaderName} (${AUTONOMY_LABEL[autonomy]}, 예산 ${budgetLimit}원)${input.scheduleId ? " · 예약 실행" : ""}`,
  });
  const payload: MissionMessagePayload = { kind: "MISSION_START" };
  const [msg] = await tx
    .insert(messages)
    .values({
      orgId: input.orgId,
      missionId: m.id,
      senderType: input.actor.type,
      receiverAgentId: input.leaderId,
      type: "DIRECTIVE",
      content: `새 미션: ${input.topic}\n계획을 세워 주세요.`,
      payload,
      priority: 100,
    })
    .returning({ id: messages.id });
  await writeAudit(tx, {
    orgId: input.orgId,
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    action: "message.directive",
    targetType: "message",
    targetId: msg.id,
    reasoning: "미션 리더에게 전달 (MISSION_START)",
  });
  return m;
}

/** 담당 리더: 정해 둔 사람이 활성이면 그 사람, 아니면 리더 직급 자동 */
export async function pickLeader(db: AnyDb, orgId: string, preferredId: string | null | undefined) {
  if (preferredId) {
    const [a] = await db.select().from(agents).where(and(eq(agents.id, preferredId), eq(agents.orgId, orgId)));
    if (a?.isActive) return a;
  }
  const [auto] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.orgId, orgId), eq(agents.rank, "LEADER"), eq(agents.isActive, true)))
    .orderBy(asc(agents.createdAt))
    .limit(1);
  return auto ?? null;
}

// ── 예약 실행 ─────────────────────────────────────────

export type FireResult = { status: "STARTED"; agentId: string; missionId?: string } | { status: "SKIPPED"; reason: string };

/**
 * 스케줄 한 번 실행. manual=true는 사용자가 '지금 실행'을 누른 것 (근무 시간·긴급 정지와 무관하게 사용자 행동으로 기록).
 * 큐 등록은 결과의 agentId로 호출한 쪽에서 한다.
 */
export async function fireSchedule(db: AnyDb, s: Schedule, opts: { manual?: boolean; userId?: string } = {}): Promise<FireResult> {
  const actor = opts.manual ? { type: "USER" as const, id: opts.userId } : { type: "SYSTEM" as const };
  const [org] = await db.select().from(organizations).where(eq(organizations.id, s.orgId));
  if (!org) return { status: "SKIPPED", reason: "조직 없음" };
  if (org.emergencyStop && !opts.manual) return { status: "SKIPPED", reason: "긴급 정지 중이라 건너뜀" };

  if (s.kind === "MISSION") {
    if (s.lastMissionId) {
      const [prev] = await db.select({ status: missions.status }).from(missions).where(eq(missions.id, s.lastMissionId));
      if (prev && ["RUNNING", "PAUSED", "REVIEW"].includes(prev.status)) return { status: "SKIPPED", reason: "이전 회차 미션이 아직 진행 중이라 건너뜀" };
    }
    const spec = s.spec as MissionSpec;
    const leader = await pickLeader(db, s.orgId, s.agentId);
    if (!leader) return { status: "SKIPPED", reason: "미션을 맡을 리더가 없어 건너뜀" };
    const mission = await db.transaction((tx) => startMission(tx, { ...spec, orgId: s.orgId, leaderId: leader.id, leaderName: leader.name, scheduleId: s.id, actor }));
    return { status: "STARTED", agentId: leader.id, missionId: mission.id };
  }

  const spec = s.spec as DirectiveSpec;
  const [agent] = s.agentId ? await db.select().from(agents).where(eq(agents.id, s.agentId)) : [];
  if (!agent?.isActive) return { status: "SKIPPED", reason: "지시를 받을 에이전트가 없거나 해고되어 건너뜀" };
  await db.transaction(async (tx) => {
    const [msg] = await tx
      .insert(messages)
      .values({
        orgId: s.orgId,
        senderType: actor.type,
        receiverAgentId: agent.id,
        type: "DIRECTIVE",
        content: spec.content,
        payload: { scheduleId: s.id },
        priority: opts.manual ? 100 : 50,
      })
      .returning({ id: messages.id });
    await writeAudit(tx, {
      orgId: s.orgId,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: "message.directive",
      targetType: "message",
      targetId: msg.id,
      reasoning: `예약 지시 "${s.title}" → ${agent.name}`,
    });
  });
  return { status: "STARTED", agentId: agent.id };
}

/** 실행 결과를 스케줄에 기록하고 다음 실행 시각을 정한다 (+ 감사 로그, 건너뛰면 알림) */
export async function recordRun(db: AnyDb, s: Schedule, result: FireResult, now: Date, opts: { manual?: boolean; userId?: string } = {}) {
  const next = s.repeat === "ONCE" ? null : computeNextRun(s, now);
  const text = result.status === "STARTED" ? (result.missionId ? "미션 시작" : "지시 보냄") : result.reason;
  await db.transaction(async (tx) => {
    await tx
      .update(schedules)
      .set({
        lastRunAt: now,
        lastResult: text,
        ...(result.status === "STARTED" && result.missionId ? { lastMissionId: result.missionId } : {}),
        // 수동 실행은 정해진 다음 시각을 바꾸지 않는다
        ...(opts.manual ? {} : { nextRunAt: next, enabled: s.repeat === "ONCE" ? false : s.enabled }),
      })
      .where(eq(schedules.id, s.id));
    await writeAudit(tx, {
      orgId: s.orgId,
      actorType: opts.manual ? "USER" : "SYSTEM",
      actorId: opts.manual ? (opts.userId ?? null) : null,
      action: result.status === "STARTED" ? "schedule.run" : "schedule.skip",
      targetType: "schedule",
      targetId: s.id,
      reasoning: `"${s.title}" ${opts.manual ? "지금 실행" : describeSchedule(s)} — ${text}`,
      payload: { missionId: result.status === "STARTED" ? (result.missionId ?? null) : null, next: next?.toISOString() ?? null },
    });
  });
  if (result.status === "SKIPPED" && !opts.manual) {
    await notifyOrgOwner(db, s.orgId, { title: "⏭️ 예약 건너뜀", body: `${s.title}: ${result.reason}`, url: "/schedules", tag: `schedule-${s.id}` });
  }
}

/**
 * 워커가 1분마다 부른다: 실행 시각이 된 스케줄을 실행한다.
 * 근무 시간 밖이면 실행하지 않고 다음 근무 시작으로 미룬다. 큐에 넣을 에이전트들을 돌려준다.
 */
export async function runDueSchedules(db: AnyDb, now = new Date()): Promise<{ orgId: string; agentId: string }[]> {
  const due = await db
    .select({ s: schedules, workHours: organizations.workHours })
    .from(schedules)
    .innerJoin(organizations, eq(organizations.id, schedules.orgId))
    .where(and(eq(schedules.enabled, true), isNotNull(schedules.nextRunAt), lte(schedules.nextRunAt, now)));
  const jobs: { orgId: string; agentId: string }[] = [];
  for (const { s, workHours } of due) {
    const wh = parseWorkHours(workHours);
    if (!isWithinWorkHours(wh, now)) {
      const later = nextWorkStart(wh, now);
      await db.update(schedules).set({ nextRunAt: later }).where(eq(schedules.id, s.id));
      await writeAudit(db, {
        orgId: s.orgId,
        actorType: "SYSTEM",
        action: "schedule.postpone",
        targetType: "schedule",
        targetId: s.id,
        reasoning: `"${s.title}" 근무 시간 밖이라 ${later.toISOString()}로 미룸`,
      });
      continue;
    }
    // 같은 회차를 두 번 실행하지 않도록 먼저 다음 시각으로 옮긴다 (실행 중 오류가 나도 반복되지 않게)
    const claimed = await db
      .update(schedules)
      .set({ nextRunAt: s.repeat === "ONCE" ? null : computeNextRun(s, now) })
      .where(and(eq(schedules.id, s.id), eq(schedules.nextRunAt, s.nextRunAt!)))
      .returning({ id: schedules.id });
    if (claimed.length === 0) continue;
    try {
      const result = await fireSchedule(db, s);
      await recordRun(db, s, result, now);
      if (result.status === "STARTED") jobs.push({ orgId: s.orgId, agentId: result.agentId });
    } catch (e) {
      await recordRun(db, s, { status: "SKIPPED", reason: `실행 오류: ${(e as Error).message}` }, now);
    }
  }
  return jobs;
}
