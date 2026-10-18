// F106 스케줄 테스트: 다음 실행 시각(KST), 근무 시간, 예약 실행·건너뛰기, 근무 시간 밖 일 거르기
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import { encryptSecret } from "@agentorg/shared/crypto";
import type { LLMProvider } from "@agentorg/shared/llm/provider";
import {
  allowedAfterHours,
  computeNextRun,
  describeSchedule,
  isWithinWorkHours,
  nextWorkStart,
  parseWorkHours,
  runDueSchedules,
  type WorkHours,
} from "@agentorg/shared/schedule";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "../src/loops/member";
import { createTestDb, seed } from "./testDb";

const kst = (s: string) => new Date(`${s}+09:00`); // "2026-10-19T09:00:00" (월요일)
const base = { time: "09:00", weekdays: [] as number[], dayOfMonth: null, runDate: null };

describe("다음 실행 시각 (한국 시간)", () => {
  it("매일: 오늘 9시가 지났으면 내일 9시", () => {
    expect(computeNextRun({ ...base, repeat: "DAILY" }, kst("2026-10-19T08:59:00"))).toEqual(kst("2026-10-19T09:00:00"));
    expect(computeNextRun({ ...base, repeat: "DAILY" }, kst("2026-10-19T09:00:00"))).toEqual(kst("2026-10-20T09:00:00"));
  });
  it("매주 월·수: 월요일 9시 다음은 수요일 9시", () => {
    expect(computeNextRun({ ...base, repeat: "WEEKLY", weekdays: [1, 3] }, kst("2026-10-19T09:00:00"))).toEqual(kst("2026-10-21T09:00:00"));
  });
  it("매월 1일: 다음 달 1일", () => {
    expect(computeNextRun({ ...base, repeat: "MONTHLY", dayOfMonth: 1 }, kst("2026-10-19T12:00:00"))).toEqual(kst("2026-11-01T09:00:00"));
  });
  it("한 번: 지난 시각이면 null", () => {
    expect(computeNextRun({ ...base, repeat: "ONCE", runDate: "2026-10-20" }, kst("2026-10-19T00:00:00"))).toEqual(kst("2026-10-20T09:00:00"));
    expect(computeNextRun({ ...base, repeat: "ONCE", runDate: "2026-10-18" }, kst("2026-10-19T00:00:00"))).toBeNull();
  });
  it("사람이 읽는 일정", () => {
    expect(describeSchedule({ ...base, repeat: "WEEKLY", weekdays: [3, 1] })).toBe("매주 월·수 09:00");
  });
});

describe("근무 시간 (평일 09~18시)", () => {
  const wh: WorkHours = { enabled: true, days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
  it("평일 낮은 근무, 저녁·주말은 아님", () => {
    expect(isWithinWorkHours(wh, kst("2026-10-19T10:00:00"))).toBe(true);
    expect(isWithinWorkHours(wh, kst("2026-10-19T18:00:00"))).toBe(false);
    expect(isWithinWorkHours(wh, kst("2026-10-18T10:00:00"))).toBe(false); // 일요일
    expect(isWithinWorkHours(null, kst("2026-10-18T03:00:00"))).toBe(true); // 설정 없음 = 항상
    expect(parseWorkHours({ enabled: true, days: [], start: "09:00", end: "18:00" })).toBeNull(); // 근무 요일 없음 = 제한 없음
  });
  it("금요일 저녁 → 월요일 9시에 시작", () => {
    expect(nextWorkStart(wh, kst("2026-10-23T19:00:00"))).toEqual(kst("2026-10-26T09:00:00"));
  });
  it("근무 시간 밖에도 사용자가 직접 보낸 것·직접 만든 미션의 일은 처리, 예약으로 생긴 일은 대기", () => {
    expect(allowedAfterHours({ senderType: "USER" }, null)).toBe(true);
    expect(allowedAfterHours({ senderType: "AGENT" }, { scheduleId: null })).toBe(true);
    expect(allowedAfterHours({ senderType: "AGENT" }, { scheduleId: "s1" })).toBe(false);
    expect(allowedAfterHours({ senderType: "SYSTEM" }, null)).toBe(false);
  });
});

describe("예약 실행", () => {
  const KEY = "66".repeat(32);
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = KEY;
  });
  let db: AnyDb;
  let ctx: Awaited<ReturnType<typeof seed>>;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = await seed(db, { budgetDaily: 100000 });
    await db.update(schema.agents).set({ rank: "LEADER", name: "하나" }).where(eq(schema.agents.id, ctx.agent.id));
  });

  async function addSchedule(over: Partial<typeof schema.schedules.$inferInsert> = {}) {
    const [s] = await db
      .insert(schema.schedules)
      .values({
        orgId: ctx.org.id,
        kind: "MISSION",
        title: "주간 트렌드 보고서",
        spec: { topic: "이번 주 숏폼 트렌드", autonomy: "FULL", budgetLimit: 3000 },
        repeat: "DAILY",
        time: "09:00",
        nextRunAt: kst("2026-10-19T09:00:00"),
        ...over,
      })
      .returning();
    return s;
  }

  it("시각이 되면 미션을 만들어 리더에게 맡기고, 다음 실행 시각으로 넘긴다", async () => {
    const s = await addSchedule();
    const jobs = await runDueSchedules(db, kst("2026-10-19T09:00:30"));

    expect(jobs).toEqual([{ orgId: ctx.org.id, agentId: ctx.agent.id }]);
    const [m] = await db.select().from(schema.missions);
    expect(m).toMatchObject({ topic: "이번 주 숏폼 트렌드", scheduleId: s.id, autonomy: "FULL", budgetLimit: 3000, leaderId: ctx.agent.id });
    const [after] = await db.select().from(schema.schedules);
    expect(after).toMatchObject({ lastMissionId: m.id, lastResult: "미션 시작", nextRunAt: kst("2026-10-20T09:00:00") });
    const [start] = await db.select().from(schema.messages);
    expect(start).toMatchObject({ senderType: "SYSTEM", receiverAgentId: ctx.agent.id, missionId: m.id });
    expect((await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "schedule.run")))).toHaveLength(1);

    // 같은 시각에 다시 불러도 두 번 만들지 않는다
    expect(await runDueSchedules(db, kst("2026-10-19T09:00:40"))).toEqual([]);
  });

  it("이전 회차 미션이 진행 중이면 이번 회차는 건너뛰고 기록한다", async () => {
    await addSchedule();
    await runDueSchedules(db, kst("2026-10-19T09:00:00"));
    await runDueSchedules(db, kst("2026-10-20T09:00:00"));

    expect(await db.select().from(schema.missions)).toHaveLength(1);
    const [s] = await db.select().from(schema.schedules);
    expect(s.lastResult).toBe("이전 회차 미션이 아직 진행 중이라 건너뜀");
    expect(s.nextRunAt).toEqual(kst("2026-10-21T09:00:00"));
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "schedule.skip"))).toHaveLength(1);
  });

  it("근무 시간 밖이면 실행하지 않고 다음 근무 시작으로 미룬다", async () => {
    await db
      .update(schema.organizations)
      .set({ workHours: { enabled: true, days: [1, 2, 3, 4, 5], start: "10:00", end: "18:00" } })
      .where(eq(schema.organizations.id, ctx.org.id));
    await addSchedule();
    expect(await runDueSchedules(db, kst("2026-10-19T09:00:00"))).toEqual([]);
    const [s] = await db.select().from(schema.schedules);
    expect(s.nextRunAt).toEqual(kst("2026-10-19T10:00:00"));
    expect(await runDueSchedules(db, kst("2026-10-19T10:00:00"))).toHaveLength(1);
  });

  it("한 번 예약 지시는 에이전트에게 보내고 꺼진다. 긴급 정지 중이면 건너뛴다", async () => {
    await addSchedule({ kind: "DIRECTIVE", spec: { content: "오늘 뉴스 요약" }, agentId: ctx.agent.id, repeat: "ONCE", runDate: "2026-10-19" });
    await db.update(schema.organizations).set({ emergencyStop: true }).where(eq(schema.organizations.id, ctx.org.id));
    expect(await runDueSchedules(db, kst("2026-10-19T09:00:00"))).toEqual([]);
    let [s] = await db.select().from(schema.schedules);
    expect(s).toMatchObject({ enabled: false, lastResult: "긴급 정지 중이라 건너뜀" });

    await db.update(schema.organizations).set({ emergencyStop: false }).where(eq(schema.organizations.id, ctx.org.id));
    await db.update(schema.schedules).set({ enabled: true, nextRunAt: kst("2026-10-19T09:00:00") });
    await runDueSchedules(db, kst("2026-10-19T09:00:00"));
    [s] = await db.select().from(schema.schedules);
    expect(s.enabled).toBe(false);
    const [msg] = await db.select().from(schema.messages).where(and(eq(schema.messages.type, "DIRECTIVE"), eq(schema.messages.receiverAgentId, ctx.agent.id)));
    expect(msg).toMatchObject({ content: "오늘 뉴스 요약", senderType: "SYSTEM" });
  });

  it("근무 시간 밖에는 워커가 예약 지시를 처리하지 않고, 사용자 직접 지시는 처리한다", async () => {
    // 지금이 언제든 근무 시간 밖이 되도록 근무 시간을 0분으로 둔다
    await db
      .update(schema.organizations)
      .set({ workHours: { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "00:00" } })
      .where(eq(schema.organizations.id, ctx.org.id));
    await db.insert(schema.apiKeys).values({ userId: ctx.user.id, provider: "anthropic", encryptedKey: encryptSecret("sk-ant-test", KEY) });
    await db.insert(schema.messages).values({ orgId: ctx.org.id, senderType: "SYSTEM", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content: "예약 지시" });
    const provider: LLMProvider = {
      name: "anthropic",
      complete: async (_k, req) => ({ text: `# ${req.messages[0].content}`, model: req.model, stopReason: "end_turn", usage: [], webSearchRequests: 0, webSearchEnabled: false }),
    };
    const deps = { provider, publish: async () => {}, enqueue: async () => true };

    expect(await runAgent(db, { orgId: ctx.org.id, agentId: ctx.agent.id }, deps)).toEqual({ turns: 0 });
    await db.insert(schema.messages).values({ orgId: ctx.org.id, senderType: "USER", receiverAgentId: ctx.agent.id, type: "DIRECTIVE", content: "지금 해 줘" });
    expect(await runAgent(db, { orgId: ctx.org.id, agentId: ctx.agent.id }, deps)).toEqual({ turns: 1 });
  });
});
