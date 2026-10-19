// F006·F007 미션 공통 정의. web(미션 생성·승인함)과 worker(리더 루프)가 함께 쓴다.

export type Autonomy = "FULL" | "CHECKPOINT" | "MANUAL";

export const AUTONOMY_LABEL: Record<Autonomy, string> = { FULL: "완전 자율", CHECKPOINT: "체크포인트", MANUAL: "수동" };
export const AUTONOMY_HELP: Record<Autonomy, string> = {
  FULL: "승인 없이 끝까지 진행",
  CHECKPOINT: "계획과 최종 결과를 승인받음",
  MANUAL: "계획, Task마다, 최종 결과를 승인받음",
};

/** 체크포인트 단계 (2026-10-18 결정: 체크포인트 = 계획·최종 2번, 수동 = 계획·Task마다·최종) */
export type CheckpointStage = "PLAN" | "TASK" | "FINAL";

export function needsCheckpoint(autonomy: Autonomy, stage: CheckpointStage): boolean {
  if (autonomy === "FULL") return false;
  if (autonomy === "CHECKPOINT") return stage !== "TASK";
  return true;
}

export const OUTPUT_FORMATS = ["보고서", "기획안", "요약", "목록"] as const;

/** 리더 반려는 Task당 최대 1회, 실패는 3회면 사용자에게 질문 (PRD F007/F008, 2026-10-18 결정) */
export const MAX_REJECTS = 1;
export const MAX_FAILS = 3;

/** F109 무한 반복 차단: 미션의 AI 호출 상한 기본값, 사용자가 '계속'을 승인할 때마다 늘리는 양 (2026-10-18 결정) */
export const CALL_LIMIT_STEP = 60;

/**
 * 미션 메시지의 payload.kind. 리더는 이 값으로 할 일을 고른다.
 * - MISSION_START: 사용자가 미션을 만들었다 → 계획
 * - APPROVAL: 사용자가 승인함에서 결정했다
 * - NOTE: 사용자가 미션 대화에 끼어들었다
 * - TASK_MOVED: 사용자가 칸반에서 Task를 옮겼다
 * - FINALIZE: 리더가 스스로에게 — 모든 Task 완료, 최종 통합
 * - TASK: 리더가 담당에게 — Task 수행 지시
 * - RESUME: 시스템이 리더에게 — 멈춘 미션을 마지막으로 끝난 단계 다음부터 이어서 (F109)
 * - MEETING: 리더·앞 참여자가 다음 참여자에게 — 회의에서 의견 말하기 (F104)
 * - MEETING_WRAP: 마지막 참여자·사용자 답글이 리더에게 — 회의 결론 정리 (F104)
 */
export type MissionMessageKind = "MISSION_START" | "APPROVAL" | "NOTE" | "TASK_MOVED" | "FINALIZE" | "TASK" | "RESUME" | "MEETING" | "MEETING_WRAP";

export interface MissionMessagePayload {
  kind: MissionMessageKind;
  approvalId?: string;
  /** MEETING · MEETING_WRAP: 어느 회의인지 */
  meetingId?: string;
}

export interface ApprovalPayload {
  stage?: CheckpointStage;
  artifactId?: string | null;
  /** QUESTION: TASK_FAILED(Task 실패 반복) | LEADER_FAILED(리더 처리 실패) | CALL_LIMIT(미션 AI 호출 상한 도달) */
  reason?: "TASK_FAILED" | "LEADER_FAILED" | "CALL_LIMIT";
  /** LEADER_FAILED: 승인하면 다시 처리할 메시지 */
  retryMessageId?: string;
}

export function missionKind(payload: unknown): MissionMessageKind | undefined {
  return (payload as MissionMessagePayload | null)?.kind;
}
