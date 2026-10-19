// F007 리더 루프 + F012 승인 결정 테스트. 실제 DB(PGlite) + 가짜 LLM 제공사 + 가짜 큐(순서대로 실행).
import { decideApproval } from "@agentorg/shared/approval";
import { encryptSecret } from "@agentorg/shared/crypto";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import type { LLMProvider, LLMRequest } from "@agentorg/shared/llm/provider";
import type { Autonomy, MissionMessagePayload } from "@agentorg/shared/missions";
import { agentsWithPendingDirectives, type RunAgentJob } from "@agentorg/shared/queue";
import { and, asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseJsonObject, pickAssignee } from "../src/loops/leader";
import { runAgent } from "../src/loops/member";
import { createTestDb } from "./testDb";

const KEY = "33".repeat(32);
beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

type Agent = typeof schema.agents.$inferSelect;
let db: AnyDb;
let userId: string;
let orgId: string;
let leader: Agent;
let team: Record<string, Agent>;
let queue: RunAgentJob[];
let calls: LLMRequest[];
let reviewVerdict: () => { pass: boolean; feedback: string };
let failMember: string | null;

const PLAN = {
  summary: "조사 → 작성 → 검수",
  tasks: [
    { title: "자료 조사", description: "숏폼 트렌드 자료 5개", skills: ["웹 검색"], assignee: "두리" },
    { title: "초안 작성", description: "조사 결과로 보고서 초안", skills: ["글쓰기"], assignee: "세찬" },
    { title: "검수", description: "사실·맞춤법 확인", skills: ["사실 확인"], assignee: "네모" },
  ],
};

const provider: LLMProvider = {
  name: "anthropic",
  async complete(_key, req) {
    calls.push(req);
    const prompt = req.messages[0].content;
    let text: string;
    if (prompt.includes('"tasks":[')) text = "계획입니다\n```json\n" + JSON.stringify(PLAN) + "\n```";
    else if (prompt.includes("# 검토할 Task")) text = JSON.stringify(reviewVerdict());
    else if (prompt.includes("# 팀원 결과")) text = "# 최종 보고서\n\n통합 본문\n\n## 성공 기준 점검\n- [x] 완료";
    else if (prompt.includes("# 사용자 메시지")) text = "확인했습니다. 다음 Task부터 반영하겠습니다.";
    else {
      const task = prompt.match(/# 내 Task \(\d+\/\d+\): (.+)/)?.[1] ?? "결과";
      if (failMember && req.system?.includes(`이름: ${failMember}`)) throw new Error("일시적 오류");
      text = `# ${task} 결과\n\n${task} 본문`;
    }
    return {
      text,
      model: req.model,
      stopReason: "end_turn",
      usage: [{ model: req.model, inputTokens: 100, outputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0 }],
      webSearchRequests: 0,
      webSearchEnabled: false,
    };
  },
};

const deps = {
  provider,
  publish: async () => {},
  enqueue: async (job: RunAgentJob) => {
    queue.push(job);
    return true;
  },
};

/** 워커처럼 큐가 빌 때까지 한 번에 하나씩 실행 */
async function drain(limit = 50) {
  for (let i = 0; queue.length && i < limit; i++) await runAgent(db, queue.shift()!, deps);
}

async function hire(name: string, rank: "LEADER" | "MEMBER", skills: string[], supervisorId: string | null) {
  const [a] = await db
    .insert(schema.agents)
    .values({ orgId, name, rank, skills, supervisorId, toolPermissions: { document: true }, maxTurns: 20 })
    .returning();
  return a;
}

/** web의 미션 생성과 같은 순서: Mission → 리더에게 MISSION_START 지시 → 큐 */
async function startMission(autonomy: Autonomy) {
  const [mission] = await db
    .insert(schema.missions)
    .values({
      orgId,
      title: "숏폼 트렌드 보고서",
      topic: "2026 숏폼 트렌드",
      successCriteria: ["출처 3개 이상", "1페이지 분량"],
      outputFormat: "보고서",
      autonomy,
      leaderId: leader.id,
      status: "RUNNING",
      budgetLimit: 5000,
      meetings: false, // 회의(F104)는 meetings.test.ts에서
    })
    .returning();
  const payload: MissionMessagePayload = { kind: "MISSION_START" };
  await db.insert(schema.messages).values({ orgId, missionId: mission.id, senderType: "USER", receiverAgentId: leader.id, type: "DIRECTIVE", content: "미션 시작", payload, priority: 100 });
  queue.push({ orgId, agentId: leader.id });
  return mission;
}

const missionTasks = (missionId: string) => db.select().from(schema.tasks).where(eq(schema.tasks.missionId, missionId)).orderBy(asc(schema.tasks.order));
const missionOf = async (id: string) => (await db.select().from(schema.missions).where(eq(schema.missions.id, id)))[0];
const approvals = (missionId: string) => db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.missionId, missionId)).orderBy(asc(schema.approvalRequests.createdAt));

async function decide(approvalId: string, decision: "APPROVED" | "REJECTED" | "HELD", comment?: string) {
  const r = await decideApproval(db, { orgId, userId, approvalId, decision, comment });
  if ("error" in r) throw new Error(r.error);
  if (r.notify) queue.push(r.notify);
}

beforeEach(async () => {
  db = await createTestDb();
  queue = [];
  calls = [];
  failMember = null;
  reviewVerdict = () => ({ pass: true, feedback: "좋습니다" });
  const [user] = await db.insert(schema.users).values({ email: "o@example.test", passwordHash: "x" }).returning();
  userId = user.id;
  const [org] = await db.insert(schema.organizations).values({ ownerId: user.id, name: "콘텐츠 제작팀", budgetDaily: 100000 }).returning();
  orgId = org.id;
  await db.insert(schema.apiKeys).values({ userId, provider: "anthropic", encryptedKey: encryptSecret("sk-ant-test", KEY) });
  leader = await hire("하나", "LEADER", ["기획", "업무 분배", "최종 검토"], null);
  team = {
    두리: await hire("두리", "MEMBER", ["웹 검색", "자료 정리", "출처 확인"], leader.id),
    세찬: await hire("세찬", "MEMBER", ["글쓰기", "요약", "구성"], leader.id),
    네모: await hire("네모", "MEMBER", ["사실 확인", "맞춤법", "품질 점검"], leader.id),
  };
});

describe("F007 리더 루프 — 완전 자율", () => {
  it("미션을 Task로 나눠 특기대로 배정하고, 순서대로 지시·검토해 최종 결과까지 보고한다", async () => {
    const mission = await startMission("FULL");
    await drain();

    const list = await missionTasks(mission.id);
    expect(list.map((t) => [t.title, t.status, t.assigneeId])).toEqual([
      ["자료 조사", "DONE", team.두리.id],
      ["초안 작성", "DONE", team.세찬.id],
      ["검수", "DONE", team.네모.id],
    ]);
    expect((await missionOf(mission.id)).status).toBe("DONE");
    expect(await approvals(mission.id)).toHaveLength(0);

    // 최종 결과물(미션 산출물) + 사용자에게 완료 보고
    const [final] = await db.select().from(schema.artifacts).where(and(eq(schema.artifacts.missionId, mission.id), eq(schema.artifacts.agentId, leader.id)));
    expect(final).toMatchObject({ title: "최종 보고서", taskId: null, version: 1 });
    const reports = await db.select().from(schema.messages).where(and(eq(schema.messages.missionId, mission.id), eq(schema.messages.senderAgentId, leader.id), eq(schema.messages.type, "REPORT")));
    const done = reports.find((r) => r.content.startsWith("미션을 마쳤습니다"));
    expect(done).toMatchObject({ receiverAgentId: null });
    expect(done?.payload).toMatchObject({ artifactId: final.id });

    // 앞 Task 결과가 다음 담당 지시에 들어간다 (작가가 조사 결과를 받는다)
    const toWriter = await db.select().from(schema.messages).where(and(eq(schema.messages.receiverAgentId, team.세찬.id), eq(schema.messages.type, "DIRECTIVE")));
    expect(toWriter[0].content).toContain("자료 조사 본문");
    expect(toWriter[0].content).toContain("출처 3개 이상");

    // 계획 1 + (팀원 1 + 검토 1) × 3 + 통합 1 = LLM 8번, 모두 미션 비용으로 기록
    expect(calls).toHaveLength(8);
    const costs = await db.select().from(schema.costLogs).where(eq(schema.costLogs.missionId, mission.id));
    expect(costs).toHaveLength(8);

    const actions = (await db.select({ action: schema.auditLogs.action }).from(schema.auditLogs)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["mission.plan", "task.dispatch", "task.review_pass", "mission.finalize", "mission.complete"]));
    expect(await agentsWithPendingDirectives(db)).toHaveLength(0);
  });

  it("리더 반려는 Task당 1번까지: 다시 낸 결과(버전 2)는 검토가 또 반려해도 통과시킨다", async () => {
    reviewVerdict = () => ({ pass: false, feedback: "출처를 더 넣으세요" });
    const mission = await startMission("FULL");
    await drain();

    const list = await missionTasks(mission.id);
    expect(list.every((t) => t.status === "DONE" && t.rejectCount === 1)).toBe(true);
    const research = await db.select().from(schema.artifacts).where(eq(schema.artifacts.taskId, list[0].id)).orderBy(asc(schema.artifacts.version));
    expect(research.map((a) => a.version)).toEqual([1, 2]);
    expect(research[1].parentVersionId).toBe(research[0].id);
    const redo = await db.select().from(schema.messages).where(and(eq(schema.messages.taskId, list[0].id), eq(schema.messages.type, "DIRECTIVE"))).orderBy(asc(schema.messages.createdAt));
    expect(redo[1].content).toContain("출처를 더 넣으세요");
    expect((await missionOf(mission.id)).status).toBe("DONE");
  });

  it("담당이 3번 실패하면 사용자에게 묻고, 거절하면 그 Task를 건너뛰고 진행한다", async () => {
    failMember = "두리";
    const mission = await startMission("FULL");
    await drain();

    const [q] = await approvals(mission.id);
    expect(q).toMatchObject({ type: "QUESTION", status: "PENDING", taskId: (await missionTasks(mission.id))[0].id });
    expect((await missionTasks(mission.id))[0].failCount).toBe(3);
    expect((await missionTasks(mission.id))[1].status).toBe("TODO"); // 질문이 열려 있는 동안 다음 Task로 가지 않는다

    failMember = null;
    await decide(q.id, "REJECTED");
    await drain();
    const list = await missionTasks(mission.id);
    expect(list.map((t) => t.status)).toEqual(["DONE", "DONE", "DONE"]);
    expect((await missionOf(mission.id)).status).toBe("DONE");
  });
});

describe("F007 체크포인트 (계획·최종 2번) + F012 승인 결정", () => {
  it("계획 승인 전에는 Task를 지시하지 않고, 최종 승인 후에 미션을 마친다", async () => {
    const mission = await startMission("CHECKPOINT");
    await drain();

    let aps = await approvals(mission.id);
    expect(aps).toHaveLength(1);
    expect(aps[0]).toMatchObject({ type: "CHECKPOINT", status: "PENDING", payload: { stage: "PLAN" } });
    expect((await missionTasks(mission.id)).map((t) => t.status)).toEqual(["TODO", "TODO", "TODO"]);

    // 보류는 아무 일도 일으키지 않고, 나중에 다시 결정할 수 있다
    await decide(aps[0].id, "HELD");
    await drain();
    expect((await missionTasks(mission.id))[0].status).toBe("TODO");

    await decide(aps[0].id, "APPROVED");
    await drain();
    aps = await approvals(mission.id);
    expect(aps).toHaveLength(2); // Task마다 묻지 않는다
    expect(aps[1]).toMatchObject({ status: "PENDING", payload: { stage: "FINAL" } });
    expect((aps[1].payload as { artifactId?: string }).artifactId).toBeTruthy();
    expect((await missionOf(mission.id)).status).toBe("REVIEW");

    await decide(aps[1].id, "APPROVED", "좋아요");
    await drain();
    expect((await missionOf(mission.id)).status).toBe("DONE");

    // 결정은 감사 로그에 남고, 리더에게 메시지로 전달된다
    const decided = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "approval.decide"));
    expect(decided).toHaveLength(3);
    const toLeader = await db.select().from(schema.messages).where(and(eq(schema.messages.receiverAgentId, leader.id), eq(schema.messages.senderType, "USER")));
    expect(toLeader.filter((m) => (m.payload as MissionMessagePayload).kind === "APPROVAL")).toHaveLength(2);
  });

  it("계획을 거절하면 사용자 의견을 넣어 다시 계획하고 다시 승인을 받는다", async () => {
    const mission = await startMission("CHECKPOINT");
    await drain();
    const [plan] = await approvals(mission.id);

    await decide(plan.id, "REJECTED", "검수 단계를 빼 주세요");
    await drain();

    const replanPrompt = calls.filter((c) => c.messages[0].content.includes('"tasks":['))[1].messages[0].content;
    expect(replanPrompt).toContain("검수 단계를 빼 주세요");
    const aps = await approvals(mission.id);
    expect(aps.map((a) => a.status)).toEqual(["REJECTED", "PENDING"]);
    expect(await missionTasks(mission.id)).toHaveLength(3); // 이전 Task는 지우고 새로 만든다
  });

  it("최종 결과를 거절하면 수정 요청을 반영해 버전 2를 만들고 다시 묻는다", async () => {
    const mission = await startMission("CHECKPOINT");
    await drain();
    await decide((await approvals(mission.id))[0].id, "APPROVED");
    await drain();
    const final1 = (await approvals(mission.id))[1];

    await decide(final1.id, "REJECTED", "결론을 앞으로");
    await drain();

    const finals = await db.select().from(schema.artifacts).where(and(eq(schema.artifacts.missionId, mission.id), eq(schema.artifacts.agentId, leader.id))).orderBy(asc(schema.artifacts.version));
    expect(finals.map((a) => a.version)).toEqual([1, 2]);
    expect(calls.at(-1)?.messages[0].content).toContain("결론을 앞으로");
    const aps = await approvals(mission.id);
    expect(aps.at(-1)).toMatchObject({ status: "PENDING", payload: { stage: "FINAL", artifactId: finals[1].id } });
    expect((await missionOf(mission.id)).status).toBe("REVIEW");
  });

  it("이미 처리한 요청은 다시 결정할 수 없다", async () => {
    const mission = await startMission("CHECKPOINT");
    await drain();
    const [plan] = await approvals(mission.id);
    await decide(plan.id, "APPROVED");
    expect(await decideApproval(db, { orgId, userId, approvalId: plan.id, decision: "REJECTED" })).toEqual({ error: "이미 처리한 요청입니다" });
  });
});

describe("수동 모드 · 일시정지 · 사용자 메시지", () => {
  it("수동 모드는 Task마다 결과 승인을 받는다", async () => {
    const mission = await startMission("MANUAL");
    await drain();
    await decide((await approvals(mission.id))[0].id, "APPROVED");
    await drain();
    const aps = await approvals(mission.id);
    expect(aps[1]).toMatchObject({ payload: { stage: "TASK" }, taskId: (await missionTasks(mission.id))[0].id });
    expect((await missionTasks(mission.id)).map((t) => t.status)).toEqual(["REVIEW", "TODO", "TODO"]);
  });

  it("일시정지한 미션의 메시지는 처리하지 않고, 주기 점검에도 잡히지 않는다", async () => {
    const mission = await startMission("FULL");
    await db.update(schema.missions).set({ status: "PAUSED" }).where(eq(schema.missions.id, mission.id));
    await drain();
    expect(calls).toHaveLength(0);
    expect(await agentsWithPendingDirectives(db)).toHaveLength(0);

    await db.update(schema.missions).set({ status: "RUNNING" }).where(eq(schema.missions.id, mission.id));
    expect(await agentsWithPendingDirectives(db)).toEqual([{ orgId, agentId: leader.id }]);
  });

  it("사용자가 미션 대화에 남긴 메시지에 리더가 답하고, 이후 Task 지시에 함께 넘긴다", async () => {
    const mission = await startMission("CHECKPOINT");
    await drain();
    const note: MissionMessagePayload = { kind: "NOTE" };
    await db.insert(schema.messages).values({ orgId, missionId: mission.id, senderType: "USER", receiverAgentId: leader.id, type: "DIRECTIVE", content: "20대 위주로 봐 주세요", payload: note, priority: 100 });
    queue.push({ orgId, agentId: leader.id });
    await drain();
    await decide((await approvals(mission.id))[0].id, "APPROVED");
    await drain();

    const reply = await db.select().from(schema.messages).where(eq(schema.messages.content, "확인했습니다. 다음 Task부터 반영하겠습니다."));
    expect(reply).toHaveLength(1);
    const [first] = await db.select().from(schema.messages).where(and(eq(schema.messages.receiverAgentId, team.두리.id), eq(schema.messages.type, "DIRECTIVE")));
    expect(first.content).toContain("사용자 추가 지시");
    expect(first.content).toContain("20대 위주로 봐 주세요");
  });

  it("긴급 정지 중에는 리더도 멈추고, 재개하면 이어서 진행한다", async () => {
    const mission = await startMission("FULL");
    await db.update(schema.organizations).set({ emergencyStop: true }).where(eq(schema.organizations.id, orgId));
    await drain();
    expect(calls).toHaveLength(0);

    await db.update(schema.organizations).set({ emergencyStop: false }).where(eq(schema.organizations.id, orgId));
    queue.push(...(await agentsWithPendingDirectives(db)));
    await drain();
    expect((await missionOf(mission.id)).status).toBe("DONE");
  });
});

describe("배정·응답 해석", () => {
  it("이름이 팀에 있으면 그대로, 없으면 특기 일치 → 부하가 적은 사람", () => {
    const members = Object.values(team);
    expect(pickAssignee(members, "세찬", [], new Map()).name).toBe("세찬");
    expect(pickAssignee(members, "없는사람", ["맞춤법"], new Map()).name).toBe("네모");
    const busy = new Map([[team.두리.id, 3]]);
    expect(pickAssignee(members, null, [], busy).name).not.toBe("두리");
  });

  it("```json 블록이나 앞뒤 설명이 있어도 JSON을 꺼내고, 못 읽으면 null", () => {
    expect(parseJsonObject<{ a: number }>('결과:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject<{ pass: boolean }>('네 {"pass": false} 입니다')).toEqual({ pass: false });
    expect(parseJsonObject("JSON 없음")).toBeNull();
  });
});
