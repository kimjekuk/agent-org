// 에이전트 작업 큐 (BullMQ). web이 지시를 저장한 뒤 run-agent 작업을 넣으면 worker가 처리한다.
import { Queue } from "bullmq";
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

/** 에이전트에게 처리할 메시지가 있음을 알린다. 같은 에이전트에 작업이 여러 개 쌓여도 워커가 한 번에 처리한다. */
export async function enqueueAgentRun(job: RunAgentJob): Promise<void> {
  await getQueue().add("run-agent", job);
}
