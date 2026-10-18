"use server";

// F106 스케줄 화면: 반복 미션·예약 지시 만들기·켜기/끄기·지금 실행·삭제, 근무 시간. 모든 변경은 AuditLog
import { writeAudit } from "@agentorg/shared/audit";
import { getDb, schema } from "@agentorg/shared/db";
import { publishOrgEvent } from "@agentorg/shared/events";
import { AUTONOMY_LABEL, type Autonomy, OUTPUT_FORMATS } from "@agentorg/shared/missions";
import { enqueueAgentRun } from "@agentorg/shared/queue";
import { computeNextRun, describeSchedule, fireSchedule, recordRun, type Repeat, type WorkHours } from "@agentorg/shared/schedule";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOrgAgent } from "@/lib/agents";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export type FormState = { error?: string; ok?: string } | undefined;

async function context() {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) redirect("/settings");
  return { user, org };
}

const REPEATS: Repeat[] = ["ONCE", "DAILY", "WEEKLY", "MONTHLY"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function createSchedule(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, org } = await context();
  const kind = String(form.get("kind"));
  if (kind !== "MISSION" && kind !== "DIRECTIVE") return { error: "종류를 골라 주세요" };
  const repeat = String(form.get("repeat")) as Repeat;
  if (!REPEATS.includes(repeat)) return { error: "반복을 골라 주세요" };
  const time = String(form.get("time") ?? "");
  if (!TIME.test(time)) return { error: "시각을 골라 주세요 (예: 09:00)" };
  const weekdays = form.getAll("weekdays").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (repeat === "WEEKLY" && weekdays.length === 0) return { error: "요일을 하나 이상 골라 주세요" };
  const dayOfMonth = Number(form.get("dayOfMonth"));
  if (repeat === "MONTHLY" && !(Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 28)) return { error: "날짜는 1~28일 중에 골라 주세요" };
  const runDate = String(form.get("runDate") ?? "");
  if (repeat === "ONCE" && !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) return { error: "날짜를 골라 주세요" };

  let spec: unknown;
  let agentId: string | null = null;
  let title: string;
  if (kind === "MISSION") {
    const topic = String(form.get("topic") ?? "").trim();
    if (topic.length < 2 || topic.length > 200) return { error: "주제는 2~200자로 입력해 주세요" };
    const budgetLimit = Number(form.get("budgetLimit"));
    if (!Number.isInteger(budgetLimit) || budgetLimit < 100 || budgetLimit > 1000000) return { error: "회차당 예산은 100~1,000,000원으로 입력해 주세요" };
    const autonomy = String(form.get("autonomy")) as Autonomy;
    if (!(autonomy in AUTONOMY_LABEL)) return { error: "자율성 수준을 골라 주세요" };
    const outputFormat = String(form.get("outputFormat"));
    if (!(OUTPUT_FORMATS as readonly string[]).includes(outputFormat)) return { error: "산출물 형식을 골라 주세요" };
    const successCriteria = String(form.get("criteria") ?? "")
      .split("\n")
      .map((s) => s.replace(/^[-*\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 10);
    spec = { topic, goal: String(form.get("goal") ?? "").trim().slice(0, 1000) || null, successCriteria, outputFormat, budgetLimit, autonomy };
    title = topic.slice(0, 80);
  } else {
    const agent = await getOrgAgent(org.id, String(form.get("agentId") ?? ""));
    if (!agent) return { error: "지시를 받을 에이전트를 골라 주세요" };
    const content = String(form.get("content") ?? "").trim();
    if (content.length < 1 || content.length > 4000) return { error: "지시는 1~4,000자로 입력해 주세요" };
    spec = { content };
    agentId = agent.id;
    title = `${agent.name}: ${content.slice(0, 60)}`;
  }

  const when = { repeat, time, weekdays: repeat === "WEEKLY" ? weekdays : [], dayOfMonth: repeat === "MONTHLY" ? dayOfMonth : null, runDate: repeat === "ONCE" ? runDate : null };
  const nextRunAt = computeNextRun(when, new Date());
  if (!nextRunAt) return { error: "이미 지난 시각입니다. 날짜·시각을 다시 골라 주세요" };

  await getDb().transaction(async (tx) => {
    const [s] = await tx
      .insert(schema.schedules)
      .values({ orgId: org.id, kind, title, spec, agentId, ...when, nextRunAt })
      .returning();
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "schedule.create",
      targetType: "schedule",
      targetId: s.id,
      reasoning: `${kind === "MISSION" ? "반복 미션" : "예약 지시"} "${title}" — ${describeSchedule(when)}`,
    });
  });
  revalidatePath("/schedules");
  return { ok: "예약했습니다" };
}

async function ownSchedule(form: FormData) {
  const { user, org } = await context();
  const id = String(form.get("id"));
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { user, org, s: undefined };
  const [s] = await getDb()
    .select()
    .from(schema.schedules)
    .where(and(eq(schema.schedules.id, id), eq(schema.schedules.orgId, org.id)));
  return { user, org, s };
}

export async function toggleSchedule(form: FormData) {
  const { user, org, s } = await ownSchedule(form);
  if (!s) return;
  const enabling = !s.enabled;
  const nextRunAt = enabling ? computeNextRun(s, new Date()) : s.nextRunAt;
  if (enabling && !nextRunAt) return; // 이미 지난 한 번 예약은 다시 켤 수 없다
  await getDb().transaction(async (tx) => {
    await tx.update(schema.schedules).set({ enabled: enabling, nextRunAt }).where(eq(schema.schedules.id, s.id));
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: enabling ? "schedule.enable" : "schedule.disable",
      targetType: "schedule",
      targetId: s.id,
      reasoning: `"${s.title}" ${enabling ? "켬" : "끔"}`,
    });
  });
  revalidatePath("/schedules");
}

export async function deleteSchedule(form: FormData) {
  const { user, org, s } = await ownSchedule(form);
  if (!s) return;
  await getDb().transaction(async (tx) => {
    await tx.delete(schema.schedules).where(eq(schema.schedules.id, s.id));
    await writeAudit(tx, { orgId: org.id, actorType: "USER", actorId: user.id, action: "schedule.delete", targetType: "schedule", targetId: s.id, reasoning: `"${s.title}" 삭제` });
  });
  revalidatePath("/schedules");
}

/** 지금 한 번 실행 (사용자 행동이므로 근무 시간과 무관. 이전 회차가 진행 중이면 건너뜀) */
export async function runScheduleNow(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, org, s } = await ownSchedule(form);
  if (!s) return { error: "예약을 찾을 수 없습니다" };
  const db = getDb();
  const result = await fireSchedule(db, s, { manual: true, userId: user.id });
  await recordRun(db, s, result, new Date(), { manual: true, userId: user.id });
  if (result.status === "SKIPPED") return { error: result.reason };
  await enqueueAgentRun({ orgId: org.id, agentId: result.agentId });
  await publishOrgEvent(org.id, result.missionId ? { type: "mission", missionId: result.missionId } : { type: "message", agentId: result.agentId });
  revalidatePath("/schedules");
  if (result.missionId) redirect(`/missions/${result.missionId}`);
  return { ok: "지시를 보냈습니다" };
}

// ── 근무 시간 (조직 단위) ─────────────────────────────────

export async function saveWorkHours(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, org } = await context();
  const enabled = form.get("enabled") === "on";
  const days = form.getAll("days").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const start = String(form.get("start") ?? "");
  const end = String(form.get("end") ?? "");
  if (enabled) {
    if (days.length === 0) return { error: "근무 요일을 하나 이상 골라 주세요" };
    if (!TIME.test(start) || !TIME.test(end) || start >= end) return { error: "시작 시각이 끝 시각보다 빨라야 합니다" };
  }
  const workHours: WorkHours = { enabled, days, start: TIME.test(start) ? start : "09:00", end: TIME.test(end) ? end : "18:00" };
  await getDb().transaction(async (tx) => {
    await tx.update(schema.organizations).set({ workHours }).where(eq(schema.organizations.id, org.id));
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "org.work_hours",
      targetType: "organization",
      targetId: org.id,
      reasoning: enabled ? `근무 시간 ${days.length}일 ${start}~${end}` : "근무 시간 제한 끔 (항상 근무)",
      payload: workHours,
    });
  });
  revalidatePath("/schedules");
  return { ok: "저장했습니다" };
}
