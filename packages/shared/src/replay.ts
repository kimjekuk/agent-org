// F204 미션 리플레이 (2026-10-21 결정): 감사 로그로 미션 진행을 장면(프레임)으로 다시 만든다 → 사무실 화면에서 재생
// 장면마다 누가 어디서 무엇을 하는지(작업 중 = 책상, 회의·검토 = 회의실, 대기 = 휴게) + 그 순간의 자막
import { and, asc, eq, inArray, isNotNull, or, type SQL } from "drizzle-orm";
import type { AnyDb } from "./db/client";
import { agents, approvalRequests, auditLogs, meetings, messages, missions, tasks } from "./db/schema";
import type { OfficeActivity } from "./office";

export type ReplayStatus = "IDLE" | "WORKING" | "BLOCKED";
export interface ReplayState {
  status: ReplayStatus;
  activity: OfficeActivity | null;
}

export interface ReplayEvent {
  at: Date;
  action: string;
  actorId: string | null;
  targetId: string | null;
  reasoning: string | null;
}

export interface ReplayContext {
  leaderId: string | null;
  /** Task id → 담당 */
  assignees: Map<string, string | null>;
  /** 회의 id → 참여자 */
  participants: Map<string, string[]>;
  /** 에이전트 id → 이름 */
  names: Map<string, string>;
}

export interface ReplayFrame {
  at: Date;
  icon: string;
  text: string;
  states: Record<string, ReplayState>;
}

const WORK: ReplayState = { status: "WORKING", activity: "WORK" };
const MEET: ReplayState = { status: "WORKING", activity: "MEETING" };
const REVIEW: ReplayState = { status: "WORKING", activity: "REVIEW" };
const IDLE: ReplayState = { status: "IDLE", activity: null };
const BLOCKED: ReplayState = { status: "BLOCKED", activity: null };

const short = (s: string | null | undefined, n = 70) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** 기록 하나 → 자리 이동과 자막. 미션 진행과 관계없는 기록이면 null (장면을 만들지 않음) */
export function replayStep(e: ReplayEvent, ctx: ReplayContext): { icon: string; text: string; moves: Record<string, ReplayState> } | null {
  const who = (id: string | null | undefined) => (id ? (ctx.names.get(id) ?? "에이전트") : "사용자");
  const lead = ctx.leaderId;
  const moves: Record<string, ReplayState> = {};
  const set = (id: string | null | undefined, s: ReplayState) => {
    if (id) moves[id] = s;
  };
  switch (e.action) {
    case "mission.create":
      return { icon: "🎯", text: `미션 시작 — ${short(e.reasoning)}`, moves };
    case "mission.plan":
      set(lead, WORK);
      return { icon: "🗺️", text: `${who(lead)}: 계획 — ${short(e.reasoning)}`, moves };
    case "meeting.start":
      set(lead, MEET);
      for (const id of ctx.participants.get(e.targetId ?? "") ?? []) set(id, MEET);
      return { icon: "💬", text: short(e.reasoning), moves };
    case "meeting.turn":
      set(e.actorId, MEET);
      return { icon: "🗣️", text: `${who(e.actorId)}: ${short(e.reasoning)}`, moves };
    case "meeting.conclude":
    case "meeting.close":
      for (const id of ctx.participants.get(e.targetId ?? "") ?? []) set(id, IDLE);
      set(lead, MEET);
      return { icon: "📝", text: `${who(lead)}: ${short(e.reasoning)}`, moves };
    case "task.dispatch": {
      const to = ctx.assignees.get(e.targetId ?? "") ?? null;
      if (e.actorId && e.actorId !== to) set(e.actorId, IDLE);
      set(to, WORK);
      return { icon: "📨", text: `지시: ${short(e.reasoning)}`, moves };
    }
    case "message.report":
      if (!e.actorId) return null;
      set(e.actorId, IDLE);
      return { icon: "📄", text: `${who(e.actorId)}: ${short(e.reasoning)}`, moves };
    case "message.report_failure":
      set(e.actorId, BLOCKED);
      return { icon: "⚠️", text: `${who(e.actorId)}: ${short(e.reasoning)}`, moves };
    case "task.qa_request":
      set(e.actorId, IDLE);
      return { icon: "🔍", text: short(e.reasoning), moves };
    case "task.qa_review":
      set(e.actorId, REVIEW);
      return { icon: "🔍", text: `${who(e.actorId)}(QA): ${short(e.reasoning)}`, moves };
    case "task.review_pass":
      set(e.actorId, REVIEW);
      set(ctx.assignees.get(e.targetId ?? ""), IDLE);
      return { icon: "✅", text: `검토 통과 — ${short(e.reasoning)}`, moves };
    case "task.reject":
    case "task.reject_limit":
      set(e.actorId, REVIEW);
      return { icon: "↩️", text: `반려 — ${short(e.reasoning)}`, moves };
    case "approval.request":
      set(e.actorId, IDLE);
      return { icon: "✋", text: `승인 요청 — ${short(e.reasoning)}`, moves };
    case "approval.decide":
      return { icon: "🧑", text: `사용자 결정: ${short(e.reasoning)}`, moves };
    case "mission.finalize":
      set(lead, WORK);
      return { icon: "🧩", text: `${who(lead)}: 최종 결과 통합 — ${short(e.reasoning)}`, moves };
    case "mission.pause":
      return { icon: "⏸", text: `일시정지 — ${short(e.reasoning)}`, moves };
    case "mission.resume":
    case "mission.resume_stalled":
      return { icon: "▶️", text: `재개 — ${short(e.reasoning)}`, moves };
    case "mission.complete":
    case "mission.cancel":
      for (const id of ctx.names.keys()) set(id, IDLE);
      return { icon: e.action === "mission.complete" ? "🏁" : "✖️", text: short(e.reasoning), moves };
    default:
      return null;
  }
}

/** 기록 → 장면. 첫 장면은 모두 휴게 공간에서 시작한다 */
export function buildReplay(events: ReplayEvent[], ctx: ReplayContext): ReplayFrame[] {
  let states: Record<string, ReplayState> = Object.fromEntries([...ctx.names.keys()].map((id) => [id, IDLE]));
  const frames: ReplayFrame[] = [];
  for (const e of events) {
    const step = replayStep(e, ctx);
    if (!step) continue;
    states = { ...states, ...step.moves };
    frames.push({ at: e.at, icon: step.icon, text: step.text, states });
  }
  return frames;
}

export interface ReplayAgent {
  id: string;
  name: string;
  rank: "LEADER" | "MANAGER" | "MEMBER";
  level: number;
  avatar: unknown;
}

const REPLAY_ACTIONS = [
  "mission.create",
  "mission.plan",
  "meeting.start",
  "meeting.turn",
  "meeting.conclude",
  "meeting.close",
  "task.dispatch",
  "message.report",
  "message.report_failure",
  "task.qa_request",
  "task.qa_review",
  "task.review_pass",
  "task.reject",
  "task.reject_limit",
  "approval.request",
  "approval.decide",
  "mission.finalize",
  "mission.pause",
  "mission.resume",
  "mission.resume_stalled",
  "mission.complete",
  "mission.cancel",
];

/** 미션 하나의 리플레이: 등장 에이전트(리더 → 채용 순)와 장면들 (최대 400장면) */
export async function missionReplay(db: AnyDb, orgId: string, missionId: string): Promise<{ agents: ReplayAgent[]; frames: ReplayFrame[] } | null> {
  const [mission] = await db.select().from(missions).where(and(eq(missions.id, missionId), eq(missions.orgId, orgId)));
  if (!mission) return null;
  const [taskRows, meetingRows, approvalRows, reportRows] = await Promise.all([
    db.select({ id: tasks.id, assigneeId: tasks.assigneeId }).from(tasks).where(eq(tasks.missionId, missionId)),
    db.select({ id: meetings.id, participants: meetings.participants }).from(meetings).where(eq(meetings.missionId, missionId)),
    db.select({ id: approvalRequests.id }).from(approvalRequests).where(eq(approvalRequests.missionId, missionId)),
    db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.missionId, missionId), eq(messages.type, "REPORT"), isNotNull(messages.senderAgentId))),
  ]);
  const target = (type: string, ids: string[]): SQL | undefined => (ids.length ? and(eq(auditLogs.targetType, type), inArray(auditLogs.targetId, ids)) : undefined);
  const rows = await db
    .select({ at: auditLogs.createdAt, action: auditLogs.action, actorId: auditLogs.actorId, targetId: auditLogs.targetId, reasoning: auditLogs.reasoning })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.orgId, orgId),
        inArray(auditLogs.action, REPLAY_ACTIONS),
        or(
          and(eq(auditLogs.targetType, "mission"), eq(auditLogs.targetId, missionId)),
          target("task", taskRows.map((t) => t.id)),
          target("meeting", meetingRows.map((m) => m.id)),
          target("approval_request", approvalRows.map((a) => a.id)),
          target("message", reportRows.map((m) => m.id)),
        ),
      ),
    )
    .orderBy(asc(auditLogs.createdAt))
    .limit(400);

  const participants = new Map(meetingRows.map((m) => [m.id, (m.participants ?? []) as string[]]));
  const ids = new Set<string>([
    ...(mission.leaderId ? [mission.leaderId] : []),
    ...taskRows.map((t) => t.assigneeId).filter((x): x is string => Boolean(x)),
    ...[...participants.values()].flat(),
  ]);
  const people = await db.select().from(agents).where(eq(agents.orgId, orgId));
  for (const r of rows) if (r.actorId && people.some((p) => p.id === r.actorId)) ids.add(r.actorId);
  const cast = people
    .filter((p) => ids.has(p.id))
    .sort((a, b) => (a.id === mission.leaderId ? -1 : b.id === mission.leaderId ? 1 : a.createdAt.getTime() - b.createdAt.getTime()));

  const frames = buildReplay(
    rows.map((r) => ({ ...r, at: new Date(r.at) })),
    {
      leaderId: mission.leaderId,
      assignees: new Map(taskRows.map((t) => [t.id, t.assigneeId])),
      participants,
      names: new Map(cast.map((p) => [p.id, p.name])),
    },
  );
  return { agents: cast.map((p) => ({ id: p.id, name: p.name, rank: p.id === mission.leaderId ? "LEADER" : p.rank === "LEADER" ? "MANAGER" : p.rank, level: p.level, avatar: p.avatar })), frames };
}
