// F108 역제안 테스트: 결과 끝의 '## 다음 제안' → 승인함 PROPOSAL, 승인하면 미션 시작, 미션당 1개·대기 3개 제한, 보류는 남음
import { decideApproval } from "@agentorg/shared/approval";
import { encryptSecret } from "@agentorg/shared/crypto";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import type { LLMProvider, LLMRequest } from "@agentorg/shared/llm/provider";
import type { MissionMessagePayload } from "@agentorg/shared/missions";
import { MAX_OPEN_PROPOSALS, parseProposal } from "@agentorg/shared/proposals";
import type { RunAgentJob } from "@agentorg/shared/queue";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "../src/loops/member";
import { createTestDb, seed } from "./testDb";

const KEY = "ee".repeat(32);
beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

const PROPOSAL = "## 다음 제안\n- 주제: 20대 숏폼 아이디어 10개\n- 목표: 다음 달 촬영 목록\n- 이유: 트렌드 조사 결과를 바로 쓸 수 있음";

describe("제안 읽기", () => {
  it("주제·목표·이유를 읽고, 주제가 없으면 null", () => {
    expect(parseProposal(["주제: A 조사", "목표: B", "**이유**: C"])).toEqual({ topic: "A 조사", goal: "B", reason: "C" });
    expect(parseProposal(["목표: B"])).toBeNull();
    expect(parseProposal([])).toBeNull();
  });
});

describe("F108 역제안", () => {
  let db: AnyDb;
  let ctx: Awaited<ReturnType<typeof seed>>;
  let calls: LLMRequest[];
  let queue: RunAgentJob[];
  let withProposal: boolean;

  const provider: LLMProvider = {
    name: "anthropic",
    async complete(_k, req) {
      calls.push(req);
      const p = req.messages[0].content;
      const tail = withProposal ? `\n\n${PROPOSAL}` : "\n\n## 다음 제안\n없음";
      const text = p.includes('"tasks":[')
        ? JSON.stringify({ tasks: [{ title: "조사", skills: ["조사"], assignee: "두리" }] })
        : p.includes("# 검토할 Task")
          ? JSON.stringify({ pass: true, feedback: "좋음" })
          : p.includes("# 팀원 결과")
            ? `# 최종\n\n본문\n\n## 팀 교훈\n- 없음${tail}`
            : `# 결과\n\n내용${req.system?.includes("## 다음 제안") ? tail : ""}`;
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
    withProposal = true;
    await db.update(schema.agents).set({ name: "하나", rank: "LEADER", maxTurns: 30, toolPermissions: { document: true } }).where(eq(schema.agents.id, ctx.agent.id));
    await db.insert(schema.agents).values({ orgId: ctx.org.id, name: "두리", skills: ["조사"], maxTurns: 30, toolPermissions: { document: true } });
    await db.insert(schema.apiKeys).values({ userId: ctx.user.id, provider: "anthropic", encryptedKey: encryptSecret("sk-ant-test", KEY) });
  });

  async function runMission(autonomy: "FULL" | "CHECKPOINT" = "FULL") {
    const [mission] = await db
      .insert(schema.missions)
      .values({ orgId: ctx.org.id, title: "트렌드", topic: "트렌드", autonomy, leaderId: ctx.agent.id, status: "RUNNING", meetings: false })
      .returning();
    const payload: MissionMessagePayload = { kind: "MISSION_START" };
    await db.insert(schema.messages).values({ orgId: ctx.org.id, missionId: mission.id, senderType: "USER", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content: "시작", payload });
    queue.push({ orgId: ctx.org.id, agentId: ctx.agent.id });
    await drain();
    return mission;
  }
  const proposals = () => db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.type, "PROPOSAL"));
  async function decide(approvalId: string, decision: "APPROVED" | "REJECTED" | "HELD", comment?: string) {
    const r = await decideApproval(db, { orgId: ctx.org.id, userId: ctx.user.id, approvalId, decision, comment });
    if ("error" in r) throw new Error(r.error);
    return r.notify;
  }

  it("미션을 마치면 최종 결과의 다음 제안이 승인함에 오르고 (최종 결과에서는 빠짐), 승인하면 그 내용으로 미션을 시작한다", async () => {
    const mission = await runMission();
    const [final] = await db.select().from(schema.artifacts).where(eq(schema.artifacts.missionId, mission.id));
    expect(final.content).not.toContain("다음 제안");
    const [p] = await proposals();
    expect(p).toMatchObject({ status: "PENDING", agentId: ctx.agent.id, payload: { kind: "MISSION_PROPOSAL", topic: "20대 숏폼 아이디어 10개", sourceMissionId: mission.id } });
    expect(p.content).toContain("💡 하나의 제안: 20대 숏폼 아이디어 10개");

    const notify = await decide(p.id, "APPROVED", "예산은 아껴 주세요");
    expect(notify).toEqual({ orgId: ctx.org.id, agentId: ctx.agent.id });
    const started = (await db.select().from(schema.missions)).find((m) => m.id !== mission.id)!;
    expect(started).toMatchObject({ topic: "20대 숏폼 아이디어 10개", goal: "다음 달 촬영 목록", status: "RUNNING", leaderId: ctx.agent.id, autonomy: "CHECKPOINT" });
    expect(started.referenceNotes).toContain("사용자 의견 (최우선): 예산은 아껴 주세요");
    const [after] = await proposals();
    expect(after.payload).toMatchObject({ missionId: started.id });
    const [start] = await db.select().from(schema.messages).where(eq(schema.messages.missionId, started.id));
    expect(start.payload).toMatchObject({ kind: "MISSION_START" });
  });

  it("체크포인트 미션은 최종 승인 때 제안이 오르고, 다시 통합해도 미션당 1개만", async () => {
    const mission = await runMission("CHECKPOINT");
    const plan = (await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.missionId, mission.id)))[0];
    queue.push((await decide(plan.id, "APPROVED"))!);
    await drain();
    expect(await proposals()).toHaveLength(0);
    const final = (await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.missionId, mission.id))).find((a) => a.status === "PENDING")!;
    expect(final.payload).toMatchObject({ stage: "FINAL", proposal: { topic: "20대 숏폼 아이디어 10개" } });
    queue.push((await decide(final.id, "APPROVED"))!);
    await drain();
    expect(await proposals()).toHaveLength(1);
  });

  it("직접 지시 결과에서도 제안하고, 대기(보류 포함) 중인 제안이 3개면 더 받지 않는다. 거절하면 미션을 만들지 않는다", async () => {
    for (let i = 0; i < MAX_OPEN_PROPOSALS + 1; i++) {
      await db.insert(schema.messages).values({ orgId: ctx.org.id, senderType: "USER", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content: `조사 ${i}` });
      await runAgent(db, { orgId: ctx.org.id, agentId: ctx.agent.id }, deps());
    }
    const list = await proposals();
    expect(list).toHaveLength(MAX_OPEN_PROPOSALS);
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "proposal.skip"))).toHaveLength(1);
    const [report] = await db.select().from(schema.messages).where(eq(schema.messages.type, "REPORT"));
    expect(report.content).not.toContain("다음 제안");

    await decide(list[0].id, "HELD");
    await decide(list[1].id, "REJECTED");
    expect((await proposals()).filter((p) => p.status === "HELD")).toHaveLength(1);
    expect(await db.select().from(schema.missions)).toHaveLength(0);
  });

  it("'없음'이면 제안하지 않고, 미션 Task 지시에는 제안 지침을 넣지 않는다", async () => {
    withProposal = false;
    await runMission();
    expect(await proposals()).toHaveLength(0);
    const task = calls.find((c) => c.messages[0].content.includes("# 내 Task"))!;
    expect(task.system).not.toContain("## 다음 제안");
  });
});
