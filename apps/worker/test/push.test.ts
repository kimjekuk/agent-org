// F017 웹 푸시 테스트: VAPID 키 자동 생성·보관, 만료 구독 정리, 예산 경고 하루 1번. 실제 DB(PGlite) + 가짜 web-push
import { encryptSecret } from "@agentorg/shared/crypto";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import { callLLM } from "@agentorg/shared/llm/gateway";
import type { LLMProvider } from "@agentorg/shared/llm/provider";
import { getVapidKeys, notifyOrgOwner } from "@agentorg/shared/push";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seed } from "./testDb";

const sent: { endpoint: string; payload: string }[] = [];
let failWith: number | null = null;
vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: () => ({ publicKey: `pub-${Math.random()}`, privateKey: "priv" }),
    sendNotification: async (sub: { endpoint: string }, payload: string) => {
      if (failWith) throw Object.assign(new Error("push 실패"), { statusCode: failWith });
      sent.push({ endpoint: sub.endpoint, payload });
    },
  },
}));

const KEY = "44".repeat(32);
beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

let db: AnyDb;
let ctx: Awaited<ReturnType<typeof seed>>;

async function subscribe(endpoint = "https://push.example/1") {
  await db.insert(schema.pushSubscriptions).values({ userId: ctx.user.id, endpoint, p256dh: "p", auth: "a" });
}

beforeEach(async () => {
  db = await createTestDb();
  ctx = await seed(db, { budgetDaily: 100 });
  sent.length = 0;
  failWith = null;
});

describe("F017 웹 푸시", () => {
  it("VAPID 키는 처음 한 번 만들어 암호화 저장하고, 이후 같은 키를 쓴다", async () => {
    const a = await getVapidKeys(db);
    const b = await getVapidKeys(db);
    expect(b).toEqual(a);
    const [row] = await db.select().from(schema.appSecrets);
    expect(row.encryptedValue).not.toContain(a.publicKey); // 평문으로 저장하지 않는다
  });

  it("조직 소유자의 기기마다 보내고, 구독이 없으면 아무것도 하지 않는다", async () => {
    expect(await notifyOrgOwner(db, ctx.org.id, { title: "t", body: "b", url: "/x" })).toBe(0);
    await subscribe("https://push.example/1");
    await subscribe("https://push.example/2");
    expect(await notifyOrgOwner(db, ctx.org.id, { title: "승인", body: "b", url: "/approvals/1" })).toBe(2);
    expect(JSON.parse(sent[0].payload)).toMatchObject({ title: "승인", url: "/approvals/1" });
  });

  it("만료된 구독(410)은 지우고, 실패해도 예외를 던지지 않는다", async () => {
    await subscribe();
    failWith = 410;
    await expect(notifyOrgOwner(db, ctx.org.id, { title: "t", body: "b", url: "/" })).resolves.toBe(0);
    expect(await db.select().from(schema.pushSubscriptions)).toHaveLength(0);
  });

  it("예산 70%를 넘으면 하루 한 번만 경고한다 (감사 로그 + 알림)", async () => {
    await db.insert(schema.apiKeys).values({ userId: ctx.user.id, provider: "anthropic", encryptedKey: encryptSecret("sk-ant-test", KEY) });
    await subscribe();
    await db.insert(schema.costLogs).values({ orgId: ctx.org.id, provider: "anthropic", model: "claude-haiku-5-5", inputTokens: 1, outputTokens: 1, cost: "72" });
    const provider: LLMProvider = {
      name: "anthropic",
      complete: async (_k, req) => ({ text: "ok", model: req.model, stopReason: "end_turn", usage: [], webSearchRequests: 0, webSearchEnabled: false }),
    };
    const call = { orgId: ctx.org.id, actor: { type: "SYSTEM" as const }, purpose: "시험", model: "claude-haiku-5-5", messages: [{ role: "user" as const, content: "hi" }] };
    await callLLM(db, call, provider);
    await callLLM(db, call, provider);

    const warns = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "budget.warn"));
    expect(warns).toHaveLength(1);
    expect(sent.filter((s) => JSON.parse(s.payload).tag === "budget-warn")).toHaveLength(1);
  });
});
