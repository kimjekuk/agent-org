import { AGENT_QUEUE, APP_NAME } from "@agentorg/shared";
import { getDb } from "@agentorg/shared/db";
import type { RunAgentJob } from "@agentorg/shared/queue";
import { Worker } from "bullmq";
import { runAgent } from "./loops/member";

const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };

// 에이전트 실행 작업. 사용자 1명 MVP라 한 번에 하나씩 처리한다 (같은 에이전트가 동시에 두 번 돌지 않게).
const worker = new Worker<RunAgentJob>(
  AGENT_QUEUE,
  async (job) => {
    if (job.name !== "run-agent") return;
    const result = await runAgent(getDb(), job.data);
    console.log(`[worker] 에이전트 ${job.data.agentId}: 지시 ${result.turns}건 처리${result.stopped ? `, 멈춤(${result.stopped})` : ""}`);
  },
  { connection, concurrency: 1 },
);

worker.on("ready", () => console.log(`[worker] ${APP_NAME} 워커 준비됨 — 큐 "${AGENT_QUEUE}" 대기 중`));
worker.on("failed", (job, err) => console.error(`[worker] 작업 실패 (${job?.data.agentId}): ${err.message}`));
worker.on("error", (err) => {
  const code = (err as { code?: string }).code;
  console.error(`[worker] Redis 연결 오류: ${err.message || code || err.name}`);
});

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} 수신 — 종료`);
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
