// F102 성장 시스템 (2026-10-19 결정)
// - 경험치: 끝낸 일 + 리더 검토 통과 + 사용자 별점(4~5점) + 미션 예산 절약. 실패·반려는 0. AI 호출 없음
// - 레벨: 누적 경험치로 계산, 칭호 표시. 레벨이 오르면 감사 로그 + 푸시
// - 특기 숙련: 검토를 통과한 Task의 필요 특기가 5번 쌓이면 '숙련' → 리더가 담당을 고를 때 우선
// - 승진: 팀원이 레벨 5가 되면 승인함에 '팀장 승진' 제안. 사용자가 결정 (자동 승진 없음)
import { and, eq, sql } from "drizzle-orm";
import { writeAudit } from "./audit";
import type { AnyDb } from "./db/client";
import { agents, approvalRequests } from "./db/schema";
import { notifyOrgOwner } from "./push";

export const XP = {
  /** 지시·Task를 끝내고 보고 */
  WORK_DONE: 10,
  /** 리더 검토 통과 (반려 한도로 통과된 것은 제외) */
  REVIEW_PASS: 15,
  /** 사용자 별점 4점 / 5점 */
  RATING: { 4: 10, 5: 20 } as Record<number, number>,
  /** 미션을 예산의 절반 이하로 끝냄 (참여자 모두) */
  UNDER_BUDGET: 10,
} as const;

/** 이 횟수만큼 검토를 통과하면 그 특기는 '숙련' */
export const MASTERY_COUNT = 5;
/** 이 레벨이 되면 팀원 → 팀장 승진을 제안한다 */
export const PROMOTION_LEVEL = 5;

/** 레벨 L이 되는 데 필요한 누적 경험치: 50·L·(L-1)/2 (2레벨 50, 3레벨 150, 4레벨 300, 5레벨 500 …) */
export function xpForLevel(level: number): number {
  return (50 * level * (level - 1)) / 2;
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

export function levelTitle(level: number): string {
  if (level >= 10) return "마스터";
  if (level >= 7) return "베테랑";
  if (level >= 5) return "시니어";
  if (level >= 3) return "주니어";
  return "신입";
}

/** 다음 레벨까지 진행률 (0~1) */
export function levelProgress(xp: number): { level: number; current: number; next: number; ratio: number } {
  const level = levelForXp(xp);
  const current = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, current, next, ratio: Math.min(1, (xp - current) / (next - current)) };
}

/** 숙련된 특기 (검토 통과가 MASTERY_COUNT번 이상) */
export function masteredSkills(skillXp: Record<string, number> | null | undefined): string[] {
  return Object.entries(skillXp ?? {})
    .filter(([, n]) => n >= MASTERY_COUNT)
    .map(([s]) => s);
}

/** 에이전트의 특기 중 Task가 필요로 하는 것 (부분 일치, 대소문자 무시) — 리더 배정과 같은 기준 */
export function matchingSkills(agentSkills: string[], required: string[]): string[] {
  const req = required.map((r) => r.toLowerCase());
  return agentSkills.filter((s) => req.some((r) => r.includes(s.toLowerCase()) || s.toLowerCase().includes(r)));
}

/**
 * 경험치를 준다. 레벨이 오르면 감사 로그·푸시, 팀원이 승진 레벨에 닿으면 승인함에 승진 제안.
 * skills를 주면 그 특기의 숙련 횟수도 1씩 올린다.
 */
export async function awardXp(db: AnyDb, input: { agentId: string; amount: number; reason: string; skills?: string[] }) {
  if (input.amount <= 0 && !input.skills?.length) return;
  const result = await db.transaction(async (tx) => {
    const [agent] = await tx.select().from(agents).where(eq(agents.id, input.agentId));
    if (!agent) return null;
    const xp = agent.xp + Math.max(0, input.amount);
    const level = levelForXp(xp);
    const skillXp = { ...((agent.skillXp ?? {}) as Record<string, number>) };
    for (const s of input.skills ?? []) skillXp[s] = (skillXp[s] ?? 0) + 1;
    const newlyMastered = (input.skills ?? []).filter((s) => skillXp[s] === MASTERY_COUNT);
    await tx.update(agents).set({ xp, level, skillXp }).where(eq(agents.id, agent.id));
    await writeAudit(tx, {
      orgId: agent.orgId,
      actorType: "SYSTEM",
      action: level > agent.level ? "agent.level_up" : "agent.xp",
      targetType: "agent",
      targetId: agent.id,
      reasoning: `${input.reason}: +${input.amount} XP (총 ${xp})${level > agent.level ? ` — 레벨 ${agent.level} → ${level} (${levelTitle(level)})` : ""}${newlyMastered.length ? ` · 숙련: ${newlyMastered.join(", ")}` : ""}`,
      payload: { amount: input.amount, xp, level, skills: input.skills ?? [] },
    });

    // 승진 제안: 팀원이 승진 레벨에 처음 닿았고, 같은 제안이 없었을 때만
    let promotionId: string | null = null;
    if (agent.rank === "MEMBER" && agent.isActive && level >= PROMOTION_LEVEL && agent.level < PROMOTION_LEVEL) {
      const [prev] = await tx
        .select({ id: approvalRequests.id })
        .from(approvalRequests)
        .where(and(eq(approvalRequests.agentId, agent.id), sql`${approvalRequests.payload}->>'kind' = 'PROMOTION'`))
        .limit(1);
      if (!prev) {
        const [req] = await tx
          .insert(approvalRequests)
          .values({
            orgId: agent.orgId,
            agentId: agent.id,
            type: "PROPOSAL",
            content: `${agent.name}이(가) 레벨 ${level}(${levelTitle(level)})이 되었습니다. 팀장으로 승진시킬까요?\n\n승인 = 팀장 승진 / 거절 = 지금 직급 유지`,
            payload: { kind: "PROMOTION", toRank: "MANAGER" },
          })
          .returning({ id: approvalRequests.id });
        promotionId = req.id;
        await writeAudit(tx, {
          orgId: agent.orgId,
          actorType: "SYSTEM",
          action: "approval.request",
          targetType: "approval_request",
          targetId: req.id,
          reasoning: `${agent.name} 팀장 승진 제안 (레벨 ${level})`,
        });
      }
    }
    return { agent, level, promotionId };
  });
  if (!result) return;
  const { agent, level, promotionId } = result;
  if (level > agent.level) {
    await notifyOrgOwner(db, agent.orgId, { title: `🎉 ${agent.name} 레벨 ${level}`, body: `${levelTitle(level)}이(가) 되었습니다`, url: `/agents/${agent.id}`, tag: `level-${agent.id}` });
  }
  if (promotionId) {
    await notifyOrgOwner(db, agent.orgId, { title: "✋ 승진 제안", body: `${agent.name}을(를) 팀장으로 승진시킬까요?`, url: `/approvals/${promotionId}`, tag: `approval-${promotionId}` });
  }
}

/** 별점이 바뀌면 보너스 차이만큼 준다 (예: 4점 → 5점이면 +10). 낮추면 빼지 않는다 */
export function ratingBonus(previous: number | null | undefined, next: number): number {
  return Math.max(0, (XP.RATING[next] ?? 0) - (XP.RATING[previous ?? 0] ?? 0));
}
