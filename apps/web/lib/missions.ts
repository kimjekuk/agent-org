import { getDb, schema } from "@agentorg/shared/db";
import { and, eq } from "drizzle-orm";

export type Mission = typeof schema.missions.$inferSelect;
export type Task = typeof schema.tasks.$inferSelect;

export const MISSION_STATUS: Record<Mission["status"], { label: string; className: string }> = {
  DRAFT: { label: "초안", className: "bg-black/10 text-black/70 dark:bg-white/10 dark:text-white/70" },
  RUNNING: { label: "진행 중", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200" },
  PAUSED: { label: "일시정지", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200" },
  REVIEW: { label: "최종 승인 대기", className: "bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200" },
  DONE: { label: "완료", className: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200" },
  CANCELLED: { label: "취소", className: "bg-black/10 text-black/60 dark:bg-white/10 dark:text-white/60" },
};

export const TASK_COLUMNS: { status: Task["status"]; label: string }[] = [
  { status: "TODO", label: "할 일" },
  { status: "DOING", label: "진행" },
  { status: "REVIEW", label: "검토" },
  { status: "DONE", label: "완료" },
];

export const PRIORITY_LABEL: Record<number, string> = { 0: "보통", 1: "높음", 2: "긴급" };

export function progress(list: Pick<Task, "status">[]): number {
  if (list.length === 0) return 0;
  return Math.round((list.filter((t) => t.status === "DONE").length / list.length) * 100);
}

/** 이 조직의 미션인지 확인하고 돌려준다 */
export async function getOrgMission(orgId: string, missionId: string): Promise<Mission | null> {
  if (!/^[0-9a-f-]{36}$/i.test(missionId)) return null;
  const [m] = await getDb()
    .select()
    .from(schema.missions)
    .where(and(eq(schema.missions.id, missionId), eq(schema.missions.orgId, orgId)));
  return m ?? null;
}
