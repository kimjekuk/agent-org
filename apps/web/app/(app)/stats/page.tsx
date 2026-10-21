import { getDb } from "@agentorg/shared/db";
import { INTL_LOCALE, type T } from "@agentorg/shared/i18n";
import { bottleneckStats, costStats, missionSummaries, productivityStats, STATS_PERIODS, statsRange } from "@agentorg/shared/stats";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DailyBars, RankBars } from "@/components/Charts";
import { getLocale, getT } from "@/lib/i18n";
import { MISSION_STATUS } from "@/lib/missions";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { card } from "@/lib/ui";

export const dynamic = "force-dynamic";

const pct = (v: number | null) => (v == null ? "-" : `${Math.round(v * 100)}%`);

/** shared formatMinutes와 같은 규칙, 화면 언어로 */
function formatMinutes(t: T, min: number | null | undefined): string {
  if (min == null || Number.isNaN(min)) return "-";
  const m = Math.max(0, Math.round(min));
  if (m < 60) return t("{m}분", { m });
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? t("{h}시간 {m}분", { h, m: m % 60 }) : t("{h}시간", { h });
  return h % 24 ? t("{d}일 {h}시간", { d: Math.floor(h / 24), h: h % 24 }) : t("{d}일", { d: Math.floor(h / 24) });
}

// F203 통계: 기간(오늘·7일·30일) 버튼 → 비용 · 생산성 · 병목 · 미션 요약
export default async function StatsPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) notFound();
  const t = await getT();
  const locale = await getLocale();
  const num = new Intl.NumberFormat(INTL_LOCALE[locale], { maximumFractionDigits: 1 });
  const won = (n: number) => t("{n}원", { n: num.format(n) });
  const mins = (n: number | null | undefined) => formatMinutes(t, n);
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
    { label: t("지출"), value: won(cost.totalKrw), sub: t("AI 호출 {n}번", { n: cost.calls }) },
    { label: t("끝낸 Task"), value: String(done), sub: t("검토 통과율 {pct}", { pct: pct(done + rejects ? done / (done + rejects) : null) }) },
    { label: t("Task당 비용"), value: done ? won(cost.totalKrw / done) : "-", sub: t("지출 ÷ 끝낸 Task") },
    { label: t("승인 대기"), value: slow.pending ? t("{n}건", { n: slow.pending }) : t("없음"), sub: slow.pending ? t("가장 오래 {time}", { time: mins(slow.pendingOldestMin) }) : t("평균 결정 {time}", { time: mins(slow.approvalAvgMin) }) },
  ];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <h1 className="text-xl font-bold">📊 {t("통계")}</h1>
      <nav className="grid grid-cols-3 gap-2" aria-label={t("기간")}>
        {STATS_PERIODS.map((p) => (
          <Link
            key={p.key}
            href={`/stats?p=${p.key}`}
            aria-current={range.period === p.key ? "page" : undefined}
            className={`flex h-11 items-center justify-center rounded-lg text-sm font-semibold ${range.period === p.key ? "bg-foreground text-background" : "bg-black/5 dark:bg-white/10"}`}
          >
            {t(p.label)}
          </Link>
        ))}
      </nav>

      <section className="grid grid-cols-2 gap-3" aria-label={t("요약")}>
        {tiles.map((x) => (
          <div key={x.label} className={`${card} flex flex-col gap-1`}>
            <span className="text-xs opacity-70">{x.label}</span>
            <span className="text-2xl font-bold tabular-nums">{x.value}</span>
            <span className="text-xs opacity-70">{x.sub}</span>
          </div>
        ))}
      </section>

      <section className={`${card} flex flex-col gap-3`} aria-label={t("비용")}>
        <h2 className="font-semibold">💰 {t("비용")}</h2>
        {range.days.length > 1 && <DailyBars data={cost.byDay} />}
        <h3 className="text-sm font-semibold opacity-80">{t("에이전트별")}</h3>
        <RankBars rows={cost.byAgent.map((r) => ({ key: r.key, label: r.key === "system" ? t("시스템") : r.label, value: r.krw, note: t("{n}번", { n: r.calls }) }))} />
        <h3 className="text-sm font-semibold opacity-80">{t("모델별")}</h3>
        <RankBars rows={cost.byModel.map((r) => ({ key: r.key, label: r.label, value: r.krw, note: t("{n}번", { n: r.calls }) }))} />
      </section>

      <section className={`${card} flex flex-col gap-2`} aria-label={t("생산성")}>
        <h2 className="font-semibold">🏃 {t("생산성")}</h2>
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs opacity-70">
              <tr className="text-left">
                <th className="px-1 py-1 font-normal">{t("에이전트")}</th>
                <th className="px-1 py-1 text-right font-normal">{t("끝낸 일")}</th>
                <th className="px-1 py-1 text-right font-normal">{t("통과율")}</th>
                <th className="px-1 py-1 text-right font-normal">{t("실패")}</th>
                <th className="px-1 py-1 text-right font-normal">{t("별점")}</th>
                <th className="px-1 py-1 text-right font-normal">{t("건당")}</th>
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
                  <td className="px-1 py-2 text-right">{p.costPerTask == null ? "-" : won(p.costPerTask)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs opacity-60">{t("끝낸 일 = 검토를 통과한 Task · 통과율 = 통과 ÷ (통과 + 반려) · 건당 = 그 에이전트 지출 ÷ 끝낸 일")}</p>
      </section>

      <section className={`${card} flex flex-col gap-2`} aria-label={t("병목")}>
        <h2 className="font-semibold">🚧 {t("병목")}</h2>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="opacity-60">{t("승인 결정까지 평균")}</dt>
          <dd>{mins(slow.approvalAvgMin)}</dd>
          <dt className="opacity-60">{t("가장 오래 걸린 결정")}</dt>
          <dd>{mins(slow.approvalMaxMin)}</dd>
          <dt className="opacity-60">{t("지금 기다리는 승인")}</dt>
          <dd>
            {slow.pending ? (
              <Link href="/approvals" className="font-semibold text-red-600 underline dark:text-red-400">
                {t("{n}건 · 최장 {time}", { n: slow.pending, time: mins(slow.pendingOldestMin) })}
              </Link>
            ) : (
              t("없음")
            )}
          </dd>
        </dl>
        <h3 className="mt-1 text-sm font-semibold opacity-80">{t("오래 걸린 Task (지시 → 검토 통과)")}</h3>
        {slow.slowTasks.length === 0 ? (
          <p className="text-sm opacity-60">{t("기록이 없습니다.")}</p>
        ) : (
          <ol className="flex flex-col gap-1 text-sm">
            {slow.slowTasks.map((x) => (
              <li key={x.taskId} className="flex items-baseline gap-2">
                <Link href={`/missions/${x.missionId}`} className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
                  {x.title} <span className="opacity-60">· {x.missionTitle}{x.assignee ? ` · ${x.assignee}` : ""}</span>
                </Link>
                <span className="shrink-0 tabular-nums font-semibold">{mins(x.minutes)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className={`${card} flex flex-col gap-2`} aria-label={t("미션 요약")}>
        <h2 className="font-semibold">🎯 {t("미션")}</h2>
        {missions.length === 0 && <p className="text-sm opacity-60">{t("이 기간에 만든 미션이 없습니다.")}</p>}
        <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/15">
          {missions.map((m) => {
            const st = MISSION_STATUS[m.status as keyof typeof MISSION_STATUS];
            return (
              <li key={m.id} className="py-2">
                <Link href={`/missions/${m.id}`} className="flex flex-col gap-1">
                  <span className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 font-semibold">{m.title}</span>
                    {st && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${st.className}`}>{t(st.label)}</span>}
                  </span>
                  <span className="text-xs tabular-nums opacity-70">
                    {mins(m.minutes)} · {won(m.costKrw)} · {t("호출 {n}번", { n: m.calls })} · {t("Task {n}개", { n: m.tasks })}{m.rating ? ` · ★${m.rating}` : ""}
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
