import { AGENT_QUEUE, APP_NAME } from "@agentorg/shared";
import { Worker } from "bullmq";

const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };

// 0단계: 큐 연결만 확인한다. 에이전트 루프(guards 포함)는 1-B·1-C 단계에서 추가.
const worker = new Worker(
  AGENT_QUEUE,
  async (job) => {
    console.log(`[worker] 작업 수신 (처리 로직 없음): ${job.name}`);
  },
  { connection },
);

worker.on("ready", () => console.log(`[worker] ${APP_NAME} 워커 준비됨 — 큐 "${AGENT_QUEUE}" 대기 중`));
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
