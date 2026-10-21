// F204 조직 역사 연표 (2026-10-21 결정): 미션 완료·별점 · 채용·해고·승진·레벨업 · 처음 있는 일 · 비용 기록
// 감사 로그·비용 기록만 모은다 (AI 호출 없음). 최근 것부터, 화면에서 월별로 묶는다
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { AnyDb } from "./db/client";
import { agents, artifacts, auditLogs, costLogs, missions } from "./db/schema";

export type HistoryKind = "MISSION" | "PEOPLE" | "FIRST" | "COST";

export interface HistoryEntry {
  at: Date;
  kind: HistoryKind;
  icon: string;
  title: string;
  detail?: string;
  href?: string;
}

const ACTIONS = [
  "org.create",
  "mission.complete",
  "agent.hire",
  "agent.fire",
  "agent.rehire",
  "agent.promote",
  "agent.level_up",
  "artifact.rate",
  "knowledge.add",
  "knowledge.create",
  "meeting.conclude",
  "budget.exceeded",
];

/** '처음 있는 일'로 표시할 기록 (조직에서 가장 먼저 일어난 것 하나씩) */
const FIRSTS: { action: string; title: string; icon: string; match?: (reasoning: string) => boolean }[] = [
  { action: "mission.complete", title: "첫 미션 완료", icon: "🎉" },
  { action: "artifact.rate", title: "첫 별 다섯 개", icon: "🌟", match: (r) => /평가 5점/.test(r) },
  { action: "meeting.conclude", title: "첫 회의", icon: "🤝" },
  { action: "knowledge.add", title: "첫 지식 문서", icon: "📚" },
  { action: "agent.promote", title: "첫 승진", icon: "🎖️" },
];

const KST_DAY = sql<string>`to_char(${costLogs.createdAt} at time zone 'Asia/Seoul', 'YYYY-MM-DD')`;

export async function orgHistory(db: AnyDb, orgId: string, limit = 300): Promise<HistoryEntry[]> {
  const rows = await db
    .select({ at: auditLogs.createdAt, action: auditLogs.action, targetId: auditLogs.targetId, reasoning: auditLogs.reasoning })
    .from(auditLogs)
    .where(and(eq(auditLogs.orgId, orgId), inArray(auditLogs.action, ACTIONS)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(2000);

  const missionIds = rows.filter((r) => r.action === "mission.complete" && r.targetId).map((r) => r.targetId!);
  const agentIds = rows.filter((r) => r.action.startsWith("agent.") && r.targetId).map((r) => r.targetId!);
  const [missionRows, finals, people, [peak]] = await Promise.all([
    missionIds.length ? db.select({ id: missions.id, title: missions.title }).from(missions).where(inArray(missions.id, missionIds)) : [],
    missionIds.length
      ? db
          .select({ missionId: artifacts.missionId, rating: sql<number | null>`max(${artifacts.rating})` })
          .from(artifacts)
          .where(and(inArray(artifacts.missionId, missionIds), sql`${artifacts.taskId} is null`))
          .groupBy(artifacts.missionId)
      : [],
    agentIds.length ? db.select({ id: agents.id, name: agents.name }).from(agents).where(inArray(agents.id, agentIds)) : [],
    db
      .select({ day: KST_DAY, krw: sql<string>`sum(${costLogs.cost})`, at: sql<Date>`max(${costLogs.createdAt})` })
      .from(costLogs)
      .where(eq(costLogs.orgId, orgId))
      .groupBy(KST_DAY)
      .orderBy(sql`sum(${costLogs.cost}) desc`)
      .limit(1),
  ]);
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? "에이전트";
  const out: HistoryEntry[] = [];

  for (const r of rows) {
    const at = new Date(r.at);
    const why = r.reasoning ?? "";
    switch (r.action) {
      case "org.create":
        out.push({ at, kind: "FIRST", icon: "🏢", title: "조직 창립", detail: why });
        break;
      case "mission.complete": {
        const m = missionRows.find((x) => x.id === r.targetId);
        const rating = finals.find((f) => f.missionId === r.targetId)?.rating;
        out.push({ at, kind: "MISSION", icon: "🏁", title: `미션 완료: ${m?.title ?? "미션"}`, detail: rating ? `별점 ${"★".repeat(Number(rating))}` : undefined, href: m ? `/missions/${m.id}` : undefined });
        break;
      }
      case "agent.hire":
        out.push({ at, kind: "PEOPLE", icon: "👋", title: `${nameOf(r.targetId)} 입사`, detail: why, href: `/agents/${r.targetId}` });
        break;
      case "agent.fire":
        out.push({ at, kind: "PEOPLE", icon: "📦", title: `${nameOf(r.targetId)} 퇴사`, href: `/agents/${r.targetId}` });
        break;
      case "agent.rehire":
        out.push({ at, kind: "PEOPLE", icon: "🔁", title: `${nameOf(r.targetId)} 복귀`, href: `/agents/${r.targetId}` });
        break;
      case "agent.promote":
        out.push({ at, kind: "PEOPLE", icon: "🎖️", title: `${nameOf(r.targetId)} 승진`, detail: why, href: `/agents/${r.targetId}` });
        break;
      case "agent.level_up": {
        const lv = why.match(/레벨 \d+ → (\d+) \(([^)]+)\)/);
        out.push({ at, kind: "PEOPLE", icon: "⬆️", title: `${nameOf(r.targetId)} 레벨 ${lv?.[1] ?? "업"}${lv ? ` (${lv[2]})` : ""}`, href: `/agents/${r.targetId}` });
        break;
      }
      case "budget.exceeded":
        out.push({ at, kind: "COST", icon: "🛑", title: "예산 한도 도달", detail: why });
        break;
    }
  }

  // 처음 있는 일: 가장 오래된 기록 하나씩
  for (const f of FIRSTS) {
    const first = rows.filter((r) => r.action === f.action && (!f.match || f.match(r.reasoning ?? ""))).at(-1);
    if (first) out.push({ at: new Date(first.at), kind: "FIRST", icon: f.icon, title: f.title, detail: first.reasoning ?? undefined });
  }
  if (peak && Number(peak.krw) > 0) {
    out.push({ at: new Date(peak.at), kind: "COST", icon: "💸", title: `하루 최고 지출 ${Math.round(Number(peak.krw)).toLocaleString("ko-KR")}원`, detail: `${peak.day} (한국 날짜)` });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/** 연표를 한국 기준 'YYYY년 M월'로 묶는다 */
export function groupByMonth(entries: HistoryEntry[]): { month: string; entries: HistoryEntry[] }[] {
  const groups: { month: string; entries: HistoryEntry[] }[] = [];
  for (const e of entries) {
    const kst = new Date(e.at.getTime() + 9 * 3600_000);
    const month = `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월`;
    const g = groups.at(-1);
    if (g?.month === month) g.entries.push(e);
    else groups.push({ month, entries: [e] });
  }
  return groups;
}
