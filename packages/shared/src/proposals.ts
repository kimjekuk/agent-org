// F108 역제안 (2026-10-19 결정)
// - 언제: 미션 최종 결과·직접 지시 결과 끝에 '## 다음 제안'을 함께 적게 한다 (추가 AI 호출 없음)
// - 승인함 PROPOSAL로 올리고, 승인하면 제안 내용으로 바로 미션 시작 / 거절 = 안 함 / 보류 = 보류 목록에 남김
// - 너무 많아지지 않게: 미션당 1개, 대기(보류 포함) 중인 제안이 3개면 더 받지 않는다
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { writeAudit } from "./audit";
import type { AnyDb } from "./db/client";
import { agents, approvalRequests } from "./db/schema";
import { notifyOrgOwner } from "./push";

export const PROPOSAL_HEADING = "다음 제안";
export const PROPOSAL_KIND = "MISSION_PROPOSAL";
export const MAX_OPEN_PROPOSALS = 3;

/** 결과 끝에 제안을 적게 하는 지침 (리더 최종 통합·직접 지시 공용) */
export const PROPOSAL_GUIDE = `맨 끝에 '## ${PROPOSAL_HEADING}'을 두고, 이 결과를 바탕으로 이어서 하면 좋을 일이 있으면 '- 주제: …', '- 목표: …', '- 이유: …' 세 줄로 하나만 적는다 (꼭 필요할 때만, 없으면 '없음').`;

export interface MissionProposal {
  topic: string;
  goal?: string | null;
  reason?: string | null;
}

export interface ProposalPayload extends MissionProposal {
  kind: typeof PROPOSAL_KIND;
  sourceMissionId?: string | null;
  sourceMessageId?: string | null;
  /** 승인해서 만든 미션 */
  missionId?: string | null;
}

/** '## 다음 제안' 항목 → 제안. 주제가 없으면 null */
export function parseProposal(items: string[]): MissionProposal | null {
  const field = (names: string[]) => {
    for (const item of items) {
      const m = item.match(/^\**\s*([^:：*]+?)\s*\**\s*[:：]\s*(.+)$/);
      if (m && names.includes(m[1].trim())) return m[2].trim().slice(0, 300);
    }
    return null;
  };
  const topic = field(["주제", "미션", "제목"]);
  if (!topic || topic.length < 2) return null;
  return { topic, goal: field(["목표"]), reason: field(["이유", "근거"]) };
}

/**
 * 제안을 승인함에 올린다. 같은 미션에서 이미 제안했거나, 대기 중인 제안이 많으면 올리지 않는다.
 * 만든 승인 요청 id (안 올렸으면 null)
 */
export async function submitProposal(
  db: AnyDb,
  input: { orgId: string; agentId: string; proposal: MissionProposal; sourceMissionId?: string | null; sourceMessageId?: string | null },
): Promise<string | null> {
  const isProposal = sql`${approvalRequests.payload}->>'kind' = ${PROPOSAL_KIND}`;
  const id = await db.transaction(async (tx) => {
    if (input.sourceMissionId) {
      const [dup] = await tx
        .select({ id: approvalRequests.id })
        .from(approvalRequests)
        .where(and(eq(approvalRequests.orgId, input.orgId), isProposal, sql`${approvalRequests.payload}->>'sourceMissionId' = ${input.sourceMissionId}`))
        .limit(1);
      if (dup) return null;
    }
    const [{ open }] = await tx
      .select({ open: count() })
      .from(approvalRequests)
      .where(and(eq(approvalRequests.orgId, input.orgId), isProposal, inArray(approvalRequests.status, ["PENDING", "HELD"])));
    const [agent] = await tx.select({ name: agents.name }).from(agents).where(eq(agents.id, input.agentId));
    if (open >= MAX_OPEN_PROPOSALS) {
      await writeAudit(tx, {
        orgId: input.orgId,
        actorType: "AGENT",
        actorId: input.agentId,
        action: "proposal.skip",
        targetType: "agent",
        targetId: input.agentId,
        reasoning: `대기 중인 제안이 ${open}개라 올리지 않음: ${input.proposal.topic}`,
      });
      return null;
    }
    const { topic, goal, reason } = input.proposal;
    const payload: ProposalPayload = { kind: PROPOSAL_KIND, topic, goal: goal ?? null, reason: reason ?? null, sourceMissionId: input.sourceMissionId ?? null, sourceMessageId: input.sourceMessageId ?? null };
    const [req] = await tx
      .insert(approvalRequests)
      .values({
        orgId: input.orgId,
        agentId: input.agentId,
        type: "PROPOSAL",
        content: [`💡 ${agent?.name ?? "에이전트"}의 제안: ${topic}`, goal ? `목표: ${goal}` : "", reason ? `이유: ${reason}` : "", "", "승인 = 이 내용으로 미션 시작 / 거절 = 하지 않음 / 보류 = 나중에 결정"]
          .filter((l, i) => l || i === 3)
          .join("\n"),
        payload,
      })
      .returning({ id: approvalRequests.id });
    await writeAudit(tx, {
      orgId: input.orgId,
      actorType: "AGENT",
      actorId: input.agentId,
      action: "approval.request",
      targetType: "approval_request",
      targetId: req.id,
      reasoning: `역제안: ${topic}`,
      payload: { type: "PROPOSAL", kind: PROPOSAL_KIND },
    });
    return { id: req.id, name: agent?.name ?? "에이전트" };
  });
  if (!id) return null;
  await notifyOrgOwner(db, input.orgId, { title: `💡 ${id.name}의 제안`, body: input.proposal.topic.slice(0, 120), url: `/approvals/${id.id}`, tag: `approval-${id.id}` });
  return id.id;
}
