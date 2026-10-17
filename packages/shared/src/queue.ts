// 에이전트 작업 큐 (BullMQ). web이 지시를 저장한 뒤 run-agent 작업을 넣으면 worker가 처리한다.
// 지시는 DB에 먼저 저장되므로, 큐 등록이 실패해도 worker의 주기 점검(sweep)이 다시 찾아 처리한다.
import { Queue } from "bullmq";
import { and, eq, isNotNull, isNull, notInArray, or } from "drizzle-orm";
import type { AnyDb } from "./db/client";
import { messages, missions, organizations } from "./db/schema";
import { AGENT_QUEUE } from "./index";

export interface RunAgentJob {
  orgId: string;
  agentId: string;
}

let queue: Queue<RunAgentJob> | undefined;

function getQueue(): Queue<RunAgentJob> {
  queue ??= new Queue<RunAgentJob>(AGENT_QUEUE, {
    connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" },
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 },
  });
  return queue;
}

const ENQUEUE_TIMEOUT_MS = 3000;

/** 에이전트에게 처리할 메시지가 있음을 알린다. 실패하거나 3초 안에 안 되면 false (주기 점검이 처리). */
export async function enqueueAgentRun(job: RunAgentJob): Promise<boolean> {
  try {
    await Promise.race([
      getQueue().add("run-agent", job),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ENQUEUE_TIMEOUT_MS)),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * 처리할 일이 남은 에이전트들: 읽지 않은 지시, 또는 리더가 검토할 Task 보고.
 * 긴급 정지 중인 조직과 일시정지·취소된 미션은 제외한다.
 */
export async function agentsWithPendingDirectives(db: AnyDb, orgId?: string): Promise<RunAgentJob[]> {
  const rows = await db
    .selectDistinct({ orgId: messages.orgId, agentId: messages.receiverAgentId })
    .from(messages)
    .innerJoin(organizations, eq(organizations.id, messages.orgId))
    .leftJoin(missions, eq(missions.id, messages.missionId))
    .where(
      and(
        orgId ? eq(messages.orgId, orgId) : undefined,
        isNull(messages.readAt),
        isNotNull(messages.receiverAgentId),
        eq(organizations.emergencyStop, false),
        or(eq(messages.type, "DIRECTIVE"), and(eq(messages.type, "REPORT"), isNotNull(messages.taskId))),
        or(isNull(missions.id), notInArray(missions.status, ["PAUSED", "CANCELLED"])),
      ),
    );
  return rows.filter((r): r is RunAgentJob => r.agentId !== null);
}
