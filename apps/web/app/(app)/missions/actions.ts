"use server";

// F006 미션 생성 · F010 미션 상세의 사용자 조작. 모든 변경은 AuditLog에 기록한다 (CLAUDE.md 절대 규칙 4).
import { writeAudit } from "@agentorg/shared/audit";
import { type AnyDb, getDb, schema } from "@agentorg/shared/db";
import { publishOrgEvent } from "@agentorg/shared/events";
import { AUTONOMY_LABEL, type Autonomy, type MissionMessagePayload, OUTPUT_FORMATS } from "@agentorg/shared/missions";
import { agentsWithPendingDirectives, enqueueAgentRun } from "@agentorg/shared/queue";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOrgAgent } from "@/lib/agents";
import { getOrgMission } from "@/lib/missions";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export type FormState = { error?: string; ok?: string } | undefined;

async function context() {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) redirect("/settings");
  return { user, org };
}

const AUTONOMIES = Object.keys(AUTONOMY_LABEL) as Autonomy[];

/** 리더에게 미션 메시지를 보내고 큐에 넣는다 (미션 시작·사용자 메모·Task 이동) */
async function messageLeader(
  tx: AnyDb,
  orgId: string,
  userId: string,
  missionId: string,
  leaderId: string,
  kind: MissionMessagePayload["kind"],
  content: string,
) {
  const payload: MissionMessagePayload = { kind };
  const [msg] = await tx
    .insert(schema.messages)
    .values({ orgId, missionId, senderType: "USER", receiverAgentId: leaderId, type: "DIRECTIVE", content, payload, priority: 100 })
    .returning({ id: schema.messages.id });
  await writeAudit(tx, {
    orgId,
    actorType: "USER",
    actorId: userId,
    action: "message.directive",
    targetType: "message",
    targetId: msg.id,
    reasoning: `미션 리더에게 전달 (${kind})`,
  });
}

// ── F006 미션 생성 ─────────────────────────────────────────

export async function createMission(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, org } = await context();
  const topic = String(form.get("topic") ?? "").trim();
  if (topic.length < 2 || topic.length > 200) return { error: "주제는 2~200자로 입력해 주세요" };
  const goal = String(form.get("goal") ?? "").trim().slice(0, 1000) || null;
  const successCriteria = String(form.get("criteria") ?? "")
    .split("\n")
    .map((s) => s.replace(/^[-*\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 10);
  const deadlineRaw = String(form.get("deadline") ?? "");
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(deadlineRaw) ? new Date(`${deadlineRaw}T23:59:59+09:00`) : null;
  const budgetLimit = Number(form.get("budgetLimit"));
  if (!Number.isInteger(budgetLimit) || budgetLimit < 100 || budgetLimit > 1000000) return { error: "예산 한도는 100~1,000,000원으로 입력해 주세요" };
  const priority = Number(form.get("priority"));
  const outputFormat = String(form.get("outputFormat"));
  if (!(OUTPUT_FORMATS as readonly string[]).includes(outputFormat)) return { error: "산출물 형식을 골라 주세요" };
  const autonomy = String(form.get("autonomy")) as Autonomy;
  if (!AUTONOMIES.includes(autonomy)) return { error: "자율성 수준을 골라 주세요" };
  const referenceNotes = String(form.get("references") ?? "").trim().slice(0, 8000) || null;

  // 담당: 고르지 않으면 리더 자동 지정
  const db = getDb();
  const leaderRaw = String(form.get("leaderId") ?? "");
  let leader = leaderRaw ? await getOrgAgent(org.id, leaderRaw) : null;
  if (!leader) {
    const [auto] = await db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.orgId, org.id), eq(schema.agents.rank, "LEADER"), eq(schema.agents.isActive, true)))
      .orderBy(asc(schema.agents.createdAt))
      .limit(1);
    leader = auto ?? null;
  }
  if (!leader || !leader.isActive) return { error: "미션을 맡을 리더가 없습니다. 에이전트 화면에서 리더를 채용해 주세요" };

  const mission = await db.transaction(async (tx) => {
    const [m] = await tx
      .insert(schema.missions)
      .values({
        orgId: org.id,
        title: topic.slice(0, 80),
        topic,
        goal,
        successCriteria,
        deadline,
        budgetLimit,
        priority: [0, 1, 2].includes(priority) ? priority : 0,
        outputFormat,
        autonomy,
        referenceNotes,
        leaderId: leader.id,
        status: "RUNNING",
      })
      .returning();
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "mission.create",
      targetType: "mission",
      targetId: m.id,
      reasoning: `미션 "${m.title}" 생성 → 리더 ${leader.name} (${AUTONOMY_LABEL[autonomy]}, 예산 ${budgetLimit}원)`,
    });
    await messageLeader(tx, org.id, user.id, m.id, leader.id, "MISSION_START", `새 미션: ${topic}\n계획을 세워 주세요.`);
    return m;
  });
  await enqueueAgentRun({ orgId: org.id, agentId: leader.id });
  await publishOrgEvent(org.id, { type: "mission", missionId: mission.id });
  redirect(`/missions/${mission.id}`);
}

// ── F010 미션 헤더: 일시정지 · 재개 · 취소 · 자율성 · 예산 ───────────────────────

async function missionFromForm(form: FormData) {
  const { user, org } = await context();
  const mission = await getOrgMission(org.id, String(form.get("id")));
  return { user, org, mission };
}

async function setMissionStatus(form: FormData, from: string[], to: "PAUSED" | "RUNNING", action: string, reasoning: string) {
  const { user, org, mission } = await missionFromForm(form);
  if (!mission || !from.includes(mission.status)) return;
  await getDb().transaction(async (tx) => {
    await tx.update(schema.missions).set({ status: to }).where(eq(schema.missions.id, mission.id));
    await writeAudit(tx, { orgId: org.id, actorType: "USER", actorId: user.id, action, targetType: "mission", targetId: mission.id, reasoning });
  });
  if (to === "RUNNING") for (const job of await agentsWithPendingDirectives(getDb(), org.id)) await enqueueAgentRun(job);
  await publishOrgEvent(org.id, { type: "mission", missionId: mission.id });
  revalidatePath(`/missions/${mission.id}`);
}

export async function pauseMission(form: FormData) {
  await setMissionStatus(form, ["RUNNING"], "PAUSED", "mission.pause", "사용자가 미션을 일시정지했습니다 (진행 중인 Task는 끝까지 하고 멈춤)");
}

export async function resumeMission(form: FormData) {
  await setMissionStatus(form, ["PAUSED"], "RUNNING", "mission.resume", "사용자가 미션을 재개했습니다");
}

export async function cancelMission(form: FormData) {
  const { user, org, mission } = await missionFromForm(form);
  if (!mission || mission.status === "DONE" || mission.status === "CANCELLED") return;
  await getDb().transaction(async (tx) => {
    await tx.update(schema.missions).set({ status: "CANCELLED" }).where(eq(schema.missions.id, mission.id));
    // 남은 지시·보고는 처리하지 않는다
    await tx
      .update(schema.messages)
      .set({ readAt: new Date() })
      .where(and(eq(schema.messages.missionId, mission.id), isNull(schema.messages.readAt)));
    await tx
      .update(schema.approvalRequests)
      .set({ status: "REJECTED", decidedAt: new Date(), userComment: "미션 취소로 자동 종료" })
      .where(and(eq(schema.approvalRequests.missionId, mission.id), inArray(schema.approvalRequests.status, ["PENDING", "HELD"])));
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "mission.cancel",
      targetType: "mission",
      targetId: mission.id,
      reasoning: "사용자가 미션을 취소했습니다 (남은 지시·승인 요청 종료)",
    });
  });
  await publishOrgEvent(org.id, { type: "mission", missionId: mission.id });
  await publishOrgEvent(org.id, { type: "approval" });
  revalidatePath(`/missions/${mission.id}`);
}

export async function updateMissionSettings(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, org, mission } = await missionFromForm(form);
  if (!mission) return { error: "미션을 찾을 수 없습니다" };
  const autonomy = String(form.get("autonomy")) as Autonomy;
  if (!AUTONOMIES.includes(autonomy)) return { error: "자율성 수준을 골라 주세요" };
  const budgetLimit = Number(form.get("budgetLimit"));
  if (!Number.isInteger(budgetLimit) || budgetLimit < 0 || budgetLimit > 1000000) return { error: "예산 한도는 0~1,000,000원으로 입력해 주세요" };

  const changes = { autonomy, budgetLimit };
  await getDb().transaction(async (tx) => {
    await tx.update(schema.missions).set(changes).where(eq(schema.missions.id, mission.id));
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "mission.update",
      targetType: "mission",
      targetId: mission.id,
      reasoning: `자율성 ${AUTONOMY_LABEL[autonomy]}, 예산 한도 ${budgetLimit}원`,
      payload: { from: { autonomy: mission.autonomy, budgetLimit: mission.budgetLimit }, to: changes },
    });
  });
  await publishOrgEvent(org.id, { type: "mission", missionId: mission.id });
  revalidatePath(`/missions/${mission.id}`);
  return { ok: "저장했습니다" };
}

// ── F010 칸반: 사용자가 Task 강제 이동 (모바일은 탭 → 메뉴, PRD F017) ──────────────

export async function moveTask(form: FormData) {
  const { user, org, mission } = await missionFromForm(form);
  if (!mission || mission.status === "DONE" || mission.status === "CANCELLED") return;
  const to = String(form.get("to"));
  if (to !== "TODO" && to !== "DONE") return;
  const [task] = await getDb()
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, String(form.get("taskId"))), eq(schema.tasks.missionId, mission.id)));
  if (!task || task.status === to) return;

  const label = to === "DONE" ? "완료" : "할 일";
  await getDb().transaction(async (tx) => {
    await tx.update(schema.tasks).set({ status: to, ...(to === "TODO" ? { failCount: 0, rejectCount: 0 } : {}) }).where(eq(schema.tasks.id, task.id));
    // 담당에게 가 있던 지시는 거둔다 (다시 하게 되면 리더가 새로 지시)
    await tx
      .update(schema.messages)
      .set({ readAt: new Date() })
      .where(and(eq(schema.messages.taskId, task.id), eq(schema.messages.type, "DIRECTIVE"), isNull(schema.messages.readAt)));
    // 이 Task에 걸린 승인 요청(결과 승인·실패 질문)은 사용자가 직접 정리했으므로 닫는다
    await tx
      .update(schema.approvalRequests)
      .set({ status: "REJECTED", decidedAt: new Date(), userComment: `사용자가 Task를 ${label}(으)로 옮겨 종료` })
      .where(and(eq(schema.approvalRequests.taskId, task.id), inArray(schema.approvalRequests.status, ["PENDING", "HELD"])));
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "task.move",
      targetType: "task",
      targetId: task.id,
      reasoning: `사용자가 "${task.title}"을(를) ${label}(으)로 옮겼습니다`,
      payload: { from: task.status, to },
    });
    if (mission.leaderId) await messageLeader(tx, org.id, user.id, mission.id, mission.leaderId, "TASK_MOVED", `"${task.title}"을(를) ${label}(으)로 옮겼습니다.`);
  });
  if (mission.leaderId) await enqueueAgentRun({ orgId: org.id, agentId: mission.leaderId });
  await publishOrgEvent(org.id, { type: "mission", missionId: mission.id });
  revalidatePath(`/missions/${mission.id}`);
}

// ── F010 대화 로그: 사용자가 끼어들기 → 리더에게 ─────────────────────────────

export async function sendMissionNote(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, org, mission } = await missionFromForm(form);
  if (!mission?.leaderId) return { error: "미션 리더가 없습니다" };
  if (mission.status === "CANCELLED") return { error: "취소된 미션입니다" };
  const content = String(form.get("content") ?? "").trim();
  if (content.length < 1 || content.length > 2000) return { error: "메시지는 1~2,000자로 입력해 주세요" };
  await getDb().transaction((tx) => messageLeader(tx, org.id, user.id, mission.id, mission.leaderId!, "NOTE", content));
  const queued = await enqueueAgentRun({ orgId: org.id, agentId: mission.leaderId });
  await publishOrgEvent(org.id, { type: "message", agentId: mission.leaderId });
  revalidatePath(`/missions/${mission.id}`);
  const notes = [];
  if (!queued) notes.push("작업 대기열 연결이 늦어 최대 2분 뒤 전달됩니다");
  if (org.emergencyStop) notes.push("긴급 정지 중이라 재개하면 전달됩니다");
  if (mission.status === "PAUSED") notes.push("일시정지 중이라 재개하면 전달됩니다");
  return { ok: notes.length ? `보냈습니다. ${notes.join(", ")}.` : "리더에게 보냈습니다. 이후 Task 지시에도 함께 전달됩니다." };
}
