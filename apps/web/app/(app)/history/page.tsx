import { getDb } from "@agentorg/shared/db";
import { dateFormat } from "@agentorg/shared/i18n";
import { groupByMonth, type HistoryKind, orgHistory } from "@agentorg/shared/history";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getT } from "@/lib/i18n";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// 이름표는 화면에서 t(label)로 번역한다
const KIND: Record<HistoryKind, { label: string; dot: string }> = {
  MISSION: { label: "미션", dot: "bg-blue-500" }, // i18n-ignore
  PEOPLE: { label: "사람", dot: "bg-green-500" }, // i18n-ignore
  FIRST: { label: "처음", dot: "bg-amber-500" }, // i18n-ignore
  COST: { label: "비용", dot: "bg-red-500" }, // i18n-ignore
};
const FILTERS: (HistoryKind | "ALL")[] = ["ALL", "MISSION", "PEOPLE", "FIRST", "COST"];

// F204 조직 역사 연표: 미션 완료·사람(입사·퇴사·승진·레벨업)·처음 있는 일·비용 기록을 월별 세로 타임라인으로
export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) notFound();
  const wanted = (await searchParams).k;
  const kind = FILTERS.find((f) => f === wanted) ?? "ALL";
  const all = await orgHistory(getDb(), org.id);
  const groups = groupByMonth(kind === "ALL" ? all : all.filter((e) => e.kind === kind));
  const t = await getT();
  const locale = await getLocale();
  const dayFmt = dateFormat(locale, { month: "numeric", day: "numeric" });
  const monthFmt = dateFormat(locale, { year: "numeric", month: "long" });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <h1 className="text-xl font-bold">🗓️ {t("{name} 연표", { name: org.name })}</h1>
      <nav className="flex gap-2 overflow-x-auto" aria-label={t("종류")}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "ALL" ? "/history" : `/history?k=${f}`}
            aria-current={kind === f ? "page" : undefined}
            className={`flex h-11 shrink-0 items-center rounded-lg px-4 text-sm font-semibold ${kind === f ? "bg-foreground text-background" : "bg-black/5 dark:bg-white/10"}`}
          >
            {f === "ALL" ? t("전체") : t(KIND[f].label)}
          </Link>
        ))}
      </nav>
      {groups.length === 0 && <p className="text-sm opacity-70">{t("아직 기록이 없습니다.")}</p>}
      {groups.map((g) => (
        <section key={g.month} className="flex flex-col gap-2" aria-label={monthFmt.format(g.entries[0].at)}>
          <h2 className="sticky top-0 bg-background/95 py-1 font-semibold backdrop-blur">{monthFmt.format(g.entries[0].at)}</h2>
          <ol className="flex flex-col border-l-2 border-black/10 pl-4 dark:border-white/15">
            {g.entries.map((e, i) => {
              const body = (
                <>
                  <span className={`absolute -left-[1.4rem] top-3 h-3 w-3 rounded-full ${KIND[e.kind].dot}`} aria-hidden />
                  <span className="text-xs tabular-nums opacity-60">
                    {dayFmt.format(e.at)} · {t(KIND[e.kind].label)}
                  </span>
                  <span className="font-semibold">
                    <span aria-hidden>{e.icon}</span> {t(e.title)}
                  </span>
                  {e.detail && <span className="break-words text-sm opacity-70">{e.detail}</span>}
                </>
              );
              return (
                <li key={`${e.at.toISOString()}-${i}`} className="relative py-2">
                  {e.href ? (
                    <Link href={e.href} className="flex flex-col gap-0.5 underline-offset-2 hover:underline">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex flex-col gap-0.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </main>
  );
}
