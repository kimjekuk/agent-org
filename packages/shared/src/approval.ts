// 외부로 나가는 행동(push·send·share·purchase)은 승인된 ApprovalRequest가 있어야만 실행한다 (CLAUDE.md 절대 규칙 3)
import { and, eq } from "drizzle-orm";
import type { AnyDb } from "./db/client";
import { approvalRequests } from "./db/schema";

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
