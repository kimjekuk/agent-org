import type { Avatar } from "@agentorg/shared/agents/templates";
import { levelFor, spentToday } from "@agentorg/shared/budget";
import { getDb, schema } from "@agentorg/shared/db";
import { costStats, statsRange } from "@agentorg/shared/stats";
import { and, asc, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { AgentAvatar } from "@/components/AgentAvatar";
import { DailyBars } from "@/components/Charts";
import { Office } from "@/components/Office";
import { RANK_LABEL, isRestTime, statusBadge } from "@/lib/agents";
import { MISSION_STATUS, progress } from "@/lib/missions";
import { loadOffice } from "@/lib/office";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { buttonGhost, card } from "@/lib/ui";
import { togglePause } from "../agents/actions";
import { dismissBriefing } from "./actions";

export const dynamic = "force-dynamic";

const won = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const timeFmt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul" });
const RANK_ORDER = { LEADER: 0, MANAGER: 1, MEMBER: 2 } as const;

// F003 CEO 대시보드: 카드 4개 · 출근 브리핑(F016) · 진행 중 미션 · 에이전트 상태 그리드. SSE로 자동 갱신
export default async function DashboardPage() {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <h1 className="mb-2 text-xl font-bold">시작하기</h1>
        <p className="text-sm">
          <Link href="/settings" className="underline">
            설정
          </Link>
          에서 조직을 만들고 API 키를 등록해 주세요.
        </p>
      </main>
    );
  }
  const db = getDb();
  const [me] = await db.select({ briefingSeenAt: schema.users.briefingSeenAt, createdAt: schema.users.createdAt }).from(schema.users).where(eq(schema.users.id, user.id));
  const since = me?.briefingSeenAt ?? me?.createdAt ?? new Date(0);

  const [agents, active, [pending], today, briefing, office, week] = await Promise.all([
    db.select().from(schema.agents).where(eq(schema.agents.orgId, org.id)).orderBy(asc(schema.agents.createdAt)),
    db
      .select()
      .from(schema.missions)
      .where(and(eq(schema.missions.orgId, org.id), inArray(schema.missions.status, ["RUNNING", "REVIEW", "PAUSED"])))
      .orderBy(desc(schema.missions.priority), desc(schema.missions.createdAt)),
    db
      .select({ n: count() })
      .from(schema.approvalRequests)
      .where(and(eq(schema.approvalRequests.orgId, org.id), eq(schema.approvalRequests.status, "PENDING"))),
    spentToday(db, org.id),
    collectBriefing(org.id, since),
    loadOffice(org),
    costStats(db, org.id, statsRange("7d")),
  ]);
  const team = agents.filter((a) => a.isActive).sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
  const working = team.filter((a) => a.status === "WORKING").length;
  const ratio = org.budgetDaily > 0 ? today / org.budgetDaily : 1;
  const level = levelFor(ratio);
  const taskRows = active.length
    ? await db
        .select({ missionId: schema.tasks.missionId, status: schema.tasks.status, assigneeId: schema.tasks.assigneeId })
        .from(schema.tasks)
        .where(
          inArray(
            schema.tasks.missionId,
            active.map((m) => m.id),
          ),
        )
    : [];
  const agentById = new Map(agents.map((a) => [a.id, a]));

  const stats = [
    { label: "활동 중 에이전트", value: `${working}/${team.length}`, href: "/agents" },
    { label: "진행 미션", value: String(active.length), href: "/missions" },
    { label: "승인 대기", value: String(pending?.n ?? 0), href: "/approvals", alert: (pending?.n ?? 0) > 0 },
    { label: "오늘 지출", value: `${won.format(today)}원`, sub: `한도의 ${Math.round(ratio * 100)}%`, href: "/missions", alert: level !== "OK" },
  ];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <h1 className="text-xl font-bold">대시보드</h1>

      {office.agents.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="사무실">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">🏢 사무실</h2>
            <Link href="/office" className="text-sm underline">
              크게 보기
            </Link>
          </div>
          <Office agents={office.agents} deskCount={office.deskCount} theme={org.officeTheme} />
        </section>
      )}

      <section className="grid grid-cols-2 gap-3" aria-label="요약">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className={`${card} flex flex-col gap-1 ${s.alert ? "border-red-500/60" : ""}`}>
            <span className="text-xs opacity-70">{s.label}</span>
            <span className={`text-2xl font-bold tabular-nums ${s.alert ? "text-red-600 dark:text-red-400" : ""}`}>{s.value}</span>
            {s.sub && <span className="text-xs opacity-70">{s.sub}</span>}
          </Link>
        ))}
      </section>

      <Link href="/stats" className={`${card} flex flex-col gap-2 hover:bg-black/5 dark:hover:bg-white/5`} aria-label="최근 7일 비용 — 통계 보기">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-semibold">📊 최근 7일 비용</h2>
          <span className="text-sm tabular-nums">
            {won.format(week.totalKrw)}원 <span className="opacity-60">· 통계 ›</span>
          </span>
        </div>
        <DailyBars data={week.byDay} height={64} compact />
      </Link>

      {briefing.lines.length > 0 && (
        <section className={`${card} flex flex-col gap-2 border-blue-500/40`} aria-label="출근 브리핑">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">☀️ 출근 브리핑</h2>
            <span className="text-xs opacity-60">{timeFmt.format(since)} 이후</span>
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {briefing.lines.map((l) => (
              <li key={l.text}>
                {l.href ? (
                  <Link href={l.href} className="underline-offset-2 hover:underline">
                    {l.text}
                  </Link>
                ) : (
                  l.text
                )}
              </li>
            ))}
            {level !== "OK" && <li className="font-semibold text-red-600 dark:text-red-400">⚠️ 오늘 예산의 {Math.round(ratio * 100)}%를 썼습니다{level === "ECONOMY" ? " — 절약 모델로 전환 중" : level === "STOP" ? " — 한도 도달, 호출 중단" : ""}</li>}
          </ul>
          <form action={dismissBriefing}>
            <button type="submit" className={`${buttonGhost} w-full`}>
              확인했어요
            </button>
          </form>
        </section>
      )}

      <section className="flex flex-col gap-2" aria-label="진행 중 미션">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">진행 중 미션</h2>
          <Link href="/missions/new" className="text-sm underline">
            + 새 미션
          </Link>
        </div>
        {active.length === 0 && <p className="text-sm opacity-70">진행 중인 미션이 없습니다.</p>}
        {active.map((m) => {
          const ts = taskRows.filter((t) => t.missionId === m.id);
          const pct = progress(ts);
          const people = [...new Set(ts.map((t) => t.assigneeId).filter((x): x is string => Boolean(x)))];
          const st = MISSION_STATUS[m.status];
          return (
            <Link key={m.id} href={`/missions/${m.id}`} className={`${card} flex flex-col gap-2 hover:bg-black/5 dark:hover:bg-white/5`}>
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 font-semibold">{m.title}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${st.className}`}>{st.label}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/15" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-blue-600" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex items-center gap-1">
                {people.map((id) => (
                  <AgentAvatar key={id} avatar={agentById.get(id)?.avatar as Avatar | null} size={24} label={agentById.get(id)?.name} />
                ))}
                <span className="ml-auto text-xs opacity-70">{pct}%</span>
              </div>
            </Link>
          );
        })}
      </section>

      <section className="flex flex-col gap-2" aria-label="에이전트 상태">
        <h2 className="font-semibold">에이전트</h2>
        {team.length === 0 && (
          <p className="text-sm opacity-70">
            아직 에이전트가 없습니다.{" "}
            <Link href="/agents" className="underline">
              첫 조직 4명 채용하기
            </Link>
          </p>
        )}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {team.map((a) => {
            const badge = statusBadge(a, isRestTime(org));
            return (
              <li key={a.id} className={`${card} flex flex-col items-center gap-2 p-3 text-center`}>
                <AgentAvatar avatar={a.avatar as Avatar | null} size={52} label={a.name} level={a.level} />
                <div>
                  <p className="font-semibold">
                    {a.name} <span className="text-xs font-normal opacity-60">
                      Lv.{a.level} {RANK_LABEL[a.rank]}
                    </span>
                  </p>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
                </div>
                <div className="grid w-full grid-cols-3 gap-1">
                  <Link href={`/agents/${a.id}#directive`} className="flex h-11 items-center justify-center rounded-lg bg-black/5 text-xs font-semibold dark:bg-white/10">
                    지시
                  </Link>
                  <form action={togglePause}>
                    <input type="hidden" name="id" value={a.id} />
                    <button type="submit" className="h-11 w-full rounded-lg bg-black/5 text-xs font-semibold dark:bg-white/10">
                      {a.status === "PAUSED" ? "재개" : "멈춤"}
                    </button>
                  </form>
                  <Link href={`/agents/${a.id}#profile`} className="flex h-11 items-center justify-center rounded-lg bg-black/5 text-xs font-semibold dark:bg-white/10">
                    설정
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}

/** F016 출근 브리핑: 마지막으로 닫은 뒤 일어난 일 요약 (없으면 빈 목록 → 카드를 숨긴다) */
async function collectBriefing(orgId: string, since: Date): Promise<{ lines: { text: string; href?: string }[] }> {
  const db = getDb();
  const [done, tasksDone, reports, blocked, waiting] = await Promise.all([
    db
      .select({ id: schema.missions.id, title: schema.missions.title })
      .from(schema.auditLogs)
      .innerJoin(schema.missions, eq(sql`${schema.missions.id}::text`, schema.auditLogs.targetId))
      .where(and(eq(schema.auditLogs.orgId, orgId), eq(schema.auditLogs.action, "mission.complete"), gte(schema.auditLogs.createdAt, since))),
    db
      .select({ n: count() })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.orgId, orgId), inArray(schema.auditLogs.action, ["task.review_pass"]), gte(schema.auditLogs.createdAt, since))),
    db
      .select({ n: count() })
      .from(schema.messages)
      .where(and(eq(schema.messages.orgId, orgId), eq(schema.messages.type, "REPORT"), isNull(schema.messages.receiverAgentId), gte(schema.messages.createdAt, since))),
    db
      .select({ id: schema.agents.id, name: schema.agents.name })
      .from(schema.agents)
      .where(and(eq(schema.agents.orgId, orgId), eq(schema.agents.status, "BLOCKED"), eq(schema.agents.isActive, true))),
    db
      .select({ n: count() })
      .from(schema.approvalRequests)
      .where(and(eq(schema.approvalRequests.orgId, orgId), eq(schema.approvalRequests.status, "PENDING"), gte(schema.approvalRequests.createdAt, since))),
  ]);
  const lines: { text: string; href?: string }[] = [];
  for (const m of done) lines.push({ text: `🏁 미션 완료: ${m.title}`, href: `/missions/${m.id}` });
  if (tasksDone[0]?.n) lines.push({ text: `✅ 끝난 Task ${tasksDone[0].n}개` });
  if (reports[0]?.n) lines.push({ text: `📨 나에게 온 보고 ${reports[0].n}개`, href: "/missions" });
  for (const a of blocked) lines.push({ text: `⛔ ${a.name}이(가) 막혀 있습니다`, href: `/agents/${a.id}` });
  if (waiting[0]?.n) lines.push({ text: `✋ 새 승인 요청 ${waiting[0].n}건이 기다립니다`, href: "/approvals" });
  return { lines };
}
