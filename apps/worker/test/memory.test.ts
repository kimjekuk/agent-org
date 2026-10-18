// F101 기억 테스트: '## 기억할 점' 떼어 저장, 다음 일 프롬프트에 넣기, 개수 제한, 미션 교훈 → 장기 기억
import { encryptSecret } from "@agentorg/shared/crypto";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import type { LLMProvider, LLMRequest } from "@agentorg/shared/llm/provider";
import { extractSection, memoryContext, saveMemories } from "@agentorg/shared/memory";
import type { MissionMessagePayload } from "@agentorg/shared/missions";
import type { RunAgentJob } from "@agentorg/shared/queue";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "../src/loops/member";
import { createTestDb, seed } from "./testDb";

const KEY = "77".repeat(32);
beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

describe("섹션 떼어 내기", () => {
  it("'## 기억할 점' 항목을 꺼내고 본문에서는 지운다 (뒤 섹션은 남김)", () => {
    const r = extractSection("# 제목\n본문\n\n## 기억할 점\n- 출처는 공식 사이트 우선\n2) 표로 정리하면 빠름\n\n## 부록\n끝", "기억할 점");
    expect(r.items).toEqual(["출처는 공식 사이트 우선", "표로 정리하면 빠름"]);
    expect(r.body).toBe("# 제목\n본문\n\n## 부록\n끝");
  });
  it("섹션이 없거나 '없음'이면 기억하지 않는다", () => {
    expect(extractSection("# 제목\n본문", "기억할 점")).toEqual({ body: "# 제목\n본문", items: [] });
    expect(extractSection("# 제목\n\n## 기억할 점\n- 없음", "기억할 점").items).toEqual([]);
  });
});

describe("기억 저장·사용", () => {
  let db: AnyDb;
  let ctx: Awaited<ReturnType<typeof seed>>;
  let calls: LLMRequest[];
  const provider: LLMProvider = {
    name: "anthropic",
    async complete(_k, req) {
      calls.push(req);
      return {
        text: `# ${req.messages[0].content} 결과\n\n본문\n\n## 기억할 점\n- ${req.messages[0].content}에는 표가 좋다`,
        model: req.model,
        stopReason: "end_turn",
        usage: [],
        webSearchRequests: 0,
        webSearchEnabled: false,
      };
    },
  };
  const deps = { provider, publish: async () => {}, enqueue: async (_j: RunAgentJob) => true };

  beforeEach(async () => {
    db = await createTestDb();
    ctx = await seed(db, { budgetDaily: 100000 });
    calls = [];
    await db.update(schema.agents).set({ toolPermissions: { document: true } }).where(eq(schema.agents.id, ctx.agent.id));
    await db.insert(schema.apiKeys).values({ userId: ctx.user.id, provider: "anthropic", encryptedKey: encryptSecret("sk-ant-test", KEY) });
  });

  async function directive(content: string) {
    await db.insert(schema.messages).values({ orgId: ctx.org.id, senderType: "USER", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content });
    await runAgent(db, { orgId: ctx.org.id, agentId: ctx.agent.id }, deps);
  }

  it("직접 지시의 '기억할 점'은 단기 기억으로 저장되고 산출물에서는 빠진다", async () => {
    await directive("AI 뉴스 요약");
    const [mem] = await db.select().from(schema.memories);
    expect(mem).toMatchObject({ agentId: ctx.agent.id, scope: "SHORT", content: "AI 뉴스 요약에는 표가 좋다", missionId: null });
    const [art] = await db.select().from(schema.artifacts);
    expect(art.content).not.toContain("기억할 점");
    expect(calls[0].system).toContain("## 기억할 점");
  });

  it("다음 일의 시스템 프롬프트에 기억이 들어가고, 사용자 지시 최우선 문장이 맨 앞에 남는다", async () => {
    await directive("AI 뉴스 요약");
    await directive("반도체 뉴스 요약");
    const system = calls[1].system ?? "";
    expect(system).toContain("# 기억");
    expect(system).toContain("AI 뉴스 요약에는 표가 좋다");
    expect(system.indexOf("# 최우선 원칙")).toBe(0);
    expect(system.indexOf("# 최우선 원칙")).toBeLessThan(system.indexOf("# 기억"));
  });

  it("범위별로 최근 것만 남긴다 (단기 20개)", async () => {
    for (let i = 0; i < 25; i++) {
      await saveMemories(db, { orgId: ctx.org.id, agentId: ctx.agent.id, scope: "SHORT", source: `t${i}`, items: [`기억 ${i}`] });
    }
    const rows = await db.select().from(schema.memories).where(eq(schema.memories.agentId, ctx.agent.id));
    expect(rows).toHaveLength(20);
    expect(await memoryContext(db, ctx.agent.id)).toContain("기억 24");
  });

  it("미션 최종 통합의 '팀 교훈'은 참여자 모두의 장기 기억이 되고 최종 결과에서는 빠진다", async () => {
    // 리더 1명 + 팀원 1명, 완전 자율 미션 → 리더 루프가 끝까지 진행
    const [member] = await db
      .insert(schema.agents)
      .values({ orgId: ctx.org.id, name: "두리", rank: "MEMBER", skills: ["조사"], toolPermissions: { document: true } })
      .returning();
    await db.update(schema.agents).set({ rank: "LEADER", name: "하나" }).where(eq(schema.agents.id, ctx.agent.id));
    const [mission] = await db
      .insert(schema.missions)
      .values({ orgId: ctx.org.id, title: "트렌드", topic: "트렌드", autonomy: "FULL", leaderId: ctx.agent.id, status: "RUNNING", budgetLimit: 5000 })
      .returning();
    const start: MissionMessagePayload = { kind: "MISSION_START" };
    await db.insert(schema.messages).values({ orgId: ctx.org.id, missionId: mission.id, senderType: "USER", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content: "시작", payload: start });

    const leaderProvider: LLMProvider = {
      name: "anthropic",
      async complete(_k, req) {
        const p = req.messages[0].content;
        const text = p.includes('"tasks":[')
          ? JSON.stringify({ tasks: [{ title: "조사", description: "조사", skills: ["조사"], assignee: "두리" }] })
          : p.includes("# 검토할 Task")
            ? JSON.stringify({ pass: true, feedback: "좋음" })
            : p.includes("# 팀원 결과")
              ? "# 최종\n\n본문\n\n## 성공 기준 점검\n- [x] 됨\n\n## 팀 교훈\n- 조사 범위를 먼저 정하면 빠르다"
              : "# 조사 결과\n\n내용\n\n## 기억할 점\n- 키워드를 3개로 좁힌다";
        return { text, model: req.model, stopReason: "end_turn", usage: [], webSearchRequests: 0, webSearchEnabled: false };
      },
    };
    const queue: RunAgentJob[] = [{ orgId: ctx.org.id, agentId: ctx.agent.id }];
    const d = { provider: leaderProvider, publish: async () => {}, enqueue: async (j: RunAgentJob) => (queue.push(j), true) };
    for (let i = 0; i < 20 && queue.length; i++) await runAgent(db, queue.shift()!, d);

    const longs = await db.select().from(schema.memories).where(eq(schema.memories.scope, "LONG"));
    expect(longs.map((m) => m.agentId).sort()).toEqual([ctx.agent.id, member.id].sort());
    expect(longs.every((m) => m.content === "조사 범위를 먼저 정하면 빠르다")).toBe(true);
    const [mid] = await db.select().from(schema.memories).where(and(eq(schema.memories.scope, "MID"), eq(schema.memories.agentId, member.id)));
    expect(mid).toMatchObject({ missionId: mission.id, content: "키워드를 3개로 좁힌다" });
    const [final] = await db.select().from(schema.artifacts).where(eq(schema.artifacts.agentId, ctx.agent.id));
    expect(final.content).not.toContain("팀 교훈");
    expect(final.content).toContain("성공 기준 점검");
  });
});
