// F201 사무실 뷰 데이터: 에이전트별 상태·지금 하는 일·자리 (그림은 components/Office.tsx)
import type { Avatar } from "@agentorg/shared/agents/templates";
import { getDb, schema } from "@agentorg/shared/db";
import { type MissionMessageKind, missionKind } from "@agentorg/shared/missions";
import { type OfficeActivity, type OfficePlacement, officeLayout } from "@agentorg/shared/office";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { isRestTime, RANK_LABEL, statusBadge } from "./agents";

export interface OfficeAgent {
  id: string;
  name: string;
  avatar: Partial<Avatar> | null;
  rankLabel: string;
  level: number;
  status: "IDLE" | "WORKING" | "PAUSED" | "BLOCKED";
  resting: boolean;
  badge: { label: string; className: string };
  activity: OfficeActivity | null;
  /** 마지막 상태 기록 (예: 미션 "…" — 보고 검토) */
  doing: string | null;
  place: OfficePlacement;
}

const MEETING_KINDS: MissionMessageKind[] = ["MEETING", "MEETING_WRAP"];

/** 작업 중인 에이전트가 처리 중인 일 = 받은 미처리 메시지 중 가장 먼저 처리할 것 (워커와 같은 순서) */
function activityOf(msg: { type: string; taskId: string | null; payload: unknown } | undefined): OfficeActivity {
  const kind = missionKind(msg?.payload);
  if (kind && MEETING_KINDS.includes(kind)) return "MEETING";
  if (kind === "QA_REVIEW" || (msg?.type === "REPORT" && msg.taskId)) return "REVIEW";
  return "WORK";
}

export async function loadOffice(org: { id: string; workHours: unknown }): Promise<{ agents: OfficeAgent[]; deskCount: number }> {
  const db = getDb();
  const agents = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.orgId, org.id), eq(schema.agents.isActive, true)))
    .orderBy(asc(schema.agents.createdAt));
  if (agents.length === 0) return { agents: [], deskCount: 0 };
  const ids = agents.map((a) => a.id);
  const working = agents.filter((a) => a.status === "WORKING").map((a) => a.id);

  const [pending, lastStatus] = await Promise.all([
    working.length
      ? db
          .select({ receiverAgentId: schema.messages.receiverAgentId, type: schema.messages.type, taskId: schema.messages.taskId, payload: schema.messages.payload })
          .from(schema.messages)
          .where(
            and(
              inArray(schema.messages.receiverAgentId, working),
              isNull(schema.messages.readAt),
              or(eq(schema.messages.type, "DIRECTIVE"), and(eq(schema.messages.type, "REPORT"), sql`${schema.messages.taskId} is not null`)),
            ),
          )
          .orderBy(desc(schema.messages.priority), asc(schema.messages.createdAt))
      : [],
    db
      .selectDistinctOn([schema.auditLogs.targetId], { targetId: schema.auditLogs.targetId, reasoning: schema.auditLogs.reasoning })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.orgId, org.id), eq(schema.auditLogs.action, "agent.status"), inArray(schema.auditLogs.targetId, ids)))
      .orderBy(schema.auditLogs.targetId, desc(schema.auditLogs.createdAt)),
  ]);

  const activity = new Map<string, OfficeActivity>();
  for (const id of working) activity.set(id, activityOf(pending.find((m) => m.receiverAgentId === id)));
  const resting = isRestTime(org);
  const { placements, deskCount } = officeLayout(agents.map((a) => ({ id: a.id, rank: a.rank, status: a.status, activity: activity.get(a.id) ?? null })));

  return {
    deskCount,
    agents: agents.map((a, i) => ({
      id: a.id,
      name: a.name,
      avatar: a.avatar as Partial<Avatar> | null,
      rankLabel: RANK_LABEL[a.rank],
      level: a.level,
      status: a.status,
      resting: resting && a.status === "IDLE",
      badge: statusBadge(a, resting),
      activity: activity.get(a.id) ?? null,
      doing: lastStatus.find((s) => s.targetId === a.id)?.reasoning ?? null,
      place: placements[i],
    })),
  };
}
