// 팀원 루프(member.ts)와 리더 루프(leader.ts)가 함께 쓰는 것들
import { writeAudit } from "@agentorg/shared/audit";
import type { AnyDb } from "@agentorg/shared/db";
import { type AgentStatus, agents, messages, missions } from "@agentorg/shared/db/schema";
import type { OrgEvent } from "@agentorg/shared/events";
import type { LLMProvider } from "@agentorg/shared/llm/provider";
import type { RunAgentJob } from "@agentorg/shared/queue";
import { and, eq, ne } from "drizzle-orm";

export type Message = typeof messages.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type Mission = typeof missions.$inferSelect;
export type Publish = (orgId: string, event: OrgEvent) => Promise<void>;
export type Enqueue = (job: RunAgentJob) => Promise<boolean>;

export interface Deps {
  provider?: LLMProvider; // 테스트에서 가짜 제공사 주입
  publish: Publish;
  enqueue: Enqueue;
}

/** 상태 변경 + 감사 로그. 사용자가 작업 중에 '멈춤'을 눌렀다면 PAUSED를 덮어쓰지 않는다. */
export async function setStatus(db: AnyDb, agent: Agent, status: AgentStatus, reasoning: string, publish: Publish) {
  const updated = await db
    .update(agents)
    .set({ status })
    .where(and(eq(agents.id, agent.id), ne(agents.status, "PAUSED")))
    .returning({ id: agents.id });
  if (updated.length === 0) return;
  await writeAudit(db, {
    orgId: agent.orgId,
    actorType: "AGENT",
    actorId: agent.id,
    action: "agent.status",
    targetType: "agent",
    targetId: agent.id,
    reasoning,
    payload: { to: status },
  });
  await publish(agent.orgId, { type: "agent", agentId: agent.id });
}

export function titleOf(markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return (heading || markdown.split("\n")[0].trim() || "결과물").slice(0, 80);
}

export function preview(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…(이하 생략)` : text;
}

/** 미션 개요 (리더 계획·검토·통합, 회의에서 함께 쓴다) */
export function missionBrief(m: Mission): string {
  const criteria = ((m.successCriteria ?? []) as string[]).map((c) => `- ${c}`).join("\n");
  return [
    `# 미션: ${m.title}`,
    `주제: ${m.topic}`,
    m.goal ? `목표: ${m.goal}` : "",
    criteria ? `성공 기준:\n${criteria}` : "",
    `산출물 형식: ${m.outputFormat ?? "보고서"}`,
    m.deadline ? `마감: ${m.deadline.toISOString().slice(0, 10)}` : "",
    m.referenceNotes ? `참고 자료:\n${clip(m.referenceNotes, 4000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
