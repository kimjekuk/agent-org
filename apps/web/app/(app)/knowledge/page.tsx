import { getDb, schema } from "@agentorg/shared/db";
import { searchKnowledge } from "@agentorg/shared/knowledge";
import { dateFormat } from "@agentorg/shared/i18n";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getT } from "@/lib/i18n";
import { SOURCE_LABEL } from "@/lib/knowledge";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { button, buttonGhost, card, input } from "@/lib/ui";

export const dynamic = "force-dynamic";

// F105 조직 지식 베이스: 검색 · 목록 · 새 문서
export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) redirect("/settings");
  const tr = await getT();
  const dateFmt = dateFormat(await getLocale(), { dateStyle: "short" });
  const q = ((await searchParams).q ?? "").trim().slice(0, 200);
  const docs = q
    ? (await searchKnowledge(getDb(), org.id, q, 50)).map((h) => ({ ...h, source: "", updatedAt: null as Date | null }))
    : await getDb()
        .select({ id: schema.knowledgeDocs.id, title: schema.knowledgeDocs.title, content: schema.knowledgeDocs.content, tags: schema.knowledgeDocs.tags, source: schema.knowledgeDocs.source, updatedAt: schema.knowledgeDocs.updatedAt })
        .from(schema.knowledgeDocs)
        .where(eq(schema.knowledgeDocs.orgId, org.id))
        .orderBy(desc(schema.knowledgeDocs.updatedAt))
        .limit(100);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <header className="flex items-center justify-between gap-2 pt-2">
        <h1 className="text-xl font-bold">{tr("지식 베이스")}</h1>
        <Link href="/knowledge/new" className={`${button} flex items-center`}>
          + {tr("새 문서")}
        </Link>
      </header>
      <p className="text-sm opacity-70">{tr("완료된 미션의 최종 결과와 4~5점을 준 산출물이 자동으로 쌓입니다. 에이전트는 일을 시작할 때 관련 문서를 찾아 참고합니다.")}</p>
      <form className="flex gap-2" role="search">
        <input name="q" defaultValue={q} placeholder={tr("검색 (예: 숏폼 트렌드)")} className={input} aria-label={tr("검색어")} />
        <button type="submit" className={`${buttonGhost} shrink-0`}>
          {tr("검색")}
        </button>
      </form>
      {docs.length === 0 && <p className="text-sm opacity-70">{q ? tr("찾은 문서가 없습니다.") : tr("아직 문서가 없습니다. 미션을 끝내거나 산출물에 4점 이상을 주면 쌓입니다.")}</p>}
      <ul className="flex flex-col gap-2">
        {docs.map((d) => (
          <li key={d.id}>
            <Link href={`/knowledge/${d.id}`} className={`${card} flex flex-col gap-1`}>
              <span className="font-semibold">{d.title}</span>
              <span className="line-clamp-2 text-sm opacity-70">{d.content.replace(/^#+\s.*$/gm, "").replace(/\s+/g, " ").trim().slice(0, 160)}</span>
              <span className="text-xs opacity-60">
                {[SOURCE_LABEL[d.source] ? tr(SOURCE_LABEL[d.source]) : "", d.updatedAt ? dateFmt.format(d.updatedAt) : "", ...(d.tags ?? []).map((t) => `#${t}`)].filter(Boolean).join(" · ")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
