// F008 팀원 루프 + F014 긴급 정지(1턴 내 중단) 테스트. 실제 DB(PGlite) + 가짜 LLM 제공사.
import { encryptSecret } from "@agentorg/shared/crypto";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import type { LLMProvider, LLMRequest } from "@agentorg/shared/llm/provider";
import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentsWithPendingDirectives } from "@agentorg/shared/queue";
import { runAgent } from "../src/loops/member";
import { createTestDb, seed } from "./testDb";

const KEY = "22".repeat(32);
beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

let db: AnyDb;
let ctx: Awaited<ReturnType<typeof seed>>;
const noPublish = async () => {};

function fakeProvider(onCall?: (req: LLMRequest) => Promise<void>) {
  const calls: LLMRequest[] = [];
  const provider: LLMProvider = {
    name: "anthropic",
    async complete(_key, req) {
      calls.push(req);
      await onCall?.(req);
      const asked = req.messages[0].content;
      return {
        text: `# ${asked} 결과\n\n본문입니다.`,
        model: req.model,
        stopReason: "end_turn",
        usage: [{ model: req.model, inputTokens: 100, outputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0 }],
        webSearchRequests: req.webSearchMaxUses ? 1 : 0,
        webSearchEnabled: Boolean(req.webSearchMaxUses),
      };
    },
  };
  return { provider, calls };
}

async function setPerms(perms: Record<string, boolean>) {
  await db.update(schema.agents).set({ toolPermissions: perms }).where(eq(schema.agents.id, ctx.agent.id));
}
async function userDirective(content: string) {
  const [m] = await db.insert(schema.messages).values({ orgId: ctx.org.id, senderType: "USER", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content }).returning();
  return m;
}
async function agentDirective(content: string, fromAgentId: string) {
  const [m] = await db
    .insert(schema.messages)
    .values({ orgId: ctx.org.id, senderType: "AGENT", senderAgentId: fromAgentId, receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content })
    .returning();
  return m;
}
const job = () => ({ orgId: ctx.org.id, agentId: ctx.agent.id });
const unread = () =>
  db.select().from(schema.messages).where(and(eq(schema.messages.receiverAgentId, ctx.agent.id), eq(schema.messages.type, "DIRECTIVE"), isNull(schema.messages.readAt)));

beforeEach(async () => {
  db = await createTestDb();
  ctx = await seed(db, { budgetDaily: 20000, maxTurns: 5 });
  await db.insert(schema.apiKeys).values({ userId: ctx.user.id, provider: "anthropic", encryptedKey: encryptSecret("sk-ant-test", KEY) });
});

describe("F008 팀원 루프", () => {
  it("지시를 받아 산출물 1개를 저장하고 사용자에게 보고한다", async () => {
    await setPerms({ document: true });
    const d = await userDirective("AI 동향 요약");
    const { provider } = fakeProvider();

    const r = await runAgent(db, job(), { provider, publish: noPublish });

    expect(r).toEqual({ turns: 1 });
    const [art] = await db.select().from(schema.artifacts);
    expect(art).toMatchObject({ orgId: ctx.org.id, agentId: ctx.agent.id, title: "AI 동향 요약 결과", format: "markdown", missionId: null });
    const [rep] = await db.select().from(schema.messages).where(eq(schema.messages.type, "REPORT"));
    expect(rep).toMatchObject({ senderType: "AGENT", senderAgentId: ctx.agent.id, receiverAgentId: null });
    expect(rep.payload).toMatchObject({ directiveId: d.id, artifactId: art.id });
    expect(await unread()).toHaveLength(0);
    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, ctx.agent.id));
    expect(agent.status).toBe("IDLE");
    const actions = (await db.select().from(schema.auditLogs)).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["llm.call", "artifact.create", "message.report", "agent.status"]));
    expect(await db.select().from(schema.costLogs)).toHaveLength(1);
  });

  it("문서 작성 권한이 없으면 산출물 없이 보고에 내용을 담는다", async () => {
    await setPerms({});
    await userDirective("인사말");
    await runAgent(db, job(), { provider: fakeProvider().provider, publish: noPublish });
    expect(await db.select().from(schema.artifacts)).toHaveLength(0);
    const [rep] = await db.select().from(schema.messages).where(eq(schema.messages.type, "REPORT"));
    expect(rep.content).toContain("인사말 결과");
  });

  it("웹 검색은 권한이 있을 때만 요청한다", async () => {
    const { provider, calls } = fakeProvider();
    await setPerms({ document: true });
    await userDirective("첫 번째");
    await runAgent(db, job(), { provider, publish: noPublish });
    await setPerms({ document: true, web_search: true });
    await userDirective("두 번째");
    await runAgent(db, job(), { provider, publish: noPublish });
    expect(calls.map((c) => c.webSearchMaxUses)).toEqual([undefined, 5]);
  });

  it("에이전트가 보낸 지시보다 사용자 지시를 먼저 처리한다", async () => {
    const [leader] = await db.insert(schema.agents).values({ orgId: ctx.org.id, name: "하나", rank: "LEADER" }).returning();
    await agentDirective("리더 지시", leader.id);
    await userDirective("사용자 지시");
    const { provider, calls } = fakeProvider();
    await runAgent(db, job(), { provider, publish: noPublish });
    expect(calls.map((c) => c.messages[0].content)).toEqual(["사용자 지시", "리더 지시"]);
    // 리더 지시에 대한 보고는 리더에게 간다
    const reports = await db.select().from(schema.messages).where(eq(schema.messages.type, "REPORT"));
    expect(reports.map((r) => r.receiverAgentId).sort()).toEqual([leader.id, null].sort());
  });

  it("사용자가 멈춘(PAUSED) 에이전트는 일하지 않는다", async () => {
    await db.update(schema.agents).set({ status: "PAUSED" }).where(eq(schema.agents.id, ctx.agent.id));
    await userDirective("일해");
    const { provider, calls } = fakeProvider();
    expect(await runAgent(db, job(), { provider, publish: noPublish })).toEqual({ turns: 0, stopped: "AGENT_PAUSED" });
    expect(calls).toHaveLength(0);
  });

  it("API 키가 없으면 지시를 남겨 두고 사용자에게 알린다", async () => {
    await db.delete(schema.apiKeys);
    await userDirective("일해");
    const r = await runAgent(db, job(), { provider: fakeProvider().provider, publish: noPublish });
    expect(r.stopped).toBe("AGENT_INACTIVE");
    expect(await unread()).toHaveLength(1);
    const [rep] = await db.select().from(schema.messages).where(eq(schema.messages.type, "REPORT"));
    expect(rep.content).toContain("API 키");
  });
});

describe("F014 긴급 정지 — 실행 중에 켜면 1턴 안에 멈춘다", () => {
  it("3개 지시 중 첫 번째 처리 중에 긴급 정지 → 첫 턴만 마치고 나머지는 그대로 남는다", async () => {
    await setPerms({ document: true });
    await userDirective("지시 1");
    await userDirective("지시 2");
    await userDirective("지시 3");
    // 첫 LLM 호출 도중 사용자가 긴급 정지 버튼을 누른 상황
    const { provider, calls } = fakeProvider(async () => {
      await db.update(schema.organizations).set({ emergencyStop: true }).where(eq(schema.organizations.id, ctx.org.id));
    });

    const r = await runAgent(db, job(), { provider, publish: noPublish });

    expect(r).toEqual({ turns: 1, stopped: "EMERGENCY_STOP" });
    expect(calls).toHaveLength(1); // 두 번째 LLM 호출은 일어나지 않음
    expect((await unread()).map((m) => m.content)).toEqual(["지시 2", "지시 3"]); // 재개하면 이어서 처리
    const stops = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "agent.turn_stopped"));
    expect(stops.map((s) => s.reasoning)).toEqual(["EMERGENCY_STOP"]);
  });

  it("재개하면 남은 지시를 이어서 처리한다", async () => {
    await setPerms({ document: true });
    await userDirective("지시 1");
    await userDirective("지시 2");
    await db.update(schema.organizations).set({ emergencyStop: true }).where(eq(schema.organizations.id, ctx.org.id));
    const { provider, calls } = fakeProvider();
    expect(await runAgent(db, job(), { provider, publish: noPublish })).toEqual({ turns: 0, stopped: "EMERGENCY_STOP" });
    expect(calls).toHaveLength(0);

    await db.update(schema.organizations).set({ emergencyStop: false }).where(eq(schema.organizations.id, ctx.org.id));
    expect(await runAgent(db, job(), { provider, publish: noPublish })).toEqual({ turns: 2 });
    expect(await unread()).toHaveLength(0);
  });

  it("최대 턴 수에 도달하면 멈추고 지시한 상사에게 알린다", async () => {
    await db.update(schema.agents).set({ maxTurns: 1 }).where(eq(schema.agents.id, ctx.agent.id));
    const [leader] = await db.insert(schema.agents).values({ orgId: ctx.org.id, name: "하나", rank: "LEADER" }).returning();
    await agentDirective("A", leader.id);
    await agentDirective("B", leader.id);
    const r = await runAgent(db, job(), { provider: fakeProvider().provider, publish: noPublish });
    expect(r).toEqual({ turns: 1, stopped: "MAX_TURNS" });
    const reports = await db.select().from(schema.messages).where(eq(schema.messages.type, "REPORT"));
    expect(reports.some((m) => m.content.includes("최대 턴 수") && m.receiverAgentId === leader.id)).toBe(true);
  });
});

describe("작업 유실 방지 — 주기 점검", () => {
  it("처리 안 된 지시가 있는 에이전트를 찾되, 긴급 정지 중인 조직은 빼고 찾는다", async () => {
    expect(await agentsWithPendingDirectives(db)).toEqual([]);
    await userDirective("남은 지시");
    expect(await agentsWithPendingDirectives(db)).toEqual([{ orgId: ctx.org.id, agentId: ctx.agent.id }]);
    await db.update(schema.organizations).set({ emergencyStop: true }).where(eq(schema.organizations.id, ctx.org.id));
    expect(await agentsWithPendingDirectives(db)).toEqual([]);
  });
});
