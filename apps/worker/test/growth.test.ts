// F102 성장 테스트: 레벨 계산, 경험치 적립(일·검토·예산 절약·별점), 특기 숙련 → 배정 우선, 승진 제안 → 사용자 결정
import { decideApproval } from "@agentorg/shared/approval";
import { encryptSecret } from "@agentorg/shared/crypto";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import { awardXp, levelForXp, levelProgress, levelTitle, MASTERY_COUNT, masteredSkills, ratingBonus, XP, xpForLevel } from "@agentorg/shared/growth";
import type { LLMProvider } from "@agentorg/shared/llm/provider";
import type { MissionMessagePayload } from "@agentorg/shared/missions";
import type { RunAgentJob } from "@agentorg/shared/queue";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pickAssignee } from "../src/loops/leader";
import { runAgent } from "../src/loops/member";
import { createTestDb, seed } from "./testDb";

const KEY = "bb".repeat(32);
beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

describe("레벨 계산", () => {
  it("누적 경험치로 레벨·칭호·진행률을 정한다", () => {
    expect([1, 2, 3, 4, 5].map(xpForLevel)).toEqual([0, 50, 150, 300, 500]);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(49)).toBe(1);
    expect(levelForXp(50)).toBe(2);
    expect(levelForXp(500)).toBe(5);
    expect(levelTitle(1)).toBe("신입");
    expect(levelTitle(5)).toBe("시니어");
    expect(levelProgress(100)).toMatchObject({ level: 2, current: 50, next: 150, ratio: 0.5 });
  });
  it("별점 보너스는 올린 만큼만 (4점 10, 5점 20, 내리면 0)", () => {
    expect(ratingBonus(null, 5)).toBe(20);
    expect(ratingBonus(4, 5)).toBe(10);
    expect(ratingBonus(5, 3)).toBe(0);
    expect(ratingBonus(null, 3)).toBe(0);
  });
});

describe("성장", () => {
  let db: AnyDb;
  let ctx: Awaited<ReturnType<typeof seed>>;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = await seed(db, { budgetDaily: 100000 });
    await db.update(schema.agents).set({ toolPermissions: { document: true }, maxTurns: 30, rank: "MEMBER", skills: ["조사"] }).where(eq(schema.agents.id, ctx.agent.id));
    await db.insert(schema.apiKeys).values({ userId: ctx.user.id, provider: "anthropic", encryptedKey: encryptSecret("sk-ant-test", KEY) });
  });
  const agentOf = async (id: string) => (await db.select().from(schema.agents).where(eq(schema.agents.id, id)))[0];

  it("지시를 끝내면 경험치를 받고, 실패하면 받지 않는다", async () => {
    let fail = false;
    const provider: LLMProvider = {
      name: "anthropic",
      async complete(_k, req) {
        if (fail) throw new Error("오류");
        return { text: "# 결과\n\n본문", model: req.model, stopReason: "end_turn", usage: [], webSearchRequests: 0, webSearchEnabled: false };
      },
    };
    const deps = { provider, publish: async () => {}, enqueue: async () => true };
    for (const f of [false, true]) {
      fail = f;
      await db.insert(schema.messages).values({ orgId: ctx.org.id, senderType: "USER", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content: "조사해 줘" });
      await runAgent(db, { orgId: ctx.org.id, agentId: ctx.agent.id }, deps);
    }
    expect((await agentOf(ctx.agent.id)).xp).toBe(XP.WORK_DONE);
  });

  it("레벨 5가 된 팀원은 승진 제안을 한 번만 받고, 승인하면 팀장이 된다", async () => {
    await awardXp(db, { agentId: ctx.agent.id, amount: 499, reason: "시험" });
    expect(await db.select().from(schema.approvalRequests)).toHaveLength(0);
    await awardXp(db, { agentId: ctx.agent.id, amount: 1, reason: "시험" });
    await awardXp(db, { agentId: ctx.agent.id, amount: 300, reason: "시험" });

    const a = await agentOf(ctx.agent.id);
    expect(a).toMatchObject({ xp: 800, level: 6, rank: "MEMBER" });
    const reqs = await db.select().from(schema.approvalRequests);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ type: "PROPOSAL", agentId: ctx.agent.id, payload: { kind: "PROMOTION", toRank: "MANAGER" } });
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "agent.level_up"))).toHaveLength(3); // 1→4, 4→5, 5→6

    const r = await decideApproval(db, { orgId: ctx.org.id, userId: ctx.user.id, approvalId: reqs[0].id, decision: "APPROVED" });
    expect(r).toEqual({ notify: null });
    expect((await agentOf(ctx.agent.id)).rank).toBe("MANAGER");
  });

  it("검토를 5번 통과한 특기는 숙련이 되고, 같은 조건이면 숙련된 사람에게 배정한다", async () => {
    for (let i = 0; i < MASTERY_COUNT; i++) await awardXp(db, { agentId: ctx.agent.id, amount: XP.REVIEW_PASS, reason: "검토 통과", skills: ["조사"] });
    const pro = await agentOf(ctx.agent.id);
    expect(masteredSkills(pro.skillXp as Record<string, number>)).toEqual(["조사"]);
    const [rookie] = await db.insert(schema.agents).values({ orgId: ctx.org.id, name: "신입", skills: ["조사"] }).returning();
    expect(pickAssignee([rookie, pro], null, ["조사"], new Map()).id).toBe(pro.id);
  });

  it("미션: 검토 통과한 담당은 경험치와 특기 숙련을, 예산 절반 이하로 끝내면 참여자 모두 보너스를 받는다", async () => {
    const [member] = await db
      .insert(schema.agents)
      .values({ orgId: ctx.org.id, name: "두리", rank: "MEMBER", skills: ["조사"], toolPermissions: { document: true }, maxTurns: 30 })
      .returning();
    await db.update(schema.agents).set({ rank: "LEADER", name: "하나", skills: ["기획"] }).where(eq(schema.agents.id, ctx.agent.id));
    const [mission] = await db
      .insert(schema.missions)
      .values({ orgId: ctx.org.id, title: "트렌드", topic: "트렌드", autonomy: "FULL", leaderId: ctx.agent.id, status: "RUNNING", budgetLimit: 5000 })
      .returning();
    const start: MissionMessagePayload = { kind: "MISSION_START" };
    await db.insert(schema.messages).values({ orgId: ctx.org.id, missionId: mission.id, senderType: "USER", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content: "시작", payload: start });
    const provider: LLMProvider = {
      name: "anthropic",
      async complete(_k, req) {
        const p = req.messages[0].content;
        const text = p.includes('"tasks":[')
          ? JSON.stringify({ tasks: [{ title: "조사", description: "조사", skills: ["조사"], assignee: "두리" }] })
          : p.includes("# 검토할 Task")
            ? JSON.stringify({ pass: true, feedback: "좋음" })
            : p.includes("# 팀원 결과")
              ? "# 최종\n\n본문"
              : "# 조사 결과\n\n내용";
        return { text, model: req.model, stopReason: "end_turn", usage: [], webSearchRequests: 0, webSearchEnabled: false };
      },
    };
    const queue: RunAgentJob[] = [{ orgId: ctx.org.id, agentId: ctx.agent.id }];
    const deps = { provider, publish: async () => {}, enqueue: async (j: RunAgentJob) => (queue.push(j), true) };
    for (let i = 0; i < 20 && queue.length; i++) await runAgent(db, queue.shift()!, deps);

    expect((await agentOf(mission.leaderId!)).xp).toBe(XP.UNDER_BUDGET);
    const m = await agentOf(member.id);
    expect(m.xp).toBe(XP.WORK_DONE + XP.REVIEW_PASS + XP.UNDER_BUDGET);
    expect(m.skillXp).toEqual({ 조사: 1 });
  });
});
