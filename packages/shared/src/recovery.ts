// F109 체크포인트 재개: '진행 중'인데 아무도 일하지 않는 미션을 찾아, 마지막으로 끝난 단계 다음부터 리더가 이어서 진행한다.
// 멈춤 = 처리 안 된 미션 메시지 없음 + 대기 중인 승인 없음 + 마지막 활동 후 일정 시간 지남 (서버 재시작·처리 도중 오류 대비)
// 워커는 2분마다 자동으로 (2026-10-18 결정: 자동 재개), 미션 화면의 '재개' 버튼은 바로 확인한다.
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { writeAudit } from "./audit";
import type { AnyDb } from "./db/client";
import { approvalRequests, messages, missions, organizations } from "./db/schema";
import { type MissionMessagePayload, missionKind } from "./missions";
import type { RunAgentJob } from "./queue";

/** 마지막 활동 후 이만큼 조용하면 멈춘 것으로 본다 */
export const STALL_MS = 10 * 60 * 1000;

type Mission = typeof missions.$inferSelect;

/**
 * 이 미션이 멈췄는가. auto(워커 자동 점검)면 마지막 활동이 STALL_MS보다 오래됐고,
 * 직전에 이미 재개를 시도했는데 그 뒤로 아무 진행이 없으면 다시 시도하지 않는다 (같은 재개를 되풀이하지 않게).
 */
export async function isStalled(db: AnyDb, mission: Mission, opts: { auto: boolean; now?: Date }): Promise<boolean> {
  if (mission.status !== "RUNNING" || !mission.leaderId) return false;
  const [unread] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.missionId, mission.id), isNull(messages.readAt), isNotNull(messages.receiverAgentId)))
    .limit(1);
  if (unread) return false;
  const [open] = await db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(and(eq(approvalRequests.missionId, mission.id), inArray(approvalRequests.status, ["PENDING", "HELD"])))
    .limit(1);
  if (open) return false;
  if (!opts.auto) return true;

  const [last] = await db
    .select({ createdAt: messages.createdAt, payload: messages.payload })
    .from(messages)
    .where(eq(messages.missionId, mission.id))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  if (last && missionKind(last.payload) === "RESUME") return false;
  const lastAt = last?.createdAt ?? mission.createdAt;
  return (opts.now ?? new Date()).getTime() - lastAt.getTime() >= STALL_MS;
}

/** 리더에게 '이어서 진행'을 보낸다. 큐에 넣을 작업을 돌려준다 */
export async function resumeMission(db: AnyDb, mission: Mission, actor: { type: "USER" | "SYSTEM"; id?: string | null }): Promise<RunAgentJob> {
  const payload: MissionMessagePayload = { kind: "RESUME" };
  await db.transaction(async (tx) => {
    const [msg] = await tx
      .insert(messages)
      .values({
        orgId: mission.orgId,
        missionId: mission.id,
        senderType: "SYSTEM",
        receiverAgentId: mission.leaderId,
        type: "DIRECTIVE",
        content: "멈춘 미션을 마지막으로 끝난 단계 다음부터 이어서 진행합니다.",
        payload,
        priority: 50,
      })
      .returning({ id: messages.id });
    await writeAudit(tx, {
      orgId: mission.orgId,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: "mission.resume_stalled",
      targetType: "mission",
      targetId: mission.id,
      reasoning: actor.type === "SYSTEM" ? `진행 중인데 ${STALL_MS / 60000}분 넘게 아무 일도 없어 자동으로 이어서 진행` : "재개하면서 멈춘 단계를 이어서 진행",
      payload: { messageId: msg.id },
    });
  });
  return { orgId: mission.orgId, agentId: mission.leaderId! };
}

/** 워커 주기 점검: 멈춘 미션을 모두 이어서 진행한다 (긴급 정지 중인 조직은 건너뜀) */
export async function resumeStalledMissions(db: AnyDb, now = new Date()): Promise<RunAgentJob[]> {
  const running = await db
    .select({ mission: missions })
    .from(missions)
    .innerJoin(organizations, eq(organizations.id, missions.orgId))
    .where(and(eq(missions.status, "RUNNING"), isNotNull(missions.leaderId), eq(organizations.emergencyStop, false)));
  const jobs: RunAgentJob[] = [];
  for (const { mission } of running) {
    if (await isStalled(db, mission, { auto: true, now })) jobs.push(await resumeMission(db, mission, { type: "SYSTEM" }));
  }
  return jobs;
}
