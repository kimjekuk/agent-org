"use server";

// F012 승인 대기함: 승인·거절·보류 + 코멘트 → 해당 에이전트에게 메시지로 전달 → AuditLog (decideApproval)
import { type ApprovalDecision, decideApproval } from "@agentorg/shared/approval";
import { getDb } from "@agentorg/shared/db";
import { runExport } from "@agentorg/shared/export";
import { publishOrgEvent } from "@agentorg/shared/events";
import { enqueueAgentRun } from "@agentorg/shared/queue";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export type FormState = { error?: string; ok?: string } | undefined;

const DECISIONS: ApprovalDecision[] = ["APPROVED", "REJECTED", "HELD"];

export async function decide(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) redirect("/settings");
  const decision = String(form.get("decision")) as ApprovalDecision;
  if (!DECISIONS.includes(decision)) return { error: "결정을 골라 주세요" };
  const approvalId = String(form.get("id"));
  if (!/^[0-9a-f-]{36}$/i.test(approvalId)) return { error: "승인 요청을 찾을 수 없습니다" };

  const r = await decideApproval(getDb(), { orgId: org.id, userId: user.id, approvalId, decision, comment: String(form.get("comment") ?? "") });
  if ("error" in r) return { error: r.error };
  const queued = r.notify ? await enqueueAgentRun(r.notify) : true;
  await publishOrgEvent(org.id, { type: "approval" });
  if (r.notify) await publishOrgEvent(org.id, { type: "message", agentId: r.notify.agentId });
  // F205 외부 발송: 승인한 지금 보낸다 (실패하면 상세 화면에서 '다시 보내기')
  const sent = r.exportApproved ? await runExport(getDb(), { orgId: org.id, userId: user.id, approvalId }) : null;
  revalidatePath("/approvals");
  revalidatePath(`/approvals/${approvalId}`);
  if (sent) return "error" in sent ? { error: `승인했지만 보내지 못했습니다: ${sent.error}` } : { ok: "승인하고 보냈습니다." };

  const notes = [];
  if (!queued) notes.push("작업 대기열 연결이 늦어 최대 2분 뒤 전달됩니다");
  if (org.emergencyStop && r.notify) notes.push("긴급 정지 중이라 재개하면 전달됩니다");
  const label = { APPROVED: "승인했습니다", REJECTED: "거절했습니다", HELD: "보류했습니다. 나중에 다시 결정할 수 있습니다" }[decision];
  return { ok: notes.length ? `${label}. ${notes.join(", ")}.` : `${label}.` };
}

/** F205 승인된 외부 발송이 실패했을 때 다시 보내기 (승인 상태는 runExport가 다시 확인한다) */
export async function retryExport(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) redirect("/settings");
  const approvalId = String(form.get("id"));
  if (!/^[0-9a-f-]{36}$/i.test(approvalId)) return { error: "승인 요청을 찾을 수 없습니다" };
  let r: Awaited<ReturnType<typeof runExport>>;
  try {
    r = await runExport(getDb(), { orgId: org.id, userId: user.id, approvalId });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/approvals/${approvalId}`);
  return "error" in r ? { error: `보내지 못했습니다: ${r.error}` } : { ok: "보냈습니다." };
}
