import { getDb } from "@agentorg/shared/db";
import { bottleneckStats, costStats, formatMinutes, missionSummaries, productivityStats, STATS_PERIODS, statsRange } from "@agentorg/shared/stats";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DailyBars, RankBars } from "@/components/Charts";
import { MISSION_STATUS } from "@/lib/missions";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { card } from "@/lib/ui";

export const dynamic = "force-dynamic";

const won = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
const pct = (v: number | null) => (v == null ? "-" : `${Math.round(v * 100)}%`);

// F203 통계: 기간(오늘·7일·30일) 버튼 → 비용 · 생산성 · 병목 · 미션 요약
export default async function StatsPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) notFound();
  const range = statsRange((await searchParams).p);
  const db = getDb();
  const [cost, people, slow, missions] = await Promise.all([
    costStats(db, org.id, range),
    productivityStats(db, org.id, range),
    bottleneckStats(db, org.id, range),
    missionSummaries(db, org.id, range),
  ]);
  const done = people.reduce((s, p) => s + p.tasksDone, 0);
  const rejects = people.reduce((s, p) => s + p.rejects, 0);

  const tiles = [
    { label: "지출", value: `${won.format(cost.totalKrw)}원`, sub: `AI 호출 ${cost.calls}번` },
    { label: "끝낸 Task", value: String(done), sub: `검토 통과율 ${pct(done + rejects ? done / (done + rejects) : null)}` },
    { label: "Task당 비용", value: done ? `${won.format(cost.totalKrw / done)}원` : "-", sub: "지출 ÷ 끝낸 Task" },
    { label: "승인 대기", value: slow.pending ? `${slow.pending}건` : "없음", sub: slow.pending ? `가장 오래 ${formatMinutes(slow.pendingOldestMin)}` : `평균 결정 ${formatMinutes(slow.approvalAvgMin)}` },
  ];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <h1 className="text-xl font-bold">📊 통계</h1>
      <nav className="grid grid-cols-3 gap-2" aria-label="기간">
        {STATS_PERIODS.map((p) => (
          <Link
            key={p.key}
            href={`/stats?p=${p.key}`}
            aria-current={range.period === p.key ? "page" : undefined}
            className={`flex h-11 items-center justify-center rounded-lg text-sm font-semibold ${range.period === p.key ? "bg-foreground text-background" : "bg-black/5 dark:bg-white/10"}`}
          >
            {p.label}
          </Link>
        ))}
      </nav>

      <section className="grid grid-cols-2 gap-3" aria-label="요약">
        {tiles.map((t) => (
          <div key={t.label} className={`${card} flex flex-col gap-1`}>
            <span className="text-xs opacity-70">{t.label}</span>
            <span className="text-2xl font-bold tabular-nums">{t.value}</span>
            <span className="text-xs opacity-70">{t.sub}</span>
          </div>
        ))}
      </section>

      <section className={`${card} flex flex-col gap-3`} aria-label="비용">
        <h2 className="font-semibold">💰 비용</h2>
        {range.days.length > 1 && <DailyBars data={cost.byDay} />}
        <h3 className="text-sm font-semibold opacity-80">에이전트별</h3>
        <RankBars rows={cost.byAgent.map((r) => ({ key: r.key, label: r.label, value: r.krw, note: `${r.calls}번` }))} />
        <h3 className="text-sm font-semibold opacity-80">모델별</h3>
        <RankBars rows={cost.byModel.map((r) => ({ key: r.key, label: r.label, value: r.krw, note: `${r.calls}번` }))} />
      </section>

      <section className={`${card} flex flex-col gap-2`} aria-label="생산성">
        <h2 className="font-semibold">🏃 생산성</h2>
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs opacity-70">
              <tr className="text-left">
                <th className="px-1 py-1 font-normal">에이전트</th>
                <th className="px-1 py-1 text-right font-normal">끝낸 일</th>
                <th className="px-1 py-1 text-right font-normal">통과율</th>
                <th className="px-1 py-1 text-right font-normal">실패</th>
                <th className="px-1 py-1 text-right font-normal">별점</th>
                <th className="px-1 py-1 text-right font-normal">건당</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {people.map((p) => (
                <tr key={p.agentId} className="border-t border-black/10 dark:border-white/15">
                  <td className="px-1 py-2">
                    <Link href={`/agents/${p.agentId}`} className="font-semibold underline-offset-2 hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-1 py-2 text-right">{p.tasksDone}</td>
                  <td className="px-1 py-2 text-right">{pct(p.passRate)}</td>
                  <td className={`px-1 py-2 text-right ${p.failures ? "font-semibold text-red-600 dark:text-red-400" : ""}`}>{p.failures}</td>
                  <td className="px-1 py-2 text-right">{p.avgRating == null ? "-" : `★${p.avgRating.toFixed(1)}`}</td>
                  <td className="px-1 py-2 text-right">{p.costPerTask == null ? "-" : `${won.format(p.costPerTask)}원`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs opacity-60">끝낸 일 = 검토를 통과한 Task · 통과율 = 통과 ÷ (통과 + 반려) · 건당 = 그 에이전트 지출 ÷ 끝낸 일</p>
      </section>

      <section className={`${card} flex flex-col gap-2`} aria-label="병목">
        <h2 className="font-semibold">🚧 병목</h2>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="opacity-60">승인 결정까지 평균</dt>
          <dd>{formatMinutes(slow.approvalAvgMin)}</dd>
          <dt className="opacity-60">가장 오래 걸린 결정</dt>
          <dd>{formatMinutes(slow.approvalMaxMin)}</dd>
          <dt className="opacity-60">지금 기다리는 승인</dt>
          <dd>
            {slow.pending ? (
              <Link href="/approvals" className="font-semibold text-red-600 underline dark:text-red-400">
                {slow.pending}건 · 최장 {formatMinutes(slow.pendingOldestMin)}
              </Link>
            ) : (
              "없음"
            )}
          </dd>
        </dl>
        <h3 className="mt-1 text-sm font-semibold opacity-80">오래 걸린 Task (지시 → 검토 통과)</h3>
        {slow.slowTasks.length === 0 ? (
          <p className="text-sm opacity-60">기록이 없습니다.</p>
        ) : (
          <ol className="flex flex-col gap-1 text-sm">
            {slow.slowTasks.map((t) => (
              <li key={t.taskId} className="flex items-baseline gap-2">
                <Link href={`/missions/${t.missionId}`} className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
                  {t.title} <span className="opacity-60">· {t.missionTitle}{t.assignee ? ` · ${t.assignee}` : ""}</span>
                </Link>
                <span className="shrink-0 tabular-nums font-semibold">{formatMinutes(t.minutes)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className={`${card} flex flex-col gap-2`} aria-label="미션 요약">
        <h2 className="font-semibold">🎯 미션</h2>
        {missions.length === 0 && <p className="text-sm opacity-60">이 기간에 만든 미션이 없습니다.</p>}
        <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/15">
          {missions.map((m) => {
            const st = MISSION_STATUS[m.status as keyof typeof MISSION_STATUS];
            return (
              <li key={m.id} className="py-2">
                <Link href={`/missions/${m.id}`} className="flex flex-col gap-1">
                  <span className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 font-semibold">{m.title}</span>
                    {st && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${st.className}`}>{st.label}</span>}
                  </span>
                  <span className="text-xs tabular-nums opacity-70">
                    {formatMinutes(m.minutes)} · {won.format(m.costKrw)}원 · 호출 {m.calls}번 · Task {m.tasks}개{m.rating ? ` · ★${m.rating}` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
