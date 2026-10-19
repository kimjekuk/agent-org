// 외부로 나가는 행동(push·send·share·purchase)은 승인된 ApprovalRequest가 있어야만 실행한다 (CLAUDE.md 절대 규칙 3)
import { and, eq } from "drizzle-orm";
import type { AnyDb } from "./db/client";
import { writeAudit } from "./audit";
import { agents, approvalRequests, messages, missions, organizations } from "./db/schema";
import type { MissionMessagePayload } from "./missions";
import { PROPOSAL_KIND, type ProposalPayload } from "./proposals";
import { pickLeader, startMission } from "./schedule";

export class ApprovalRequiredError extends Error {
  constructor(message = "사용자 승인이 필요합니다") {
    super(message);
    this.name = "ApprovalRequiredError";
  }
}

/** EXTERNAL 유형 요청이 사용자에 의해 APPROVED 상태일 때만 통과. 그 외는 예외. */
export async function requireExternalApproval(db: AnyDb, orgId: string, approvalId: string | null | undefined) {
  if (!approvalId) throw new ApprovalRequiredError();
  const [req] = await db
    .select({ status: approvalRequests.status, type: approvalRequests.type })
    .from(approvalRequests)
    .where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.orgId, orgId)));
  if (!req || req.type !== "EXTERNAL") throw new ApprovalRequiredError("외부 발송 승인 요청을 찾을 수 없습니다");
  if (req.status !== "APPROVED") throw new ApprovalRequiredError(`승인되지 않았습니다 (현재: ${req.status})`);
}

// ── F012 승인 대기함: 사용자 결정 기록 → 해당 에이전트에게 메시지로 전달 ──────────

export type ApprovalDecision = "APPROVED" | "REJECTED" | "HELD";

export interface DecideInput {
  orgId: string;
  userId: string;
  approvalId: string;
  decision: ApprovalDecision;
  comment?: string | null;
}

/**
 * 결정을 기록하고 AuditLog를 남긴다. 미션의 체크포인트·질문이면 리더에게 결과 메시지를 보낸다
 * (보류는 메시지 없이 그대로 두고 나중에 다시 결정할 수 있다).
 * 큐에 넣어야 할 에이전트가 있으면 돌려준다 (큐 등록은 호출한 쪽에서).
 */
export async function decideApproval(db: AnyDb, input: DecideInput): Promise<{ error: string } | { notify: { orgId: string; agentId: string } | null }> {
  const [req] = await db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.id, input.approvalId), eq(approvalRequests.orgId, input.orgId)));
  if (!req) return { error: "승인 요청을 찾을 수 없습니다" };
  if (req.status === "APPROVED" || req.status === "REJECTED") return { error: "이미 처리한 요청입니다" };
  const comment = input.comment?.trim().slice(0, 2000) || null;
  const label = { APPROVED: "승인", REJECTED: "거절", HELD: "보류" }[input.decision];
  const proposal = (req.payload as ProposalPayload | null)?.kind === PROPOSAL_KIND ? (req.payload as ProposalPayload) : null;
  // F108 역제안 승인 = 미션 시작. 맡을 리더가 없으면 결정 전에 알린다
  let proposalLeader: Awaited<ReturnType<typeof pickLeader>> | null = null;
  if (proposal && input.decision === "APPROVED") {
    const [proposer] = req.agentId ? await db.select({ id: agents.id, rank: agents.rank }).from(agents).where(eq(agents.id, req.agentId)) : [];
    proposalLeader = await pickLeader(db, input.orgId, proposer?.rank === "LEADER" ? proposer.id : null);
    if (!proposalLeader) return { error: "미션을 맡을 리더가 없습니다. 에이전트 화면에서 리더를 채용한 뒤 승인해 주세요" };
  }

  return db.transaction(async (tx) => {
    await tx
      .update(approvalRequests)
      .set({ status: input.decision, decidedAt: new Date(), userComment: comment })
      .where(eq(approvalRequests.id, req.id));
    await writeAudit(tx, {
      orgId: input.orgId,
      actorType: "USER",
      actorId: input.userId,
      action: "approval.decide",
      targetType: "approval_request",
      targetId: req.id,
      reasoning: `${label}${comment ? `: ${comment}` : ""}`,
      payload: { type: req.type, decision: input.decision },
    });
    if (input.decision === "HELD") return { notify: null };

    if (req.missionId && (req.type === "CHECKPOINT" || req.type === "QUESTION")) {
      const [mission] = await tx.select({ leaderId: missions.leaderId }).from(missions).where(eq(missions.id, req.missionId));
      if (!mission?.leaderId) return { notify: null };
      const payload: MissionMessagePayload = { kind: "APPROVAL", approvalId: req.id };
      const [msg] = await tx
        .insert(messages)
        .values({
          orgId: input.orgId,
          missionId: req.missionId,
          taskId: req.taskId,
          senderType: "USER",
          receiverAgentId: mission.leaderId,
          type: "DIRECTIVE",
          content: `[승인함] ${label}${comment ? ` — ${comment}` : ""}\n(${req.content.split("\n")[0]})`,
          payload,
          priority: 100,
        })
        .returning({ id: messages.id });
      await writeAudit(tx, {
        orgId: input.orgId,
        actorType: "USER",
        actorId: input.userId,
        action: "message.directive",
        targetType: "message",
        targetId: msg.id,
        reasoning: `승인 결정(${label})을 리더에게 전달`,
      });
      return { notify: { orgId: input.orgId, agentId: mission.leaderId } };
    }
    // F108 역제안: 승인하면 제안 내용으로 미션을 시작한다 (자율성은 조직 기본값, 예산 기본값)
    if (proposal) {
      if (input.decision !== "APPROVED" || !proposalLeader) return { notify: null };
      const [org] = await tx.select({ autonomyDefault: organizations.autonomyDefault }).from(organizations).where(eq(organizations.id, input.orgId));
      const notes = [proposal.reason ? `제안 이유: ${proposal.reason}` : "", comment ? `사용자 의견 (최우선): ${comment}` : ""].filter(Boolean).join("\n");
      const mission = await startMission(tx, {
        orgId: input.orgId,
        leaderId: proposalLeader.id,
        leaderName: proposalLeader.name,
        actor: { type: "USER", id: input.userId },
        topic: proposal.topic,
        goal: proposal.goal ?? null,
        autonomy: org?.autonomyDefault ?? "CHECKPOINT",
        referenceNotes: notes || null,
      });
      await tx
        .update(approvalRequests)
        .set({ payload: { ...proposal, missionId: mission.id } })
        .where(eq(approvalRequests.id, req.id));
      return { notify: { orgId: input.orgId, agentId: proposalLeader.id } };
    }
    // F102 승진 제안: 승인하면 직급을 바꾼다
    const kind = (req.payload as { kind?: string; toRank?: string } | null)?.kind;
    if (kind === "PROMOTION" && req.agentId) {
      if (input.decision === "APPROVED") {
        const toRank = (req.payload as { toRank?: "MANAGER" | "LEADER" }).toRank ?? "MANAGER";
        await tx.update(agents).set({ rank: toRank }).where(and(eq(agents.id, req.agentId), eq(agents.orgId, input.orgId)));
        await writeAudit(tx, {
          orgId: input.orgId,
          actorType: "USER",
          actorId: input.userId,
          action: "agent.promote",
          targetType: "agent",
          targetId: req.agentId,
          reasoning: `승진 제안 승인 → ${toRank === "LEADER" ? "리더" : "팀장"}`,
        });
      }
      return { notify: null };
    }
    // 예산 초과 등: 승인하면 멈춘 에이전트가 남은 일을 다시 시도한다 (한도를 늘리지 않았으면 다시 멈춤)
    return { notify: input.decision === "APPROVED" && req.agentId ? { orgId: input.orgId, agentId: req.agentId } : null };
  });
}
