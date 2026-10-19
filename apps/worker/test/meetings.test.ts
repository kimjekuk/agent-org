// F104 회의 테스트: 킥오프(계획 직후)·회고(완료 후), 참여자 한 바퀴 → 리더 결론, 결론 반영(Task 지시·장기 기억), 사용자 답글, 끄기·재개
import { decideApproval } from "@agentorg/shared/approval";
import { encryptSecret } from "@agentorg/shared/crypto";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import type { LLMProvider, LLMRequest } from "@agentorg/shared/llm/provider";
import { addUserReply } from "@agentorg/shared/meetings";
import type { Autonomy, MissionMessagePayload } from "@agentorg/shared/missions";
import type { RunAgentJob } from "@agentorg/shared/queue";
import { resumeMission } from "@agentorg/shared/recovery";
import { and, asc, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "../src/loops/member";
import { createTestDb, seed } from "./testDb";

const KEY = "cc".repeat(32);
beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

describe("F104 회의", () => {
  let db: AnyDb;
  let ctx: Awaited<ReturnType<typeof seed>>;
  let calls: LLMRequest[];
  let queue: RunAgentJob[];
  let duri: typeof schema.agents.$inferSelect;
  let seri: typeof schema.agents.$inferSelect;

  const provider: LLMProvider = {
    name: "anthropic",
    async complete(_k, req) {
      calls.push(req);
      const p = req.messages[0].content;
      const me = p.match(/# 내 차례 \((.+)\)/)?.[1];
      const text = p.includes('"tasks":[')
        ? JSON.stringify({ tasks: [{ title: "자료 조사", skills: ["조사"], assignee: "두리" }, { title: "보고서 작성", skills: ["작성"], assignee: "세리" }] })
        : me
          ? `${me} 의견입니다.`
          : p.includes("리더로서 회의를 정리")
            ? "- 출처를 꼭 남긴다"
            : p.includes("리더로서 회고를 정리")
              ? `- 잘됨${p.includes("이전 결론") ? " (답글 반영)" : ""}\n\n## 다음에 기억할 점\n- ${p.includes("이전 결론") ? "표를 먼저 만든다" : "표로 정리한다"}`
              : p.includes("# 검토할 Task")
                ? JSON.stringify({ pass: true, feedback: "좋음" })
                : p.includes("# 팀원 결과")
                  ? "# 최종\n\n본문"
                  : "# 결과\n\n내용";
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
    await db.update(schema.agents).set({ name: "하나", rank: "LEADER", maxTurns: 30, toolPermissions: { document: true } }).where(eq(schema.agents.id, ctx.agent.id));
    [duri, seri] = await db
      .insert(schema.agents)
      .values([
        { orgId: ctx.org.id, name: "두리", skills: ["조사"], maxTurns: 30, toolPermissions: { document: true } },
        { orgId: ctx.org.id, name: "세리", skills: ["작성"], maxTurns: 30, toolPermissions: { document: true } },
      ])
      .returning();
    await db.insert(schema.apiKeys).values({ userId: ctx.user.id, provider: "anthropic", encryptedKey: encryptSecret("sk-ant-test", KEY) });
  });

  async function start(autonomy: Autonomy, meetings = true) {
    const [mission] = await db
      .insert(schema.missions)
      .values({ orgId: ctx.org.id, title: "트렌드", topic: "트렌드", autonomy, leaderId: ctx.agent.id, status: "RUNNING", meetings })
      .returning();
    const payload: MissionMessagePayload = { kind: "MISSION_START" };
    await db.insert(schema.messages).values({ orgId: ctx.org.id, missionId: mission.id, senderType: "USER", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content: "시작", payload });
    queue.push({ orgId: ctx.org.id, agentId: ctx.agent.id });
    return mission;
  }
  const meetingsOf = (missionId: string) => db.select().from(schema.meetings).where(eq(schema.meetings.missionId, missionId)).orderBy(asc(schema.meetings.createdAt));
  const turnsOf = (meetingId: string) => db.select().from(schema.meetingTurns).where(eq(schema.meetingTurns.meetingId, meetingId)).orderBy(asc(schema.meetingTurns.createdAt));
  const taskDirectives = (missionId: string) =>
    db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.missionId, missionId), sql`${schema.messages.payload}->>'kind' = 'TASK'`))
      .orderBy(asc(schema.messages.createdAt));

  it("계획 뒤 킥오프(담당 순서대로 한 번씩 → 리더 결론), 결론이 Task 지시에 들어가고, 끝나면 회고 교훈이 참여자 모두의 장기 기억이 된다", async () => {
    const mission = await start("FULL");
    await drain();

    const [m] = await db.select().from(schema.missions).where(eq(schema.missions.id, mission.id));
    expect(m.status).toBe("DONE");
    const [kickoff, retro] = await meetingsOf(mission.id);
    expect(kickoff).toMatchObject({ kind: "KICKOFF", status: "DONE", participants: [duri.id, seri.id], conclusion: "- 출처를 꼭 남긴다" });
    expect(retro).toMatchObject({ kind: "RETRO", status: "DONE", conclusion: "- 잘됨" });
    expect((await turnsOf(kickoff.id)).map((t) => t.agentId)).toEqual([duri.id, seri.id, ctx.agent.id]);

    // 두 번째 발언자는 앞 사람 말을 보고, 회의는 Task 지시보다 먼저 끝난다
    const seriTurn = calls.find((c) => c.messages[0].content.includes("# 내 차례 (세리)"))!;
    expect(seriTurn.messages[0].content).toContain("두리: 두리 의견입니다.");
    const directives = await taskDirectives(mission.id);
    expect(directives[0].content).toContain("# 킥오프 회의 결론 (팀 합의)\n- 출처를 꼭 남긴다");
    expect(directives[0].createdAt.getTime()).toBeGreaterThan(kickoff.updatedAt.getTime() - 1);

    const lessons = await db.select().from(schema.memories).where(eq(schema.memories.source, `mission:${mission.id}:retro`));
    expect(lessons.map((l) => l.agentId).sort()).toEqual([ctx.agent.id, duri.id, seri.id].sort());
    expect(lessons.every((l) => l.scope === "LONG" && l.content === "표로 정리한다")).toBe(true);
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "meeting.conclude"))).toHaveLength(2);
  });

  it("끝난 회의에 답글을 달면 리더가 결론과 교훈을 다시 정리한다 (교훈은 바뀌고 쌓이지 않음)", async () => {
    const mission = await start("FULL");
    await drain();
    const [, retro] = await meetingsOf(mission.id);

    const job = await addUserReply(db, { orgId: ctx.org.id, userId: ctx.user.id, meetingId: retro.id, content: "표를 먼저 만들면 좋겠어요" });
    expect(job).toEqual({ orgId: ctx.org.id, agentId: ctx.agent.id });
    // 같은 결론 정리 요청이 남아 있으면 또 보내지 않는다
    expect(await addUserReply(db, { orgId: ctx.org.id, userId: ctx.user.id, meetingId: retro.id, content: "하나 더" })).toBeNull();
    queue.push(job!);
    await drain();

    const [, after] = await meetingsOf(mission.id);
    expect(after.conclusion).toBe("- 잘됨 (답글 반영)");
    const wrap = calls.at(-1)!.messages[0].content;
    expect(wrap).toContain("사용자 (최우선으로 반영): 표를 먼저 만들면 좋겠어요");
    const lessons = await db.select().from(schema.memories).where(eq(schema.memories.source, `mission:${mission.id}:retro`));
    expect(lessons).toHaveLength(3);
    expect(lessons.every((l) => l.content === "표를 먼저 만든다")).toBe(true);
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "meeting.reply"))).toHaveLength(2);
  });

  it("진행 중인 회의 답글은 다음 발언자가 보고, 체크포인트면 킥오프가 끝난 뒤 결론과 함께 계획 승인을 묻는다", async () => {
    const mission = await start("CHECKPOINT");
    await runAgent(db, queue.shift()!, deps()); // 리더: 계획 + 킥오프 시작
    expect(await db.select().from(schema.approvalRequests)).toHaveLength(0);
    const [kickoff] = await meetingsOf(mission.id);
    expect(await addUserReply(db, { orgId: ctx.org.id, userId: ctx.user.id, meetingId: kickoff.id, content: "20대 위주로" })).toBeNull();
    await drain();

    const duriTurn = calls.find((c) => c.messages[0].content.includes("# 내 차례 (두리)"))!;
    expect(duriTurn.messages[0].content).toContain("사용자 (최우선으로 반영): 20대 위주로");
    const [ap] = await db.select().from(schema.approvalRequests);
    expect(ap.payload).toMatchObject({ stage: "PLAN" });
    expect(ap.content).toContain("킥오프 회의 결론:\n- 출처를 꼭 남긴다");
    expect(await taskDirectives(mission.id)).toHaveLength(0);

    await decideApproval(db, { orgId: ctx.org.id, userId: ctx.user.id, approvalId: ap.id, decision: "APPROVED" });
    queue.push({ orgId: ctx.org.id, agentId: ctx.agent.id });
    await drain();
    expect(await taskDirectives(mission.id)).toHaveLength(2);
  });

  it("미션에서 회의를 끄면, 또는 리더 말고 참여자가 없으면 회의 없이 진행한다", async () => {
    const off = await start("FULL", false);
    await drain();
    expect(await meetingsOf(off.id)).toHaveLength(0);
    expect((await db.select().from(schema.missions).where(eq(schema.missions.id, off.id)))[0].status).toBe("DONE");

    await db.update(schema.agents).set({ isActive: false }).where(eq(schema.agents.orgId, ctx.org.id));
    await db.update(schema.agents).set({ isActive: true }).where(eq(schema.agents.id, ctx.agent.id));
    const solo = await start("FULL");
    await drain();
    expect(await meetingsOf(solo.id)).toHaveLength(0);
    expect((await db.select().from(schema.missions).where(eq(schema.missions.id, solo.id)))[0].status).toBe("DONE");
  });

  it("처리 중에 끊긴 킥오프는 재개하면 결론 없이 닫고 Task부터 이어서 진행한다", async () => {
    const mission = await start("FULL");
    await runAgent(db, queue.shift()!, deps()); // 계획 + 킥오프 시작
    // 서버가 죽어 첫 발언 지시가 사라진 상황
    await db.update(schema.messages).set({ readAt: new Date() }).where(sql`${schema.messages.payload}->>'kind' = 'MEETING'`);
    queue = [];

    const [m] = await db.select().from(schema.missions).where(eq(schema.missions.id, mission.id));
    queue.push(await resumeMission(db, m, { type: "USER", id: ctx.user.id }));
    await drain();
    const [kickoff] = await meetingsOf(mission.id);
    expect(kickoff.status).toBe("DONE");
    expect(kickoff.conclusion).toContain("끊겨");
    const directives = await taskDirectives(mission.id);
    expect(directives).toHaveLength(2);
    expect(directives[0].content).not.toContain("킥오프 회의 결론");
    expect((await db.select().from(schema.missions).where(eq(schema.missions.id, mission.id)))[0].status).toBe("DONE");
  });
});
