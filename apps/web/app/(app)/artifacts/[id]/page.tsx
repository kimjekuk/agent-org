import { getDb, schema } from "@agentorg/shared/db";
import { isFinalResult, listExportChannels } from "@agentorg/shared/export";
import { artifactSourceKey } from "@agentorg/shared/knowledge";
import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { artifactVersions } from "@/lib/artifacts";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { buttonGhost, card } from "@/lib/ui";
import { addArtifact } from "../../knowledge/actions";
import { rateArtifact, revertArtifact } from "../actions";
import { ExportForm } from "./ExportForm";

export const dynamic = "force-dynamic";

const timeFmt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul" });

// F011 산출물 상세: 내용 · 평가(1~5) · 버전 목록 · 되돌리기
export default async function ArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const [art] = await db
    .select()
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.id, id), eq(schema.artifacts.orgId, org.id)));
  if (!art) notFound();
  const [versions, [agent], [mission], [wiki]] = await Promise.all([
    artifactVersions(org.id, art),
    art.agentId ? db.select({ name: schema.agents.name }).from(schema.agents).where(eq(schema.agents.id, art.agentId)) : [],
    art.missionId ? db.select({ id: schema.missions.id, title: schema.missions.title }).from(schema.missions).where(eq(schema.missions.id, art.missionId)) : [],
    db
      .select({ id: schema.knowledgeDocs.id, artifactId: schema.knowledgeDocs.artifactId })
      .from(schema.knowledgeDocs)
      .where(and(eq(schema.knowledgeDocs.orgId, org.id), eq(schema.knowledgeDocs.sourceKey, artifactSourceKey(art)))),
  ]);
  const latest = versions[0];
  // F205 미션 최종 결과만 바깥으로 보낼 수 있다
  const channels = isFinalResult(art) ? await listExportChannels(db, org.id) : null;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <Link href="/artifacts" className="text-sm opacity-70">
        ← 산출물
      </Link>
      <div>
        <h1 className="text-xl font-bold">{art.title}</h1>
        <p className="text-sm opacity-70">
          {agent?.name ?? "에이전트"} · v{art.version}
          {latest && latest.id !== art.id ? ` (최신 v${latest.version})` : ""} · {timeFmt.format(art.createdAt)}
        </p>
        {mission && (
          <Link href={`/missions/${mission.id}`} className="text-sm underline">
            미션: {mission.title}
          </Link>
        )}
      </div>

      <form className="flex items-center gap-1" aria-label="평가">
        <input type="hidden" name="id" value={art.id} />
        <span className="mr-1 text-sm font-semibold">평가</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="submit"
            formAction={rateArtifact.bind(null, n)}
            aria-label={`${n}점`}
            className={`size-11 text-2xl ${art.rating && n <= art.rating ? "text-amber-400" : "opacity-30"}`}
          >
            ★
          </button>
        ))}
      </form>

      {wiki?.artifactId === art.id ? (
        <Link href={`/knowledge/${wiki.id}`} className="text-sm underline">
          📚 지식 베이스에 들어 있음
        </Link>
      ) : (
        <form action={addArtifact}>
          <input type="hidden" name="artifactId" value={art.id} />
          <button type="submit" className={`${buttonGhost} w-full`}>
            📚 {wiki ? "이 버전으로 지식 베이스 고치기" : "지식 베이스에 넣기"}
          </button>
        </form>
      )}

      {channels && (
        <details className={card}>
          <summary className="cursor-pointer font-semibold">📤 보내기 (이메일·슬랙)</summary>
          <div className="mt-3">
            {channels.length > 0 ? (
              <ExportForm artifactId={art.id} channels={channels} />
            ) : (
              <p className="text-sm opacity-80">
                아직 연결된 곳이 없습니다.{" "}
                <Link href="/settings#export" className="font-semibold underline">
                  설정 → 내보내기 연결
                </Link>
                에서 이메일이나 슬랙을 먼저 등록해 주세요.
              </p>
            )}
          </div>
        </details>
      )}

      <article className={`${card} whitespace-pre-wrap break-words text-sm leading-relaxed`}>{art.content}</article>

      {versions.length > 1 && (
        <section className="flex flex-col gap-2" aria-label="버전">
          <h2 className="font-semibold">버전 {versions.length}개</h2>
          <ul className="flex flex-col gap-2">
            {versions.map((v) => (
              <li key={v.id} className={`${card} flex items-center gap-2 p-3`}>
                <Link href={`/artifacts/${v.id}`} className="min-w-0 flex-1 text-sm">
                  <b>v{v.version}</b> {v.id === art.id ? "(보는 중)" : ""} <span className="opacity-60">· {timeFmt.format(v.createdAt)}</span>
                </Link>
                {v.id === art.id && latest.id !== art.id && (
                  <form action={revertArtifact}>
                    <input type="hidden" name="id" value={art.id} />
                    <button type="submit" className={buttonGhost}>
                      이 버전으로 되돌리기
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
