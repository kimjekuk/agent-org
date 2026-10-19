// F103 테스트: 성격 유형이 프롬프트의 '일하는 방식'으로 들어감, 하루 일지(한국 시간 하루) 자동 정리
import { personalityPrompt } from "@agentorg/shared/agents/personality";
import { encryptSecret } from "@agentorg/shared/crypto";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import { agentDailyJournal, kstDayRange, shiftDay } from "@agentorg/shared/journal";
import type { LLMProvider, LLMRequest } from "@agentorg/shared/llm/provider";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "../src/loops/member";
import { createTestDb, seed } from "./testDb";

const KEY = "aa".repeat(32);
beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

describe("한국 시간 하루", () => {
  it("UTC 15시 이후는 한국 날짜로 다음 날이다", () => {
    expect(kstDayRange(null, new Date("2026-10-18T15:30:00Z")).day).toBe("2026-10-19");
    const r = kstDayRange("2026-10-19");
    expect(r.start.toISOString()).toBe("2026-10-18T15:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-10-19T15:00:00.000Z");
    expect(kstDayRange("엉터리", new Date("2026-10-18T00:00:00Z")).day).toBe("2026-10-18");
    expect(shiftDay("2026-11-01", -1)).toBe("2026-10-31");
  });
});

describe("성격 유형 · 하루 일지", () => {
  let db: AnyDb;
  let ctx: Awaited<ReturnType<typeof seed>>;
  let calls: LLMRequest[];
  let fail: boolean;
  const provider: LLMProvider = {
    name: "anthropic",
    async complete(_k, req) {
      calls.push(req);
      if (fail) throw new Error("일시적 오류");
      return {
        text: "# 결과\n\n본문\n\n## 기억할 점\n- 표로 정리하면 좋다",
        model: req.model,
        stopReason: "end_turn",
        usage: [{ model: req.model, inputTokens: 1000, outputTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0 }],
        webSearchRequests: 0,
        webSearchEnabled: false,
      };
    },
  };
  const deps = { provider, publish: async () => {}, enqueue: async () => true };

  beforeEach(async () => {
    db = await createTestDb();
    ctx = await seed(db, { budgetDaily: 100000 });
    calls = [];
    fail = false;
    await db.update(schema.agents).set({ toolPermissions: { document: true }, maxTurns: 30, personalityType: "ANALYTIC" }).where(eq(schema.agents.id, ctx.agent.id));
    await db.insert(schema.apiKeys).values({ userId: ctx.user.id, provider: "anthropic", encryptedKey: encryptSecret("sk-ant-test", KEY) });
  });

  async function directive(content: string) {
    await db.insert(schema.messages).values({ orgId: ctx.org.id, senderType: "USER", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content });
    await runAgent(db, { orgId: ctx.org.id, agentId: ctx.agent.id }, deps);
  }

  it("성격 유형의 일하는 방식·말투가 시스템 프롬프트에 들어간다 (최우선 원칙은 맨 앞)", async () => {
    await directive("시장 조사");
    expect(calls[0].system).toContain(`# 일하는 방식\n${personalityPrompt("ANALYTIC")}`);
    expect(calls[0].system?.indexOf("# 최우선 원칙")).toBe(0);
    expect(personalityPrompt(null)).toBe("");
    expect(personalityPrompt("없는유형")).toBe("");
  });

  it("오늘 한 일(보고·산출물·실패·기억·AI 호출·비용)을 모으고, 어제는 비어 있다", async () => {
    await directive("시장 조사");
    fail = true;
    await directive("경쟁사 분석");

    const j = await agentDailyJournal(db, ctx.agent.id);
    expect(j).toMatchObject({ reports: 1, llmCalls: 1, memories: ["표로 정리하면 좋다"] });
    expect(j.artifacts.map((a) => a.title)).toEqual(["결과"]);
    expect(j.failures).toHaveLength(1);
    expect(j.costKrw).toBeCloseTo(0.84, 4); // 기본 모델 Haiku 5.5: 입력·출력 1천 토큰 = $0.0006 = 0.84원
    expect(j.firstAt).not.toBeNull();

    const yesterday = await agentDailyJournal(db, ctx.agent.id, shiftDay(j.day, -1));
    expect(yesterday).toMatchObject({ reports: 0, llmCalls: 0, artifacts: [], failures: [] });
  });
});
