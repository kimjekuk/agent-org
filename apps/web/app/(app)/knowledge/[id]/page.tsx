import { getDb, schema } from "@agentorg/shared/db";
import { dateFormat } from "@agentorg/shared/i18n";
import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getT } from "@/lib/i18n";
import { SOURCE_LABEL } from "@/lib/knowledge";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { buttonDanger, card } from "@/lib/ui";
import { deleteDoc } from "../actions";
import { DocForm } from "../forms";

export const dynamic = "force-dynamic";

// F105 지식 문서: 보기 · 고치기 · 지우기
export default async function KnowledgeDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const tr = await getT();
  const timeFmt = dateFormat(await getLocale(), { dateStyle: "short", timeStyle: "short" });
  const [doc] = await getDb()
    .select()
    .from(schema.knowledgeDocs)
    .where(and(eq(schema.knowledgeDocs.id, id), eq(schema.knowledgeDocs.orgId, org.id)));
  if (!doc) notFound();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <Link href="/knowledge" className="text-sm opacity-70">
        ← {tr("지식 베이스")}
      </Link>
      <div>
        <h1 className="text-xl font-bold">{doc.title}</h1>
        <p className="text-sm opacity-70">
          {[SOURCE_LABEL[doc.source] ? tr(SOURCE_LABEL[doc.source]) : undefined, tr("고친 때 {time}", { time: timeFmt.format(doc.updatedAt) }), ...doc.tags.map((t) => `#${t}`)].join(" · ")}
        </p>
        {doc.artifactId && (
          <Link href={`/artifacts/${doc.artifactId}`} className="text-sm underline">
            {tr("원본 산출물")}
          </Link>
        )}
      </div>
      <article className={`${card} whitespace-pre-wrap break-words text-sm leading-relaxed`}>{doc.content}</article>
      <details className={card}>
        <summary className="cursor-pointer font-semibold">{tr("고치기")}</summary>
        <div className="mt-3">
          <DocForm doc={{ id: doc.id, title: doc.title, content: doc.content, tags: doc.tags }} />
        </div>
      </details>
      <details>
        <summary className="cursor-pointer py-2 text-sm text-red-600 dark:text-red-400">{tr("문서 지우기")}</summary>
        <form action={deleteDoc} className="flex flex-col gap-2 pt-1">
          <input type="hidden" name="id" value={doc.id} />
          <p className="text-sm opacity-80">{tr("에이전트가 더 이상 이 문서를 참고하지 않습니다. 되돌릴 수 없습니다.")}</p>
          <button type="submit" className={buttonDanger}>
            {tr("정말 지우기")}
          </button>
        </form>
      </details>
    </main>
  );
}
