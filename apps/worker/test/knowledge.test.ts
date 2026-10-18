// F105 지식 베이스 테스트: 키워드 검색, 미션 완료·좋은 산출물 자동 등록, 일 시작 때 관련 문서 참고
import { encryptSecret } from "@agentorg/shared/crypto";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import { addArtifactToKnowledge, keywords, knowledgeContext, saveKnowledgeDoc, searchKnowledge } from "@agentorg/shared/knowledge";
import type { LLMProvider, LLMRequest } from "@agentorg/shared/llm/provider";
import type { MissionMessagePayload } from "@agentorg/shared/missions";
import type { RunAgentJob } from "@agentorg/shared/queue";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "../src/loops/member";
import { createTestDb, seed } from "./testDb";

const KEY = "99".repeat(32);
beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

describe("키워드", () => {
  it("조사·불용어를 떼고 2글자 이상만 남긴다", () => {
    expect(keywords("숏폼 트렌드를 정리해줘")).toEqual(["숏폼", "트렌드"]);
    expect(keywords("2026년 AI 뉴스의 요약")).toEqual(["2026년", "ai", "뉴스", "요약"]);
  });
});

describe("지식 베이스", () => {
  let db: AnyDb;
  let ctx: Awaited<ReturnType<typeof seed>>;
  let calls: LLMRequest[];

  beforeEach(async () => {
    db = await createTestDb();
    ctx = await seed(db, { budgetDaily: 100000 });
    calls = [];
    await db.update(schema.agents).set({ toolPermissions: { document: true }, maxTurns: 30 }).where(eq(schema.agents.id, ctx.agent.id));
    await db.insert(schema.apiKeys).values({ userId: ctx.user.id, provider: "anthropic", encryptedKey: encryptSecret("sk-ant-test", KEY) });
  });

  const doc = (title: string, content: string, tags: string[] = []) => saveKnowledgeDoc(db, { orgId: ctx.org.id, userId: ctx.user.id, title, content, tags });

  it("제목·태그·본문 순으로 점수를 매기고, 다른 조직 문서는 찾지 않는다", async () => {
    await doc("숏폼 트렌드 조사법", "출처는 공식 통계 우선");
    await doc("회의록", "숏폼 이야기가 잠깐 나옴");
    await doc("요리 레시피", "김치찌개", ["요리"]);
    const [other] = await db.insert(schema.organizations).values({ ownerId: ctx.user.id, name: "다른 조직" }).returning();
    await saveKnowledgeDoc(db, { orgId: other.id, userId: ctx.user.id, title: "숏폼 트렌드 비밀", content: "x", tags: [] });

    const hits = await searchKnowledge(db, ctx.org.id, "숏폼 트렌드 정리");
    expect(hits.map((h) => h.title)).toEqual(["숏폼 트렌드 조사법", "회의록"]);
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "knowledge.create"))).toHaveLength(4);
  });

  it("지시와 관련된 문서는 일 시작 때 시스템 프롬프트에 붙고, 관련 없으면 붙지 않는다", async () => {
    await doc("숏폼 트렌드 조사법", "출처는 공식 통계를 먼저 본다");
    const provider: LLMProvider = {
      name: "anthropic",
      async complete(_k, req) {
        calls.push(req);
        return { text: "# 결과\n\n본문", model: req.model, stopReason: "end_turn", usage: [], webSearchRequests: 0, webSearchEnabled: false };
      },
    };
    const deps = { provider, publish: async () => {}, enqueue: async () => true };
    for (const content of ["이번 주 숏폼 트렌드를 정리해줘", "김치찌개 맛집 추천"]) {
      await db.insert(schema.messages).values({ orgId: ctx.org.id, senderType: "USER", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content });
      await runAgent(db, { orgId: ctx.org.id, agentId: ctx.agent.id }, deps);
    }
    expect(calls[0].system).toContain("# 조직 지식 (참고)");
    expect(calls[0].system).toContain("출처는 공식 통계를 먼저 본다");
    expect(calls[0].system?.indexOf("# 최우선 원칙")).toBe(0);
    expect(calls[1].system).not.toContain("# 조직 지식");
  });

  it("같은 Task의 새 버전은 새 문서를 만들지 않고 고친다", async () => {
    const [mission] = await db.insert(schema.missions).values({ orgId: ctx.org.id, title: "m", topic: "m", status: "RUNNING" }).returning();
    const [task] = await db.insert(schema.tasks).values({ missionId: mission.id, title: "조사" }).returning();
    const base = { orgId: ctx.org.id, missionId: mission.id, taskId: task.id, agentId: ctx.agent.id, format: "markdown" };
    const [v1] = await db.insert(schema.artifacts).values({ ...base, title: "조사 v1", content: "옛 내용", version: 1 }).returning();
    const [v2] = await db.insert(schema.artifacts).values({ ...base, title: "조사 v2", content: "새 내용", version: 2 }).returning();
    await addArtifactToKnowledge(db, v1, { type: "USER", id: ctx.user.id }, "평가 5점");
    await addArtifactToKnowledge(db, v2, { type: "USER", id: ctx.user.id }, "평가 4점");
    const docs = await db.select().from(schema.knowledgeDocs);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ title: "조사 v2", content: "새 내용", artifactId: v2.id, source: "ARTIFACT" });
    // 지금 하는 미션의 자료는 그 미션에 다시 넣지 않는다
    expect(await knowledgeContext(db, ctx.org.id, "조사 내용", mission.id)).toBe("");
    expect(await knowledgeContext(db, ctx.org.id, "조사 내용")).toContain("새 내용");
  });

  it("미션이 끝나면 최종 결과가 지식 베이스에 자동으로 들어간다", async () => {
    const [member] = await db
      .insert(schema.agents)
      .values({ orgId: ctx.org.id, name: "두리", rank: "MEMBER", skills: ["조사"], toolPermissions: { document: true }, maxTurns: 30 })
      .returning();
    await db.update(schema.agents).set({ rank: "LEADER", name: "하나" }).where(eq(schema.agents.id, ctx.agent.id));
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
              ? "# 트렌드 최종 보고서\n\n최종 본문"
              : "# 조사 결과\n\n내용";
        return { text, model: req.model, stopReason: "end_turn", usage: [], webSearchRequests: 0, webSearchEnabled: false };
      },
    };
    const queue: RunAgentJob[] = [{ orgId: ctx.org.id, agentId: ctx.agent.id }];
    const deps = { provider, publish: async () => {}, enqueue: async (j: RunAgentJob) => (queue.push(j), true) };
    for (let i = 0; i < 20 && queue.length; i++) await runAgent(db, queue.shift()!, deps);

    expect((await db.select().from(schema.missions))[0].status).toBe("DONE");
    const docs = await db.select().from(schema.knowledgeDocs);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ title: "트렌드 최종 보고서", source: "MISSION", missionId: mission.id, sourceKey: `mission:${mission.id}` });
    expect(member.id).toBeTruthy();
  });
});
