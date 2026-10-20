// F203 통계: 기간(한국 날짜), 비용(날짜·에이전트·모델), 생산성(통과·반려·실패·별점·건당 비용), 병목(승인 대기·오래 걸린 Task), 미션 요약
import { writeAudit } from "@agentorg/shared/audit";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import { eq as eq_ } from "drizzle-orm";
import { bottleneckStats, costStats, formatMinutes, missionSummaries, productivityStats, statsRange } from "@agentorg/shared/stats";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed } from "./testDb";

const NOW = new Date("2026-10-20T03:00:00Z"); // 한국 10월 20일 12시
const at = (iso: string) => new Date(iso);

describe("기간", () => {
  it("오늘·7일·30일은 한국 날짜로 끊고, 모르는 값은 7일", () => {
    const r = statsRange("7d", NOW);
    expect(r.days).toHaveLength(7);
    expect(r.days.at(-1)).toBe("2026-10-20");
    expect(r.start.toISOString()).toBe("2026-10-13T15:00:00.000Z");
    expect(statsRange("today", NOW).days).toEqual(["2026-10-20"]);
    expect(statsRange("엉터리", NOW).period).toBe("7d");
    expect(formatMinutes(5)).toBe("5분");
    expect(formatMinutes(125)).toBe("2시간 5분");
    expect(formatMinutes(60 * 27)).toBe("1일 3시간");
  });
});

describe("통계 집계", () => {
  let db: AnyDb;
  let ctx: Awaited<ReturnType<typeof seed>>;
  let duri: typeof schema.agents.$inferSelect;
  let mission: typeof schema.missions.$inferSelect;
  let task: typeof schema.tasks.$inferSelect;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = await seed(db);
    [duri] = await db.insert(schema.agents).values({ orgId: ctx.org.id, name: "두리" }).returning();
    [mission] = await db
      .insert(schema.missions)
      .values({ orgId: ctx.org.id, title: "트렌드", topic: "트렌드", status: "DONE", createdAt: at("2026-10-19T00:00:00Z") })
      .returning();
    [task] = await db.insert(schema.tasks).values({ missionId: mission.id, title: "조사", assigneeId: duri.id }).returning();
    const cost = (agentId: string, model: string, krw: number, when: string, missionId?: string) =>
      db.insert(schema.costLogs).values({ orgId: ctx.org.id, agentId, missionId, provider: "anthropic", model, inputTokens: 1, outputTokens: 1, cost: String(krw), createdAt: at(when) });
    await cost(ctx.agent.id, "claude-haiku-5-5", 10, "2026-10-19T14:59:00Z"); // 한국 19일
    await cost(duri.id, "claude-sonnet-5-5", 30, "2026-10-19T15:01:00Z", mission.id); // 한국 20일
    await cost(duri.id, "claude-sonnet-5-5", 20, "2026-10-20T01:00:00Z", mission.id);
    await cost(duri.id, "claude-sonnet-5-5", 999, "2026-10-01T00:00:00Z"); // 기간 밖
    const audit = (action: string, targetType: string, targetId: string, when: string) =>
      writeAudit(db, { orgId: ctx.org.id, actorType: "AGENT", action, targetType, targetId, reasoning: "" }).then(() =>
        db.update(schema.auditLogs).set({ createdAt: at(when) }).where(eq_(schema.auditLogs.action, action)),
      );
    await audit("task.dispatch", "task", task.id, "2026-10-19T00:10:00Z");
    await audit("task.reject", "task", task.id, "2026-10-19T00:40:00Z");
    await audit("task.review_pass", "task", task.id, "2026-10-19T01:40:00Z");
    await audit("mission.complete", "mission", mission.id, "2026-10-19T02:00:00Z");
    await db.insert(schema.messages).values({ orgId: ctx.org.id, senderType: "AGENT", senderAgentId: duri.id, type: "REPORT", content: "실패", payload: { failed: true }, createdAt: at("2026-10-19T00:20:00Z") });
    await db.insert(schema.artifacts).values([
      { orgId: ctx.org.id, agentId: duri.id, missionId: mission.id, taskId: task.id, title: "a", content: "x", rating: 4, createdAt: at("2026-10-19T01:00:00Z") },
      { orgId: ctx.org.id, agentId: ctx.agent.id, missionId: mission.id, title: "최종", content: "x", rating: 5, createdAt: at("2026-10-19T01:50:00Z") },
    ]);
    await db.insert(schema.approvalRequests).values([
      { orgId: ctx.org.id, type: "CHECKPOINT", content: "a", status: "APPROVED", createdAt: at("2026-10-19T00:00:00Z"), decidedAt: at("2026-10-19T00:30:00Z") },
      { orgId: ctx.org.id, type: "CHECKPOINT", content: "b", status: "REJECTED", createdAt: at("2026-10-19T00:00:00Z"), decidedAt: at("2026-10-19T01:30:00Z") },
      { orgId: ctx.org.id, type: "QUESTION", content: "c", status: "PENDING", createdAt: at("2026-10-20T01:00:00Z") },
    ]);
  });

  it("비용: 한국 날짜별·에이전트별·모델별, 기간 밖 제외", async () => {
    const c = await costStats(db, ctx.org.id, statsRange("7d", NOW));
    expect(c.totalKrw).toBe(60);
    expect(c.calls).toBe(3);
    expect(c.byDay.slice(-2)).toEqual([
      { day: "2026-10-19", krw: 10, calls: 1 },
      { day: "2026-10-20", krw: 50, calls: 2 },
    ]);
    expect(c.byAgent.map((r) => [r.label, r.krw])).toEqual([
      ["두리", 50],
      ["리서처", 10],
    ]);
    expect(c.byModel[0]).toMatchObject({ key: "claude-sonnet-5-5", krw: 50, calls: 2 });
    expect((await costStats(db, ctx.org.id, statsRange("today", NOW))).totalKrw).toBe(50);
  });

  it("생산성: 끝낸 Task·반려·실패·통과율·평균 별점·건당 비용", async () => {
    const p = await productivityStats(db, ctx.org.id, statsRange("7d", NOW));
    expect(p[0]).toMatchObject({ name: "두리", tasksDone: 1, rejects: 1, failures: 1, passRate: 0.5, avgRating: 4, costKrw: 50, costPerTask: 50 });
    expect(p[1]).toMatchObject({ name: "리서처", tasksDone: 0, passRate: null, avgRating: 5, costPerTask: null });
  });

  it("병목: 승인 대기 평균·최대·지금 기다리는 것, 지시부터 통과까지 오래 걸린 Task", async () => {
    const b = await bottleneckStats(db, ctx.org.id, statsRange("7d", NOW), NOW);
    expect(b).toMatchObject({ decided: 2, approvalAvgMin: 60, approvalMaxMin: 90, pending: 1 });
    expect(b.pendingOldestMin).toBeCloseTo(120, 5);
    expect(b.slowTasks).toEqual([{ taskId: task.id, title: "조사", missionId: mission.id, missionTitle: "트렌드", assignee: "두리", minutes: 90 }]);
  });

  it("미션 요약: 완료까지 걸린 시간·비용·호출·Task 수·최종 별점", async () => {
    const [m] = await missionSummaries(db, ctx.org.id, statsRange("7d", NOW), NOW);
    expect(m).toMatchObject({ title: "트렌드", status: "DONE", minutes: 120, costKrw: 50, calls: 2, tasks: 1, rating: 5 });
  });
});

