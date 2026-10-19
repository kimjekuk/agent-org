// F109 예외 처리 테스트: API 장애 대체 모델, 미션 AI 호출 상한(무한 반복 차단), 멈춘 미션 자동 재개, 리더 실패 거절 → 일시정지
import { decideApproval } from "@agentorg/shared/approval";
import { encryptSecret } from "@agentorg/shared/crypto";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import { callLLM, type GatewayCall, isTransientError, MissionCallLimitError } from "@agentorg/shared/llm/gateway";
import { ProviderHttpError } from "@agentorg/shared/llm/openaiCompatible";
import type { LLMProvider, LLMRequest } from "@agentorg/shared/llm/provider";
import type { Autonomy, MissionMessagePayload } from "@agentorg/shared/missions";
import type { RunAgentJob } from "@agentorg/shared/queue";
import { isStalled, resumeStalledMissions, STALL_MS } from "@agentorg/shared/recovery";
import { and, asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "../src/loops/member";
import { createTestDb, seed } from "./testDb";

const KEY = "88".repeat(32);
beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

let db: AnyDb;
let ctx: Awaited<ReturnType<typeof seed>>;
let calls: LLMRequest[];
/** 이 모델로 오면 던질 오류 */
let failing: Record<string, unknown>;

const PLAN = { tasks: [{ title: "조사", description: "조사", skills: ["조사"], assignee: "두리" }, { title: "정리", description: "정리", skills: ["조사"], assignee: "두리" }] };

const provider: LLMProvider = {
  name: "anthropic",
  async complete(_k, req) {
    calls.push(req);
    if (failing[req.model]) throw failing[req.model];
    const p = req.messages[0].content;
    const text = p.includes('"tasks":[')
      ? JSON.stringify(PLAN)
      : p.includes("# 검토할 Task")
        ? JSON.stringify({ pass: true, feedback: "좋음" })
        : p.includes("# 팀원 결과")
          ? "# 최종\n\n본문"
          : `# ${p.match(/# 내 Task \(\d+\/\d+\): (.+)/)?.[1] ?? "결과"} 결과\n\n본문`;
    return {
      text,
      model: req.model,
      stopReason: "end_turn",
      usage: [{ model: req.model, inputTokens: 100, outputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0 }],
      webSearchRequests: 0,
      webSearchEnabled: false,
    };
  },
};

let queue: RunAgentJob[];
const deps = { provider, publish: async () => {}, enqueue: async (j: RunAgentJob) => (queue.push(j), true) };
async function drain(limit = 50) {
  for (let i = 0; queue.length && i < limit; i++) await runAgent(db, queue.shift()!, deps);
}

beforeEach(async () => {
  db = await createTestDb();
  ctx = await seed(db, { budgetDaily: 100000 });
  calls = [];
  failing = {};
  queue = [];
  await db.insert(schema.apiKeys).values({ userId: ctx.user.id, provider: "anthropic", encryptedKey: encryptSecret("sk-ant-test", KEY) });
});

const call = (over: Partial<GatewayCall> = {}): GatewayCall => ({
  orgId: ctx.org.id,
  actor: { type: "SYSTEM" },
  purpose: "시험",
  model: "claude-sonnet-5-5",
  messages: [{ role: "user", content: "hi" }],
  ...over,
});
const overloaded = Object.assign(new Error("Overloaded"), { status: 529 });

describe("API 장애 대체 모델", () => {
  it("과부하·서버 오류·시간 초과·연결 실패만 장애로 본다 (키 오류·잘못된 요청은 아님)", () => {
    expect(isTransientError(overloaded)).toBe(true);
    expect(isTransientError(new ProviderHttpError(503, "x"))).toBe(true);
    expect(isTransientError(new ProviderHttpError(429, "x"))).toBe(true);
    expect(isTransientError(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe(true);
    expect(isTransientError(new TypeError("fetch failed"))).toBe(true);
    expect(isTransientError(new ProviderHttpError(401, "x"))).toBe(false);
    expect(isTransientError(new ProviderHttpError(400, "x"))).toBe(false);
    expect(isTransientError(new Error("계획(JSON)을 읽지 못했습니다"))).toBe(false);
  });

  it("장애면 설정의 대체 모델로 한 번 더 하고, 기록을 남긴다", async () => {
    await db.update(schema.organizations).set({ fallbackModel: "claude-haiku-5-5" }).where(eq(schema.organizations.id, ctx.org.id));
    failing["claude-sonnet-5-5"] = overloaded;
    const r = await callLLM(db, call(), provider);

    expect(r).toMatchObject({ model: "claude-haiku-5-5", fallbackFrom: "claude-sonnet-5-5" });
    expect(calls.map((c) => c.model)).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
    const [log] = await db.select().from(schema.costLogs);
    expect(log.model).toBe("claude-haiku-5-5");
    const audit = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "llm.fallback"));
    expect(audit).toHaveLength(1);
  });

  it("대체 모델이 없거나, 키 오류이거나, 연결 테스트면 대체하지 않는다", async () => {
    failing["claude-sonnet-5-5"] = overloaded;
    await expect(callLLM(db, call(), provider)).rejects.toBe(overloaded); // 설정 없음

    await db.update(schema.organizations).set({ fallbackModel: "claude-haiku-5-5" }).where(eq(schema.organizations.id, ctx.org.id));
    await expect(callLLM(db, call({ noFallback: true }), provider)).rejects.toBe(overloaded);
    const badKey = new ProviderHttpError(401, "invalid key");
    failing["claude-sonnet-5-5"] = badKey;
    await expect(callLLM(db, call(), provider)).rejects.toBe(badKey);
    expect(calls.filter((c) => c.model === "claude-haiku-5-5")).toHaveLength(0);
  });

  it("대체 모델을 쓸 수 없으면(꺼짐·키 없음) 원래 장애를 알린다", async () => {
    await db.insert(schema.llmModels).values({ id: "gpt-x", provider: "openai", label: "GPT X", inputUsd: "1", outputUsd: "2", enabled: false });
    await db.update(schema.organizations).set({ fallbackModel: "gpt-x" }).where(eq(schema.organizations.id, ctx.org.id));
    failing["claude-sonnet-5-5"] = overloaded;
    await expect(callLLM(db, call(), provider)).rejects.toBe(overloaded);
  });
});

describe("미션", () => {
  let member: typeof schema.agents.$inferSelect;
  beforeEach(async () => {
    await db.update(schema.agents).set({ rank: "LEADER", name: "하나", toolPermissions: { document: true }, maxTurns: 30 }).where(eq(schema.agents.id, ctx.agent.id));
    [member] = await db.insert(schema.agents).values({ orgId: ctx.org.id, name: "두리", rank: "MEMBER", skills: ["조사"], toolPermissions: { document: true }, maxTurns: 30 }).returning();
  });

  async function startMission(autonomy: Autonomy = "FULL", callLimit = 60) {
    const [mission] = await db
      .insert(schema.missions)
      .values({ orgId: ctx.org.id, title: "트렌드", topic: "트렌드", autonomy, leaderId: ctx.agent.id, status: "RUNNING", budgetLimit: 5000, callLimit, meetings: false }) // 회의(F104)는 meetings.test.ts에서
      .returning();
    const payload: MissionMessagePayload = { kind: "MISSION_START" };
    await db.insert(schema.messages).values({ orgId: ctx.org.id, missionId: mission.id, senderType: "USER", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content: "시작", payload, priority: 100 });
    queue.push({ orgId: ctx.org.id, agentId: ctx.agent.id });
    return mission;
  }
  const missionOf = async (id: string) => (await db.select().from(schema.missions).where(eq(schema.missions.id, id)))[0];
  const approvals = (id: string) => db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.missionId, id)).orderBy(asc(schema.approvalRequests.createdAt));
  async function decide(approvalId: string, decision: "APPROVED" | "REJECTED") {
    const r = await decideApproval(db, { orgId: ctx.org.id, userId: ctx.user.id, approvalId, decision });
    if ("error" in r) throw new Error(r.error);
    if (r.notify) queue.push(r.notify);
  }

  it("AI 호출이 상한에 닿으면 멈추고 한 번만 묻는다. 승인하면 60회 늘려 끝까지 진행", async () => {
    const mission = await startMission("FULL", 2); // 계획 1 + 첫 Task 1 → 검토에서 막힘
    await drain();

    const [ap] = await approvals(mission.id);
    expect(ap).toMatchObject({ type: "QUESTION", status: "PENDING", payload: { reason: "CALL_LIMIT" } });
    expect(await db.select().from(schema.costLogs)).toHaveLength(2);
    // 다시 돌려도 호출·질문이 늘지 않는다
    queue.push({ orgId: ctx.org.id, agentId: ctx.agent.id }, { orgId: ctx.org.id, agentId: member.id });
    await drain();
    expect(await approvals(mission.id)).toHaveLength(1);
    expect(await db.select().from(schema.costLogs)).toHaveLength(2);
    await expect(callLLM(db, call({ missionId: mission.id }), provider)).rejects.toBeInstanceOf(MissionCallLimitError);

    await decide(ap.id, "APPROVED");
    await drain();
    expect(await missionOf(mission.id)).toMatchObject({ status: "DONE", callLimit: 62 });
  });

  it("상한 질문을 거절하면 미션을 일시정지한다", async () => {
    const mission = await startMission("FULL", 1);
    await drain();
    const [ap] = await approvals(mission.id);
    await decide(ap.id, "REJECTED");
    await drain();
    expect((await missionOf(mission.id)).status).toBe("PAUSED");
  });

  it("리더 실패 질문을 거절하면 일시정지 (자동 재개가 다시 시작하지 않게)", async () => {
    failing["claude-haiku-5-5"] = new Error("계획(JSON)을 읽지 못했습니다"); // 리더 기본 모델
    const mission = await startMission();
    await drain();
    const [ap] = await approvals(mission.id);
    expect(ap.payload).toMatchObject({ reason: "LEADER_FAILED" });
    await decide(ap.id, "REJECTED");
    await drain();
    expect((await missionOf(mission.id)).status).toBe("PAUSED");
  });

  it("처리 중에 끊겨 멈춘 미션은 10분 뒤 리더가 끊긴 Task부터 이어서 끝낸다 (한 번만 시도)", async () => {
    const mission = await startMission();
    queue.length = 0;
    await runAgent(db, { orgId: ctx.org.id, agentId: ctx.agent.id }, deps); // 계획 → 첫 Task 지시
    // 서버가 재시작되며 담당의 지시 처리 기록이 사라진 상황: Task는 DOING인데 처리할 메시지가 없다
    await db.update(schema.messages).set({ readAt: new Date() }).where(eq(schema.messages.missionId, mission.id));
    const [first] = await db.select().from(schema.tasks).where(and(eq(schema.tasks.missionId, mission.id), eq(schema.tasks.order, 0)));
    expect(first.status).toBe("DOING");

    const soon = new Date(Date.now() + 60 * 1000);
    expect(await resumeStalledMissions(db, soon)).toEqual([]); // 아직 10분 안 됨
    const later = new Date(Date.now() + STALL_MS + 1000);
    expect(await resumeStalledMissions(db, later)).toEqual([{ orgId: ctx.org.id, agentId: ctx.agent.id }]);
    expect(await resumeStalledMissions(db, later)).toEqual([]); // 이미 재개 요청이 있음

    queue.length = 0;
    queue.push({ orgId: ctx.org.id, agentId: ctx.agent.id });
    await drain();
    expect((await missionOf(mission.id)).status).toBe("DONE");
    expect((await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "mission.resume"))).length).toBe(1);
  });

  it("대기 중인 승인·처리 중인 메시지가 있거나, 재개를 시도했는데 진행이 없으면 멈춘 것으로 보지 않는다", async () => {
    const mission = await startMission("CHECKPOINT");
    const far = new Date(Date.now() + STALL_MS * 3);
    expect(await isStalled(db, mission, { auto: true, now: far })).toBe(false); // MISSION_START 처리 전
    await drain(); // 계획 → 승인 대기
    expect(await isStalled(db, mission, { auto: true, now: far })).toBe(false);

    const payload: MissionMessagePayload = { kind: "RESUME" };
    await db.update(schema.approvalRequests).set({ status: "REJECTED" });
    await db.insert(schema.messages).values({ orgId: ctx.org.id, missionId: mission.id, senderType: "SYSTEM", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content: "재개", payload, readAt: new Date() });
    expect(await isStalled(db, mission, { auto: true, now: far })).toBe(false); // 직전 재개 뒤로 진행 없음
    expect(await isStalled(db, mission, { auto: false })).toBe(true); // 사용자가 누른 재개는 바로
  });
});
