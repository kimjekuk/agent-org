// F110 코드 실행 도구 권한: 켠 에이전트만 요청에 코드 실행을 넘기고, 되는 모델(Sonnet·Opus)이면 지침도 넣는다. 실행 횟수는 보고·감사 로그에
import { encryptSecret } from "@agentorg/shared/crypto";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import type { LLMProvider, LLMRequest } from "@agentorg/shared/llm/provider";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "../src/loops/member";
import { createTestDb, seed } from "./testDb";

const KEY = "ff".repeat(32);
beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

describe("F110 코드 실행 권한", () => {
  let db: AnyDb;
  let ctx: Awaited<ReturnType<typeof seed>>;
  let calls: LLMRequest[];
  const provider: LLMProvider = {
    name: "anthropic",
    async complete(_k, req) {
      calls.push(req);
      return { text: "# 계산\n\n| 합 |\n|---|\n| 2 |", model: req.model, stopReason: "end_turn", usage: [], webSearchRequests: 0, webSearchEnabled: false, codeExecutions: req.codeExecution ? 2 : 0 };
    },
  };
  const deps = { provider, publish: async () => {}, enqueue: async () => true };

  beforeEach(async () => {
    db = await createTestDb();
    ctx = await seed(db, { budgetDaily: 100000 });
    calls = [];
    await db.insert(schema.apiKeys).values({ userId: ctx.user.id, provider: "anthropic", encryptedKey: encryptSecret("sk-ant-test", KEY) });
  });

  async function direct(perms: Record<string, boolean>, model: string) {
    await db.update(schema.agents).set({ toolPermissions: perms, modelPrimary: model, maxTurns: 30 }).where(eq(schema.agents.id, ctx.agent.id));
    await db.insert(schema.messages).values({ orgId: ctx.org.id, senderType: "USER", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content: "1+1 계산해 표로" });
    await runAgent(db, { orgId: ctx.org.id, agentId: ctx.agent.id }, deps);
    return calls.at(-1)!;
  }

  it("권한을 켠 Sonnet 에이전트: 코드 실행을 요청하고 지침을 넣으며, 실행 횟수를 보고·감사 로그에 남긴다", async () => {
    const req = await direct({ document: true, code_exec: true }, "claude-sonnet-5-5");
    expect(req.codeExecution).toBe(true);
    expect(req.system).toContain("코드 실행 도구(파이썬)");
    const [report] = await db.select().from(schema.messages).where(eq(schema.messages.type, "REPORT"));
    expect(report.payload).toMatchObject({ codeExecutions: 2 });
    const [log] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "llm.call"));
    expect(log.payload).toMatchObject({ codeExecutions: 2 });
  });

  it("권한이 없으면 요청하지 않고, Haiku면 권한이 있어도 지침을 넣지 않는다 (제공사가 도구를 빼고 부름)", async () => {
    const off = await direct({ document: true }, "claude-sonnet-5-5");
    expect(off.codeExecution).toBe(false);
    expect(off.system).not.toContain("코드 실행 도구");
    const haiku = await direct({ document: true, code_exec: true }, "claude-haiku-5-5");
    expect(haiku.system).not.toContain("코드 실행 도구");
  });
});
