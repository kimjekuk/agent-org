// F107 품질 관리 테스트: 제출 전 자기검토(점검표 → 보고에 싣고 검토자에게 전달), QA 담당 검토, 반려 한도 초과 → 사용자 질문
import { decideApproval } from "@agentorg/shared/approval";
import { encryptSecret } from "@agentorg/shared/crypto";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import type { LLMProvider, LLMRequest } from "@agentorg/shared/llm/provider";
import type { MissionMessagePayload } from "@agentorg/shared/missions";
import type { RunAgentJob } from "@agentorg/shared/queue";
import { and, asc, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "../src/loops/member";
import { createTestDb, seed } from "./testDb";

const KEY = "dd".repeat(32);
beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

describe("F107 품질 관리", () => {
  let db: AnyDb;
  let ctx: Awaited<ReturnType<typeof seed>>;
  let calls: LLMRequest[];
  let queue: RunAgentJob[];
  let verdicts: { pass: boolean; feedback: string }[];
  let qaAnswer: string | null;
  let duri: typeof schema.agents.$inferSelect;

  const provider: LLMProvider = {
    name: "anthropic",
    async complete(_k, req) {
      calls.push(req);
      const p = req.messages[0].content;
      const isQa = req.system?.includes("품질 검토 담당 (QA)");
      const text = p.includes('"tasks":[')
        ? JSON.stringify({ tasks: [{ title: "자료 조사", skills: ["조사"], assignee: "두리" }] })
        : p.includes("# 검토할 Task")
          ? isQa && qaAnswer !== null
            ? qaAnswer
            : JSON.stringify(verdicts.shift() ?? { pass: true, feedback: "좋음" })
          : p.includes("# 팀원 결과")
            ? "# 최종\n\n본문"
            : "# 조사 결과\n\n내용\n\n## 자기검토\n- ✅ Task 요구를 모두 담았다\n- ⚠️ 출처 3개 이상: 2개뿐\n\n## 기억할 점\n- 없음";
      return { text, model: req.model, stopReason: "end_turn", usage: [], webSearchRequests: 0, webSearchEnabled: false };
    },
  };
  const deps = () => ({ provider, publish: async () => {}, enqueue: async (j: RunAgentJob) => (queue.push(j), true) });
  const drain = async () => {
    for (let i = 0; i < 40 && queue.length; i++) await runAgent(db, queue.shift()!, deps());
  };

  beforeEach(async () => {
    db = await createTestDb();
    ctx = await seed(db, { budgetDaily: 100000 });
    calls = [];
    queue = [];
    verdicts = [];
    qaAnswer = null;
    await db.update(schema.agents).set({ name: "하나", rank: "LEADER", maxTurns: 30, toolPermissions: { document: true } }).where(eq(schema.agents.id, ctx.agent.id));
    [duri] = await db.insert(schema.agents).values({ orgId: ctx.org.id, name: "두리", skills: ["조사"], maxTurns: 30, toolPermissions: { document: true } }).returning();
    await db.insert(schema.apiKeys).values({ userId: ctx.user.id, provider: "anthropic", encryptedKey: encryptSecret("sk-ant-test", KEY) });
  });

  async function hireQa() {
    const [qa] = await db
      .insert(schema.agents)
      .values({ orgId: ctx.org.id, name: "네모", skills: ["품질 점검"], maxTurns: 30, toolPermissions: { document: true, qa_review: true } })
      .returning();
    return qa;
  }
  async function start() {
    const [mission] = await db
      .insert(schema.missions)
      .values({ orgId: ctx.org.id, title: "트렌드", topic: "트렌드", autonomy: "FULL", leaderId: ctx.agent.id, status: "RUNNING", meetings: false, successCriteria: ["출처 3개 이상"] })
      .returning();
    const payload: MissionMessagePayload = { kind: "MISSION_START" };
    await db.insert(schema.messages).values({ orgId: ctx.org.id, missionId: mission.id, senderType: "USER", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content: "시작", payload });
    queue.push({ orgId: ctx.org.id, agentId: ctx.agent.id });
    return mission;
  }
  const taskOf = async (missionId: string) => (await db.select().from(schema.tasks).where(eq(schema.tasks.missionId, missionId)))[0];
  const missionOf = async (id: string) => (await db.select().from(schema.missions).where(eq(schema.missions.id, id)))[0];
  const reviewCalls = () => calls.filter((c) => c.messages[0].content.includes("# 검토할 Task"));

  it("Task 지시에 점검표가 들어가고, 결과 끝의 자기검토는 산출물에서 떼어 보고에 실은 뒤 검토자에게 전달한다", async () => {
    const mission = await start();
    await drain();

    const task = calls.find((c) => c.messages[0].content.includes("# 내 Task"))!.messages[0].content;
    expect(task).toContain("# 제출 전 자기검토");
    expect(task).toContain("- 미션 성공 기준에 맞는다: 출처 3개 이상");

    const t = await taskOf(mission.id);
    const [art] = await db.select().from(schema.artifacts).where(eq(schema.artifacts.taskId, t.id));
    expect(art.content).not.toContain("자기검토");
    const [report] = await db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.taskId, t.id), eq(schema.messages.senderAgentId, duri.id), eq(schema.messages.type, "REPORT")));
    expect(report.payload).toMatchObject({ selfCheck: ["✅ Task 요구를 모두 담았다", "⚠️ 출처 3개 이상: 2개뿐"] });
    expect(report.content).toContain("자기검토\n- ✅ Task 요구를 모두 담았다");
    expect(reviewCalls()[0].messages[0].content).toContain("# 담당의 자기검토\n- ✅ Task 요구를 모두 담았다\n- ⚠️ 출처 3개 이상: 2개뿐");
    expect((await missionOf(mission.id)).status).toBe("DONE");
  });

  it("QA 담당이 있으면 리더 대신 QA가 검토하고, QA 반려는 담당에게 다시 지시된다", async () => {
    const qa = await hireQa();
    verdicts = [{ pass: false, feedback: "출처를 하나 더" }, { pass: true, feedback: "좋음" }];
    const mission = await start();
    await drain();

    const reviews = reviewCalls();
    expect(reviews).toHaveLength(2);
    expect(reviews.every((c) => c.system?.includes("이름: 네모"))).toBe(true);
    const qaCosts = await db.select().from(schema.costLogs).where(eq(schema.costLogs.agentId, qa.id));
    expect(qaCosts).toHaveLength(2);
    const t = await taskOf(mission.id);
    expect(t).toMatchObject({ status: "DONE", rejectCount: 1 });
    const redo = await db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.taskId, t.id), sql`${schema.messages.payload}->>'kind' = 'TASK'`))
      .orderBy(asc(schema.messages.createdAt));
    expect(redo[1].content).toContain("QA 네모의 검토에서 반려되었습니다");
    expect(redo[1].content).toContain("출처를 하나 더");
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "task.qa_review"))).toHaveLength(2);
    expect((await missionOf(mission.id)).status).toBe("DONE");
  });

  it("QA가 답을 못 내면 리더가 직접 검토하고, QA 본인이 담당한 Task는 리더가 검토한다", async () => {
    await hireQa();
    qaAnswer = "음… 잘 모르겠습니다";
    const mission = await start();
    await drain();
    const reviews = reviewCalls();
    expect(reviews.map((c) => (c.system?.includes("이름: 네모") ? "QA" : "리더"))).toEqual(["QA", "리더"]);
    expect((await missionOf(mission.id)).status).toBe("DONE");

    // QA만 남으면(두리 해고) QA가 담당 → 리더 검토
    await db.update(schema.agents).set({ isActive: false }).where(eq(schema.agents.id, duri.id));
    calls = [];
    const second = await start();
    await drain();
    expect(reviewCalls().map((c) => (c.system?.includes("이름: 네모") ? "QA" : "리더"))).toEqual(["리더"]);
    expect((await missionOf(second.id)).status).toBe("DONE");
  });

  it("반려 한도를 넘어도 미통과면 사용자에게 묻고, 거절(다시 하기)하면 코멘트를 담당에게 전달해 다시 한다", async () => {
    verdicts = [
      { pass: false, feedback: "근거 부족" },
      { pass: false, feedback: "여전히 근거 부족" },
    ];
    const mission = await start();
    await drain();

    const [q] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.missionId, mission.id));
    expect(q).toMatchObject({ type: "QUESTION", status: "PENDING", payload: { reason: "REJECT_LIMIT" } });
    expect(q.content).toContain("마지막 검토 의견: 여전히 근거 부족");
    expect((await taskOf(mission.id)).status).toBe("REVIEW");

    const r = await decideApproval(db, { orgId: ctx.org.id, userId: ctx.user.id, approvalId: q.id, decision: "REJECTED", comment: "통계청 자료를 넣어 주세요" });
    if ("error" in r) throw new Error(r.error);
    if (r.notify) queue.push(r.notify);
    await drain();

    const t = await taskOf(mission.id);
    expect(t.status).toBe("DONE");
    const last = (
      await db
        .select()
        .from(schema.messages)
        .where(and(eq(schema.messages.taskId, t.id), sql`${schema.messages.payload}->>'kind' = 'TASK'`))
        .orderBy(asc(schema.messages.createdAt))
    ).at(-1)!;
    expect(last.content).toContain("사용자 의견 (최우선): 통계청 자료를 넣어 주세요");
    expect((await missionOf(mission.id)).status).toBe("DONE");
  });
});
