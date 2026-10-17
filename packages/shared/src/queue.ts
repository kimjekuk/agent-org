// 에이전트 작업 큐 (BullMQ). web이 지시를 저장한 뒤 run-agent 작업을 넣으면 worker가 처리한다.
// 지시는 DB에 먼저 저장되므로, 큐 등록이 실패해도 worker의 주기 점검(sweep)이 다시 찾아 처리한다.
import { Queue } from "bullmq";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import type { AnyDb } from "./db/client";
import { messages, organizations } from "./db/schema";
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

/** 처리되지 않은 지시가 있는 에이전트들 (긴급 정지 중인 조직 제외) */
export async function agentsWithPendingDirectives(db: AnyDb): Promise<RunAgentJob[]> {
  const rows = await db
    .selectDistinct({ orgId: messages.orgId, agentId: messages.receiverAgentId })
    .from(messages)
    .innerJoin(organizations, eq(organizations.id, messages.orgId))
    .where(and(eq(messages.type, "DIRECTIVE"), isNull(messages.readAt), isNotNull(messages.receiverAgentId), eq(organizations.emergencyStop, false)));
  return rows.filter((r): r is RunAgentJob => r.agentId !== null);
}
