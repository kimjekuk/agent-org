// F204 리플레이·연표: 실제 미션을 돌린 기록으로 장면을 만들고(회의 → 지시 → 검토 → 완료), 연표에 완료·입사·레벨업·처음 있는 일·최고 지출이 나온다
import { writeAudit } from "@agentorg/shared/audit";
import { encryptSecret } from "@agentorg/shared/crypto";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import { groupByMonth, orgHistory } from "@agentorg/shared/history";
import type { LLMProvider } from "@agentorg/shared/llm/provider";
import type { MissionMessagePayload } from "@agentorg/shared/missions";
import type { RunAgentJob } from "@agentorg/shared/queue";
import { buildReplay, missionReplay } from "@agentorg/shared/replay";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "../src/loops/member";
import { createTestDb, seed } from "./testDb";

const KEY = "ab".repeat(32);
beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

describe("장면 만들기", () => {
  it("모두 휴게 공간에서 시작해, 지시 받은 담당은 책상으로·통과하면 다시 휴게로, 관계없는 기록은 건너뛴다", () => {
    const at = (m: number) => new Date(Date.UTC(2026, 9, 21, 0, m));
    const ctx = { leaderId: "L", assignees: new Map([["t1", "A"]]), participants: new Map<string, string[]>(), names: new Map([["L", "하나"], ["A", "두리"]]) };
    const frames = buildReplay(
      [
        { at: at(0), action: "mission.plan", actorId: "L", targetId: "m", reasoning: "계획" },
        { at: at(1), action: "task.dispatch", actorId: "L", targetId: "t1", reasoning: '"조사" → 두리' },
        { at: at(2), action: "llm.call", actorId: "A", targetId: "x", reasoning: "" },
        { at: at(3), action: "task.review_pass", actorId: "L", targetId: "t1", reasoning: "좋음" },
      ],
      ctx,
    );
    expect(frames).toHaveLength(3);
    expect(frames[0].states).toEqual({ L: { status: "WORKING", activity: "WORK" }, A: { status: "IDLE", activity: null } });
    expect(frames[1].states).toMatchObject({ L: { status: "IDLE" }, A: { status: "WORKING", activity: "WORK" } });
    expect(frames[2].states).toMatchObject({ L: { activity: "REVIEW" }, A: { status: "IDLE" } });
    expect(frames[2].text).toContain("검토 통과");
  });
});

describe("미션 리플레이 · 연표", () => {
  let db: AnyDb;
  let ctx: Awaited<ReturnType<typeof seed>>;
  let queue: RunAgentJob[];
  const provider: LLMProvider = {
    name: "anthropic",
    async complete(_k, req) {
      const p = req.messages[0].content;
      const text = p.includes('"tasks":[')
        ? JSON.stringify({ tasks: [{ title: "자료 조사", skills: ["조사"], assignee: "두리" }] })
        : p.includes("# 내 차례")
          ? "의견입니다."
          : p.includes("리더로서")
            ? "- 결론"
            : p.includes("# 검토할 Task")
              ? JSON.stringify({ pass: true, feedback: "좋음" })
              : p.includes("# 팀원 결과")
                ? "# 최종\n\n본문"
                : "# 결과\n\n내용";
      return { text, model: req.model, stopReason: "end_turn", usage: [{ model: req.model, inputTokens: 1000, outputTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0 }], webSearchRequests: 0, webSearchEnabled: false };
    },
  };

  beforeEach(async () => {
    db = await createTestDb();
    ctx = await seed(db, { budgetDaily: 100000 });
    queue = [];
    await db.update(schema.agents).set({ name: "하나", rank: "LEADER", maxTurns: 30, toolPermissions: { document: true } }).where(eq(schema.agents.id, ctx.agent.id));
    const [duri] = await db.insert(schema.agents).values({ orgId: ctx.org.id, name: "두리", skills: ["조사"], maxTurns: 30, toolPermissions: { document: true } }).returning();
    await writeAudit(db, { orgId: ctx.org.id, actorType: "USER", actorId: ctx.user.id, action: "agent.hire", targetType: "agent", targetId: duri.id, reasoning: '리서처 템플릿으로 "두리" 채용' });
    await db.insert(schema.apiKeys).values({ userId: ctx.user.id, provider: "anthropic", encryptedKey: encryptSecret("sk-ant-test", KEY) });
  });

  async function runMission() {
    const [mission] = await db
      .insert(schema.missions)
      .values({ orgId: ctx.org.id, title: "트렌드", topic: "트렌드", autonomy: "FULL", leaderId: ctx.agent.id, status: "RUNNING" })
      .returning();
    await writeAudit(db, { orgId: ctx.org.id, actorType: "USER", action: "mission.create", targetType: "mission", targetId: mission.id, reasoning: '미션 "트렌드" 생성' });
    const payload: MissionMessagePayload = { kind: "MISSION_START" };
    await db.insert(schema.messages).values({ orgId: ctx.org.id, missionId: mission.id, senderType: "USER", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content: "시작", payload });
    queue.push({ orgId: ctx.org.id, agentId: ctx.agent.id });
    const deps = { provider, publish: async () => {}, enqueue: async (j: RunAgentJob) => (queue.push(j), true) };
    for (let i = 0; i < 40 && queue.length; i++) await runAgent(db, queue.shift()!, deps);
    return mission;
  }

  it("미션 기록으로 장면을 만든다: 계획 → 킥오프(회의실) → 지시(책상) → 검토 → 회고 → 완료(모두 휴게)", async () => {
    const mission = await runMission();
    const r = await missionReplay(db, ctx.org.id, mission.id);
    expect(r!.agents.map((a) => [a.name, a.rank])).toEqual([
      ["하나", "LEADER"],
      ["두리", "MEMBER"],
    ]);
    const icons = r!.frames.map((f) => f.icon);
    expect(icons[0]).toBe("🎯");
    expect(icons).toContain("🗺️");
    expect(icons).toContain("💬");
    expect(icons).toContain("📨");
    expect(icons).toContain("✅");
    expect(icons).toContain("🏁");
    const duri = r!.agents[1].id;
    expect(r!.frames.find((f) => f.icon === "🗣️")!.states[duri]).toEqual({ status: "WORKING", activity: "MEETING" });
    expect(r!.frames.find((f) => f.icon === "📨")!.states[duri]).toEqual({ status: "WORKING", activity: "WORK" });
    expect(Object.values(r!.frames.find((f) => f.icon === "🏁")!.states).every((s) => s.status === "IDLE")).toBe(true);
    expect(await missionReplay(db, "00000000-0000-0000-0000-000000000000", mission.id)).toBeNull(); // 다른 조직은 볼 수 없다
  });

  it("연표: 미션 완료·입사·처음 있는 일·하루 최고 지출을 최근 것부터, 월별로 묶는다", async () => {
    await runMission();
    const h = await orgHistory(db, ctx.org.id);
    const titles = h.map((e) => e.title);
    expect(titles).toContain("미션 완료: 트렌드");
    expect(titles).toContain("두리 입사");
    expect(titles).toContain("첫 미션 완료");
    expect(titles).toContain("첫 회의");
    expect(titles).toContain("첫 지식 문서");
    expect(titles.some((t) => t.startsWith("하루 최고 지출"))).toBe(true);
    expect(h.every((e, i) => i === 0 || h[i - 1].at.getTime() >= e.at.getTime())).toBe(true);
    expect(groupByMonth(h)[0].entries.length).toBe(h.length);
  });
});
