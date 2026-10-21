import { getDb } from "@agentorg/shared/db";
import { groupByMonth, type HistoryKind, orgHistory } from "@agentorg/shared/history";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const dayFmt = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" });
const KIND: Record<HistoryKind, { label: string; dot: string }> = {
  MISSION: { label: "미션", dot: "bg-blue-500" },
  PEOPLE: { label: "사람", dot: "bg-green-500" },
  FIRST: { label: "처음", dot: "bg-amber-500" },
  COST: { label: "비용", dot: "bg-red-500" },
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

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <h1 className="text-xl font-bold">🗓️ {org.name} 연표</h1>
      <nav className="flex gap-2 overflow-x-auto" aria-label="종류">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "ALL" ? "/history" : `/history?k=${f}`}
            aria-current={kind === f ? "page" : undefined}
            className={`flex h-11 shrink-0 items-center rounded-lg px-4 text-sm font-semibold ${kind === f ? "bg-foreground text-background" : "bg-black/5 dark:bg-white/10"}`}
          >
            {f === "ALL" ? "전체" : KIND[f].label}
          </Link>
        ))}
      </nav>
      {groups.length === 0 && <p className="text-sm opacity-70">아직 기록이 없습니다.</p>}
      {groups.map((g) => (
        <section key={g.month} className="flex flex-col gap-2" aria-label={g.month}>
          <h2 className="sticky top-0 bg-background/95 py-1 font-semibold backdrop-blur">{g.month}</h2>
          <ol className="flex flex-col border-l-2 border-black/10 pl-4 dark:border-white/15">
            {g.entries.map((e, i) => {
              const body = (
                <>
                  <span className={`absolute -left-[1.4rem] top-3 h-3 w-3 rounded-full ${KIND[e.kind].dot}`} aria-hidden />
                  <span className="text-xs tabular-nums opacity-60">
                    {dayFmt.format(e.at)} · {KIND[e.kind].label}
                  </span>
                  <span className="font-semibold">
                    <span aria-hidden>{e.icon}</span> {e.title}
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
