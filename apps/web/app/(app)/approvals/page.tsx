import { getDb, schema } from "@agentorg/shared/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { approvalBadge, waitingFor } from "@/lib/approvals";
import { getT } from "@/lib/i18n";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { card } from "@/lib/ui";

export const dynamic = "force-dynamic";

// F012 승인 대기함 목록: 유형 뱃지 · 요청 에이전트 · 요약 · 대기 시간
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const showDone = (await searchParams).done === "1";
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  const tr = await getT();
  if (!org) return <main className="mx-auto max-w-3xl p-4 text-sm">{tr("먼저 설정에서 조직을 만들어 주세요.")}</main>;
  const db = getDb();
  const list = await db
    .select({ req: schema.approvalRequests, agentName: schema.agents.name, missionTitle: schema.missions.title })
    .from(schema.approvalRequests)
    .leftJoin(schema.agents, eq(schema.agents.id, schema.approvalRequests.agentId))
    .leftJoin(schema.missions, eq(schema.missions.id, schema.approvalRequests.missionId))
    .where(
      and(
        eq(schema.approvalRequests.orgId, org.id),
        inArray(schema.approvalRequests.status, showDone ? ["APPROVED", "REJECTED"] : ["PENDING", "HELD"]),
      ),
    )
    .orderBy(desc(schema.approvalRequests.createdAt))
    .limit(100);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <h1 className="text-xl font-bold">{tr("승인 대기함")}</h1>
      <nav className="flex gap-1" aria-label={tr("승인 목록 구분")}>
        {[
          { href: "/approvals", label: tr("대기 · 보류"), on: !showDone },
          { href: "/approvals?done=1", label: tr("처리됨"), on: showDone },
        ].map((t) => (
          <Link key={t.href} href={t.href} className={`flex h-11 flex-1 items-center justify-center rounded-lg text-sm font-semibold ${t.on ? "bg-foreground text-background" : "bg-black/5 dark:bg-white/10"}`}>
            {t.label}
          </Link>
        ))}
      </nav>
      {list.length === 0 && <p className="text-sm opacity-70">{showDone ? tr("처리한 요청이 없습니다.") : tr("기다리는 요청이 없습니다.")}</p>}
      <ul className="flex flex-col gap-3">
        {list.map(({ req, agentName, missionTitle }) => {
          const badge = approvalBadge(req, tr);
          return (
            <li key={req.id}>
              <Link href={`/approvals/${req.id}`} className={`${card} flex flex-col gap-1 hover:bg-black/5 dark:hover:bg-white/5`}>
                <div className="flex items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${badge.className}`}>{badge.label}</span>
                  {req.status === "HELD" && <span className="rounded-full bg-black/10 px-2 py-0.5 font-semibold dark:bg-white/15">{tr("보류")}</span>}
                  {showDone && <span className="opacity-70">{req.status === "APPROVED" ? tr("승인됨") : tr("거절됨")}</span>}
                  <span className="ml-auto opacity-60">{waitingFor(req.createdAt, tr)}</span>
                </div>
                <p className="line-clamp-2 text-sm font-semibold">{req.content.split("\n")[0]}</p>
                <p className="truncate text-xs opacity-70">
                  {agentName ?? tr("시스템")}
                  {missionTitle ? ` · ${missionTitle}` : ""}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
