// F013 예산 판단. PRD 5장 F013: 70% 경고, 80% 절약 모드, 100% 자동 중단
import { and, eq, gte, sql } from "drizzle-orm";
import type { AnyDb } from "./db/client";
import { agents, costLogs, missions, organizations } from "./db/schema";

export type BudgetLevel = "OK" | "WARN" | "ECONOMY" | "STOP";

export interface BudgetScope {
  orgId: string;
  agentId?: string | null;
  missionId?: string | null;
}

export interface BudgetCheck {
  level: BudgetLevel;
  /** 가장 많이 쓴 한도의 사용률 (0~) */
  ratio: number;
  /** 그 한도의 이름 (조직 일/월, 미션, 에이전트) */
  limitName: string | null;
}

export function levelFor(ratio: number): BudgetLevel {
  if (ratio >= 1) return "STOP";
  if (ratio >= 0.8) return "ECONOMY";
  if (ratio >= 0.7) return "WARN";
  return "OK";
}

// 한국 시간 기준 오늘 0시 / 이번 달 1일 0시
const startOfToday = sql`(date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`;
const startOfMonth = sql`(date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`;

async function spent(db: AnyDb, ...conds: Parameters<typeof and>): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${costLogs.cost}), 0)` })
    .from(costLogs)
    .where(and(...conds));
  return Number(row?.total ?? 0);
}

/** 조직·미션·에이전트 한도 중 가장 많이 찬 것을 기준으로 판단한다. */
export async function checkBudget(db: AnyDb, scope: BudgetScope): Promise<BudgetCheck> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, scope.orgId));
  if (!org) throw new Error("조직을 찾을 수 없습니다");

  const limits: { name: string; limit: number; spent: () => Promise<number> }[] = [
    { name: "조직 일 한도", limit: org.budgetDaily, spent: () => spent(db, eq(costLogs.orgId, org.id), gte(costLogs.createdAt, startOfToday)) },
  ];
  if (org.budgetMonthly != null) {
    limits.push({ name: "조직 월 한도", limit: org.budgetMonthly, spent: () => spent(db, eq(costLogs.orgId, org.id), gte(costLogs.createdAt, startOfMonth)) });
  }
  if (scope.missionId) {
    const [m] = await db.select({ limit: missions.budgetLimit }).from(missions).where(eq(missions.id, scope.missionId));
    if (m) limits.push({ name: "미션 한도", limit: m.limit, spent: () => spent(db, eq(costLogs.missionId, scope.missionId!)) });
  }
  if (scope.agentId) {
    const [a] = await db.select({ limit: agents.budgetLimit }).from(agents).where(eq(agents.id, scope.agentId));
    if (a?.limit != null) limits.push({ name: "에이전트 한도", limit: a.limit, spent: () => spent(db, eq(costLogs.agentId, scope.agentId!)) });
  }

  let worst: BudgetCheck = { level: "OK", ratio: 0, limitName: null };
  for (const l of limits) {
    const ratio = l.limit <= 0 ? Infinity : (await l.spent()) / l.limit; // 한도 0원 = 사용 금지
    if (ratio > worst.ratio) worst = { level: levelFor(ratio), ratio, limitName: l.name };
  }
  return worst;
}
