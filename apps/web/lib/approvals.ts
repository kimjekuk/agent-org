import type { schema } from "@agentorg/shared/db";
import type { ApprovalPayload } from "@agentorg/shared/missions";

type Approval = typeof schema.approvalRequests.$inferSelect;

const PURPLE = "bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200";
const AMBER = "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200";
const RED = "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200";
const BLUE = "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200";

/** 유형 뱃지 (PRD F012: 질문/제안/외부발송/체크포인트/예산초과) */
export function approvalBadge(req: Pick<Approval, "type" | "payload">): { label: string; className: string } {
  const p = (req.payload ?? {}) as ApprovalPayload;
  switch (req.type) {
    case "CHECKPOINT":
      return { label: p.stage === "PLAN" ? "계획 승인" : p.stage === "FINAL" ? "최종 승인" : "Task 승인", className: PURPLE };
    case "QUESTION":
      return { label: "질문", className: AMBER };
    case "BUDGET":
      return { label: "예산 초과", className: RED };
    case "EXTERNAL":
      return { label: "외부 발송", className: RED };
    default:
      return { label: "제안", className: BLUE };
  }
}

/** 승인·거절 버튼 문구 — 누르면 무슨 일이 일어나는지 바로 알 수 있게 */
export function decisionLabels(req: Pick<Approval, "type" | "payload">): { approve: string; reject: string; help: string } {
  const p = (req.payload ?? {}) as ApprovalPayload;
  if (req.type === "CHECKPOINT" && p.stage === "PLAN") return { approve: "계획 승인", reject: "다시 계획", help: "승인하면 첫 Task부터 담당에게 지시합니다. 거절하면 코멘트를 반영해 리더가 계획을 다시 세웁니다." };
  if (req.type === "CHECKPOINT" && p.stage === "TASK") return { approve: "결과 승인", reject: "다시 하기", help: "승인하면 다음 Task로 넘어갑니다. 거절하면 코멘트를 반영해 담당이 다시 합니다." };
  if (req.type === "CHECKPOINT" && p.stage === "FINAL") return { approve: "최종 승인", reject: "수정 요청", help: "승인하면 미션을 마칩니다. 거절하면 코멘트를 반영해 리더가 최종 결과를 고칩니다." };
  if (req.type === "QUESTION" && p.reason === "TASK_FAILED") return { approve: "다시 시도", reject: "건너뛰기", help: "승인하면 같은 담당이 다시 합니다 (코멘트는 안내로 전달). 거절하면 이 Task를 건너뛰고 다음으로 갑니다." };
  if (req.type === "QUESTION" && p.reason === "REJECT_LIMIT")
    return { approve: "이대로 통과", reject: "다시 하기", help: "검토에서 두 번 반려된 결과입니다. 승인하면 이대로 다음 Task로 넘어갑니다. 거절하면 코멘트를 담당에게 전달해 다시 합니다." };
  if (req.type === "QUESTION") return { approve: "다시 시도", reject: "그대로 두기", help: "승인하면 리더가 실패한 일을 다시 처리합니다." };
  if (req.type === "PROPOSAL" && (req.payload as { kind?: string } | null)?.kind === "MISSION_PROPOSAL")
    return { approve: "미션 시작", reject: "하지 않음", help: "승인하면 이 내용으로 바로 미션을 시작합니다 (자율성은 조직 기본값, 예산 5,000원). 코멘트는 리더에게 '사용자 의견'으로 전달됩니다. 보류하면 보류 목록에 남습니다." };
  if (req.type === "BUDGET")
    return { approve: "계속 진행", reject: "멈춤 유지", help: "한도를 늘리지 않고 계속하면 바로 다시 멈춥니다. 미션 화면의 '자율성 · 예산 변경' 또는 에이전트 프로필에서 먼저 한도를 늘려 주세요." };
  return { approve: "승인", reject: "거절", help: "" };
}

export function waitingFor(since: Date, now = new Date()): string {
  const min = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60000));
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 대기`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}시간 대기`;
  return `${Math.floor(min / 1440)}일 대기`;
}
