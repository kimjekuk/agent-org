// 여러 LLM 제공사 테스트: OpenAI 호환 어댑터(OpenAI·Gemini·DeepSeek) + DB 요금표의 모델 찾기·비용 계산. 네트워크 없이 가짜 fetch/제공사
import { encryptSecret } from "@agentorg/shared/crypto";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import { callLLM, type GatewayCall, MissingApiKeyError } from "@agentorg/shared/llm/gateway";
import { listModelChoices, UnknownModelError } from "@agentorg/shared/llm/models";
import { createOpenAICompatibleProvider, OPENAI_COMPATIBLE, ProviderHttpError } from "@agentorg/shared/llm/openaiCompatible";
import type { LLMProvider, LLMRequest } from "@agentorg/shared/llm/provider";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed } from "./testDb";

const KEY = "55".repeat(32);
beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const request: LLMRequest = { model: "gpt-6.1-sol", system: "시스템", messages: [{ role: "user", content: "안녕" }], maxTokens: 500 };

describe("OpenAI 호환 어댑터", () => {
  it("system을 맨 앞 메시지로 보내고, 사용량(캐시 포함)을 요청한 모델 이름으로 돌려준다", async () => {
    const f = fakeFetch(200, {
      model: "gpt-6.1-sol-2026-09-01",
      choices: [{ message: { content: "반가워요" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 400 } },
    });
    const r = await createOpenAICompatibleProvider(OPENAI_COMPATIBLE.openai, f.fn).complete("sk-test", request);

    expect(f.calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect((f.calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(body).toEqual({ model: "gpt-6.1-sol", messages: [{ role: "system", content: "시스템" }, { role: "user", content: "안녕" }], max_completion_tokens: 500 });
    expect(r).toMatchObject({ text: "반가워요", model: "gpt-6.1-sol-2026-09-01", stopReason: "stop", webSearchEnabled: false });
    expect(r.usage).toEqual([{ model: "gpt-6.1-sol", inputTokens: 600, outputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 400 }]);
  });

  it("Gemini·DeepSeek은 각자의 주소와 max_tokens를 쓴다", async () => {
    for (const name of ["gemini", "deepseek"] as const) {
      const f = fakeFetch(200, { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
      await createOpenAICompatibleProvider(OPENAI_COMPATIBLE[name], f.fn).complete("k", request);
      expect(f.calls[0].url).toBe(OPENAI_COMPATIBLE[name].url);
      expect(JSON.parse(String(f.calls[0].init.body)).max_tokens).toBe(500);
    }
  });

  it("오류 응답은 상태 코드를 가진 오류로 던진다 (키 오류 401 안내용)", async () => {
    const f = fakeFetch(401, { error: { message: "invalid key" } });
    await expect(createOpenAICompatibleProvider(OPENAI_COMPATIBLE.deepseek, f.fn).complete("bad", request)).rejects.toMatchObject({
      name: "ProviderHttpError",
      status: 401,
    });
    expect(ProviderHttpError).toBeDefined();
  });
});

describe("gateway — DB 요금표의 모델", () => {
  let db: AnyDb;
  let ctx: Awaited<ReturnType<typeof seed>>;
  const calls: LLMRequest[] = [];
  const fake: LLMProvider = {
    name: "openai",
    async complete(_k, req) {
      calls.push(req);
      return {
        text: "ok",
        model: `${req.model}-dated`,
        stopReason: "stop",
        usage: [{ model: req.model, inputTokens: 1000, outputTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0 }],
        webSearchRequests: 0,
        webSearchEnabled: false,
      };
    },
  };
  const call = (over: Partial<GatewayCall> = {}): GatewayCall => ({
    orgId: ctx.org.id,
    actor: { type: "SYSTEM" },
    purpose: "시험",
    model: "gpt-6.1-sol",
    messages: [{ role: "user", content: "hi" }],
    ...over,
  });

  beforeEach(async () => {
    db = await createTestDb();
    ctx = await seed(db, { budgetDaily: 100000 });
    calls.length = 0;
  });

  it("후보 모델은 꺼진 채로 들어 있고, 꺼진 모델은 호출 전에 막는다", async () => {
    const rows = await db.select().from(schema.llmModels);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => !r.enabled)).toBe(true);
    await expect(callLLM(db, call(), fake)).rejects.toBeInstanceOf(UnknownModelError);
    expect(calls).toHaveLength(0);
  });

  it("켜진 모델은 DB 요금으로 비용을 기록한다 ($2/$10, 입력·출력 1천 토큰 = 16.8원)", async () => {
    await db.update(schema.llmModels).set({ enabled: true }).where(eq(schema.llmModels.id, "gpt-6.1-sol"));
    await db.insert(schema.apiKeys).values({ userId: ctx.user.id, provider: "openai", encryptedKey: encryptSecret("sk-openai-test", KEY) });
    const r = await callLLM(db, call(), fake);
    expect(r.costKrw).toBeCloseTo(16.8, 4);
    const [log] = await db.select().from(schema.costLogs);
    expect(log).toMatchObject({ provider: "openai", model: "gpt-6.1-sol-dated" });
    expect((await listModelChoices(db)).some((m) => m.id === "gpt-6.1-sol")).toBe(true);
  });

  it("제공사 키가 없으면 그 제공사 이름으로 알려 준다 (실제 호출 없음)", async () => {
    await db.update(schema.llmModels).set({ enabled: true }).where(eq(schema.llmModels.id, "deepseek-v4-pro"));
    await expect(callLLM(db, call({ model: "deepseek-v4-pro" }))).rejects.toThrow(new MissingApiKeyError("deepseek").message);
    expect(new MissingApiKeyError("deepseek").message).toContain("DeepSeek");
  });
});
