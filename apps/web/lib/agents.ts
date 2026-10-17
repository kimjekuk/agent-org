import { getDb, schema } from "@agentorg/shared/db";
import { and, eq } from "drizzle-orm";

export type Agent = typeof schema.agents.$inferSelect;

export const RANK_LABEL: Record<Agent["rank"], string> = { LEADER: "리더", MANAGER: "팀장", MEMBER: "팀원" };

/** 상태 뱃지 (PRD F003: 작업/대기/막힘 + 멈춤·해고) */
export function statusBadge(agent: Pick<Agent, "status" | "isActive">): { label: string; className: string } {
  if (!agent.isActive) return { label: "해고됨", className: "bg-black/10 text-black/60 dark:bg-white/10 dark:text-white/60" };
  switch (agent.status) {
    case "WORKING":
      return { label: "작업 중", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200" };
    case "PAUSED":
      return { label: "멈춤", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200" };
    case "BLOCKED":
      return { label: "막힘", className: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200" };
    default:
      return { label: "대기", className: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200" };
  }
}

/** 이 조직의 에이전트인지 확인하고 돌려준다 */
export async function getOrgAgent(orgId: string, agentId: string): Promise<Agent | null> {
  const [agent] = await getDb()
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.orgId, orgId)));
  return agent ?? null;
}
