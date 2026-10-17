import { getDb, schema } from "@agentorg/shared/db";
import { desc, eq } from "drizzle-orm";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { card } from "@/lib/ui";

export const dynamic = "force-dynamic";

const timeFmt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Seoul" });
const ACTOR = { USER: "나", AGENT: "에이전트", SYSTEM: "시스템" } as const;
const PAGE = 100;

// F015 감사 로그 — 모든 행동과 판단 근거 (PRD 9장 "투명성: 숨겨진 상태 없음")
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  const page = Math.max(0, Number((await searchParams).page ?? 0) || 0);
  const db = getDb();

  const logs = org
    ? await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.orgId, org.id)).orderBy(desc(schema.auditLogs.createdAt)).limit(PAGE).offset(page * PAGE)
    : [];
  const agentNames = org
    ? new Map((await db.select({ id: schema.agents.id, name: schema.agents.name }).from(schema.agents).where(eq(schema.agents.orgId, org.id))).map((a) => [a.id, a.name]))
    : new Map<string, string>();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3 p-4 pb-12">
      <h1 className="text-xl font-bold">감사 로그</h1>
      <p className="text-sm opacity-70">이 조직에서 일어난 모든 행동과 판단 근거입니다. 최신순 {PAGE}개씩.</p>
      {logs.length === 0 && <p className="text-sm opacity-60">기록이 없습니다.</p>}
      <ul className="flex flex-col gap-2">
        {logs.map((l) => {
          const who = l.actorType === "AGENT" ? (agentNames.get(l.actorId ?? "") ?? "에이전트") : ACTOR[l.actorType];
          return (
            <li key={l.id} className={`${card} flex flex-col gap-1 text-sm`}>
              <div className="flex flex-wrap items-center gap-x-2 text-xs opacity-70">
                <span>{timeFmt.format(l.createdAt)}</span>
                <span className="font-semibold">{who}</span>
                <code className="rounded bg-black/5 px-1 dark:bg-white/10">{l.action}</code>
              </div>
              {l.reasoning && <p className="break-words">{l.reasoning}</p>}
              {l.payload != null && (
                <details>
                  <summary className="cursor-pointer text-xs opacity-60">상세</summary>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-xs opacity-80">{JSON.stringify(l.payload, null, 2)}</pre>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex justify-between">
        {page > 0 ? (
          <a href={`/audit?page=${page - 1}`} className="flex h-11 items-center text-sm underline">
            ← 최신
          </a>
        ) : (
          <span />
        )}
        {logs.length === PAGE && (
          <a href={`/audit?page=${page + 1}`} className="flex h-11 items-center text-sm underline">
            이전 기록 →
          </a>
        )}
      </div>
    </main>
  );
}
