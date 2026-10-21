import { getDb, schema } from "@agentorg/shared/db";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { dateFormat } from "@agentorg/shared/i18n";
import Link from "next/link";
import { getLocale, getT } from "@/lib/i18n";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { card } from "@/lib/ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "all", label: "전체" }, // i18n-ignore (화면에서 tr(label))
  { key: "final", label: "미션 최종" }, // i18n-ignore (화면에서 tr(label))
  { key: "direct", label: "직접 지시" }, // i18n-ignore (화면에서 tr(label))
] as const;

// F011 산출물 보관함 목록 (최신 50개씩, 모바일 데이터 고려)
export default async function ArtifactsPage({ searchParams }: { searchParams: Promise<{ f?: string; page?: string }> }) {
  const sp = await searchParams;
  const f = FILTERS.find((x) => x.key === sp.f)?.key ?? "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  const tr = await getT();
  const timeFmt = dateFormat(await getLocale(), { dateStyle: "short", timeStyle: "short" });
  if (!org) return <main className="mx-auto max-w-3xl p-4 text-sm">{tr("먼저 설정에서 조직을 만들어 주세요.")}</main>;
  const t = schema.artifacts;
  const where =
    f === "final" ? and(eq(t.orgId, org.id), isNotNull(t.missionId), isNull(t.taskId)) : f === "direct" ? and(eq(t.orgId, org.id), isNull(t.missionId)) : eq(t.orgId, org.id);
  const list = await getDb()
    .select({ art: t, agentName: schema.agents.name, missionTitle: schema.missions.title })
    .from(t)
    .leftJoin(schema.agents, eq(schema.agents.id, t.agentId))
    .leftJoin(schema.missions, eq(schema.missions.id, t.missionId))
    .where(where)
    .orderBy(desc(t.createdAt))
    .limit(51)
    .offset((page - 1) * 50);
  const more = list.length > 50;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <h1 className="text-xl font-bold">{tr("산출물")}</h1>
      <nav className="flex gap-1" aria-label={tr("산출물 구분")}>
        {FILTERS.map((x) => (
          <Link key={x.key} href={`/artifacts?f=${x.key}`} className={`flex h-11 flex-1 items-center justify-center rounded-lg text-sm font-semibold ${f === x.key ? "bg-foreground text-background" : "bg-black/5 dark:bg-white/10"}`}>
            {tr(x.label)}
          </Link>
        ))}
      </nav>
      {list.length === 0 && <p className="text-sm opacity-70">{tr("아직 산출물이 없습니다.")}</p>}
      <ul className="flex flex-col gap-2">
        {list.slice(0, 50).map(({ art, agentName, missionTitle }) => (
          <li key={art.id}>
            <Link href={`/artifacts/${art.id}`} className={`${card} flex flex-col gap-1 hover:bg-black/5 dark:hover:bg-white/5`}>
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 font-semibold">
                  {art.missionId && !art.taskId ? "🏁 " : "📄 "}
                  {art.title}
                </span>
                {art.version > 1 && <span className="shrink-0 rounded bg-black/5 px-1.5 text-xs dark:bg-white/10">v{art.version}</span>}
              </div>
              <p className="truncate text-xs opacity-70">
                {agentName ?? tr("에이전트")} · {missionTitle ?? tr("직접 지시")} · {timeFmt.format(art.createdAt)}
                {art.rating ? ` · ${"★".repeat(art.rating)}` : ""}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      {(page > 1 || more) && (
        <div className="flex gap-2">
          {page > 1 && (
            <Link href={`/artifacts?f=${f}&page=${page - 1}`} className="flex h-11 flex-1 items-center justify-center rounded-lg bg-black/5 text-sm font-semibold dark:bg-white/10">
              ← {tr("이전")}
            </Link>
          )}
          {more && (
            <Link href={`/artifacts?f=${f}&page=${page + 1}`} className="flex h-11 flex-1 items-center justify-center rounded-lg bg-black/5 text-sm font-semibold dark:bg-white/10">
              {tr("다음")} →
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
