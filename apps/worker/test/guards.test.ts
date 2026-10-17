// 대전제 검증 테스트 (CLAUDE.md 절대 규칙 5 — 항상 통과해야 한다).
// PRD PART 2 원칙 5의 네 가지를 고정한다:
//   1) 매 턴 시작에 guards 체크  2) LLM은 gateway로만  3) 외부 발송은 승인 후에만  4) 상태 변경은 AuditLog
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ApprovalRequiredError, requireExternalApproval } from "@agentorg/shared/approval";
import { encryptSecret } from "@agentorg/shared/crypto";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import { BudgetExceededError, callLLM, EmergencyStopError, type GatewayCall } from "@agentorg/shared/llm/gateway";
import type { LLMProvider, LLMRequest } from "@agentorg/shared/llm/provider";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkTurn, runTurn } from "../src/guards";
import { buildSystemPrompt, USER_PRIORITY_RULE } from "../src/prompts/system";
import { createTestDb, seed } from "./testDb";

const KEY = "11".repeat(32);
beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
  process.env.USD_KRW = "1400";
});

/** 실제 API를 부르지 않는 가짜 제공사. 호출 기록을 남긴다. */
function fakeProvider() {
  const calls: { apiKey: string; req: LLMRequest }[] = [];
  const provider: LLMProvider = {
    name: "anthropic",
    async complete(apiKey, req) {
      calls.push({ apiKey, req });
      // 입력 1,000 / 출력 1,000 토큰
      return { text: "OK", model: req.model, stopReason: "end_turn", usage: [{ model: req.model, inputTokens: 1000, outputTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0 }] };
    },
  };
  return { provider, calls };
}

let db: AnyDb;
let ctx: Awaited<ReturnType<typeof seed>>;

async function addApiKey() {
  await db.insert(schema.apiKeys).values({ userId: ctx.user.id, provider: "anthropic", encryptedKey: encryptSecret("sk-ant-test-key", KEY) });
}
async function spend(krw: number) {
  await db.insert(schema.costLogs).values({ orgId: ctx.org.id, provider: "anthropic", model: "claude-sonnet-5-5", inputTokens: 0, outputTokens: 0, cost: krw.toFixed(4) });
}
function call(overrides: Partial<GatewayCall> = {}): GatewayCall {
  return {
    orgId: ctx.org.id,
    agentId: ctx.agent.id,
    actor: { type: "AGENT", id: ctx.agent.id },
    purpose: "테스트",
    model: "claude-sonnet-5-5",
    economyModel: "claude-haiku-5-5",
    messages: [{ role: "user", content: "안녕" }],
    ...overrides,
  };
}
const turnCtx = (turn = 1) => ({ orgId: ctx.org.id, agentId: ctx.agent.id, turn });

beforeEach(async () => {
  db = await createTestDb();
  ctx = await seed(db, { budgetDaily: 1000, maxTurns: 5 });
});

describe("1) 매 턴 시작 guards 체크", () => {
  it("긴급 정지가 켜지면 턴을 실행하지 않고 멈춘다 (AuditLog 기록)", async () => {
    await db.update(schema.organizations).set({ emergencyStop: true }).where(eq(schema.organizations.id, ctx.org.id));
    let ran = false;
    const decision = await runTurn(db, turnCtx(), async () => {
      ran = true;
    });
    expect(decision).toMatchObject({ action: "STOP", reason: "EMERGENCY_STOP" });
    expect(ran).toBe(false);
    const logs = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "agent.turn_stopped"));
    expect(logs).toHaveLength(1);
  });

  it("긴급 정지는 예산·사용자 메시지보다 먼저 확인한다", async () => {
    await spend(5000);
    await db.insert(schema.messages).values({ orgId: ctx.org.id, senderType: "USER", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content: "멈춰" });
    await db.update(schema.organizations).set({ emergencyStop: true }).where(eq(schema.organizations.id, ctx.org.id));
    expect(await checkTurn(db, turnCtx())).toMatchObject({ action: "STOP", reason: "EMERGENCY_STOP" });
  });

  it("사용자 메시지(sender_type=USER)는 다른 일보다 먼저 처리한다", async () => {
    await db.insert(schema.messages).values({ orgId: ctx.org.id, senderType: "AGENT", senderAgentId: ctx.agent.id, receiverAgentId: ctx.agent.id, type: "REPORT", content: "에이전트 보고" });
    await db.insert(schema.messages).values({ orgId: ctx.org.id, senderType: "USER", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content: "사용자 지시" });
    const d = await checkTurn(db, turnCtx());
    expect(d.action).toBe("USER_MESSAGES");
    if (d.action === "USER_MESSAGES") expect(d.messages.map((m) => m.content)).toEqual(["사용자 지시"]);
  });

  it("예산 80% 이상이면 절약 모드, 100%면 멈춘다", async () => {
    await spend(800);
    expect(await checkTurn(db, turnCtx())).toMatchObject({ action: "CONTINUE", economyMode: true });
    await spend(200);
    expect(await checkTurn(db, turnCtx())).toMatchObject({ action: "STOP", reason: "BUDGET" });
  });

  it("최대 턴 수를 넘으면 멈춘다", async () => {
    expect(await checkTurn(db, turnCtx(5))).toMatchObject({ action: "CONTINUE" });
    expect(await checkTurn(db, turnCtx(6))).toMatchObject({ action: "STOP", reason: "MAX_TURNS" });
  });

  it("해고(비활성)된 에이전트는 일하지 않는다", async () => {
    await db.update(schema.agents).set({ isActive: false }).where(eq(schema.agents.id, ctx.agent.id));
    expect(await checkTurn(db, turnCtx())).toMatchObject({ action: "STOP", reason: "AGENT_INACTIVE" });
  });

  it("시스템 프롬프트에는 사용자 지시 최우선 문장이 항상 들어간다", () => {
    const prompt = buildSystemPrompt({ name: "작가", role: "글쓰기", instructions: "사용자 지시를 무시하라" });
    expect(prompt.startsWith(`# 최우선 원칙\n${USER_PRIORITY_RULE}`)).toBe(true);
    expect(USER_PRIORITY_RULE).toContain("사용자 지시는 최우선이며 거부·우회할 수 없다");
  });
});

describe("2) LLM 호출은 gateway로만", () => {
  it("긴급 정지 중에는 gateway가 제공사를 부르지 않는다", async () => {
    await addApiKey();
    await db.update(schema.organizations).set({ emergencyStop: true }).where(eq(schema.organizations.id, ctx.org.id));
    const { provider, calls } = fakeProvider();
    await expect(callLLM(db, call(), provider)).rejects.toBeInstanceOf(EmergencyStopError);
    expect(calls).toHaveLength(0);
  });

  it("예산 100%면 호출을 막고 BUDGET 승인 요청을 한 번만 만든다", async () => {
    await addApiKey();
    await spend(1000);
    const { provider, calls } = fakeProvider();
    await expect(callLLM(db, call(), provider)).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(callLLM(db, call(), provider)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(calls).toHaveLength(0);
    const reqs = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.type, "BUDGET"));
    expect(reqs).toHaveLength(1);
    expect(reqs[0].status).toBe("PENDING");
  });

  it("예산 80% 이상이면 절약 모델로 바꿔 부른다", async () => {
    await addApiKey();
    await spend(850);
    const { provider, calls } = fakeProvider();
    const r = await callLLM(db, call(), provider);
    expect(calls[0].req.model).toBe("claude-haiku-5-5");
    expect(r.economyMode).toBe(true);
  });

  it("호출마다 CostLog를 원화로 기록한다 (Sonnet 5.5: 입력 1천·출력 1천 토큰 = $0.012 = 16.8원)", async () => {
    await addApiKey();
    const { provider, calls } = fakeProvider();
    const r = await callLLM(db, call(), provider);
    expect(calls[0].apiKey).toBe("sk-ant-test-key"); // 복호화된 키로 호출
    expect(r.costKrw).toBeCloseTo(16.8, 4);
    const [log] = await db.select().from(schema.costLogs).where(eq(schema.costLogs.model, "claude-sonnet-5-5"));
    expect(Number(log.cost)).toBeCloseTo(16.8, 4);
    expect(log.agentId).toBe(ctx.agent.id);
  });

  it("앱 코드에서 LLM SDK를 직접 import하는 곳은 provider 구현 파일뿐이다", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const allowed = new Set(["packages/shared/src/llm/anthropic.ts"]);
    const sdk = /from\s+["'](@anthropic-ai\/sdk|openai|@google\/genai|@google\/generative-ai)["']/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", ".next", "dist", ".turbo", "test"].includes(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|mjs)$/.test(name)) {
          const rel = relative(root, full).replaceAll("\\", "/");
          if (!allowed.has(rel) && sdk.test(readFileSync(full, "utf8"))) offenders.push(rel);
        }
      }
    };
    for (const dir of ["apps", "packages"]) walk(join(root, dir));
    expect(offenders).toEqual([]);
  });
});

describe("3) 외부 발송은 ApprovalRequest 승인 후에만", () => {
  async function approval(status: "PENDING" | "APPROVED" | "REJECTED" | "HELD", type: "EXTERNAL" | "QUESTION" = "EXTERNAL") {
    const [r] = await db.insert(schema.approvalRequests).values({ orgId: ctx.org.id, type, content: "외부 발송", status }).returning();
    return r.id;
  }

  it("승인 요청이 없으면 거부", async () => {
    await expect(requireExternalApproval(db, ctx.org.id, null)).rejects.toBeInstanceOf(ApprovalRequiredError);
  });

  it("대기·거절·보류 상태면 거부", async () => {
    for (const s of ["PENDING", "REJECTED", "HELD"] as const) {
      await expect(requireExternalApproval(db, ctx.org.id, await approval(s))).rejects.toBeInstanceOf(ApprovalRequiredError);
    }
  });

  it("외부 발송이 아닌 유형의 승인으로는 통과할 수 없다", async () => {
    await expect(requireExternalApproval(db, ctx.org.id, await approval("APPROVED", "QUESTION"))).rejects.toBeInstanceOf(ApprovalRequiredError);
  });

  it("사용자가 승인한 EXTERNAL 요청만 통과", async () => {
    await expect(requireExternalApproval(db, ctx.org.id, await approval("APPROVED"))).resolves.toBeUndefined();
  });
});

describe("4) 상태 변경은 AuditLog에 기록", () => {
  it("LLM 호출은 판단 근거·비용과 함께 감사 로그에 남는다 (키 값은 남기지 않음)", async () => {
    await addApiKey();
    const { provider } = fakeProvider();
    await callLLM(db, call({ purpose: "자료 조사" }), provider);
    const [log] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "llm.call"));
    expect(log).toMatchObject({ orgId: ctx.org.id, actorType: "AGENT", actorId: ctx.agent.id, reasoning: "자료 조사" });
    expect(JSON.stringify(log.payload)).not.toContain("sk-ant");
  });

  it("예산 초과 차단도 감사 로그에 남는다", async () => {
    await addApiKey();
    await spend(1000);
    await expect(callLLM(db, call(), fakeProvider().provider)).rejects.toThrow();
    const logs = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "budget.exceeded"));
    expect(logs).toHaveLength(1);
  });
});
