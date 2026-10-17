import { getDb, schema } from "@agentorg/shared/db";
import { desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { MISSION_STATUS, progress } from "@/lib/missions";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { button, card } from "@/lib/ui";

export const dynamic = "force-dynamic";

// F006·F010 미션 목록 (진행 중 먼저)
export default async function MissionsPage() {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <p className="text-sm">
          먼저{" "}
          <Link href="/settings" className="underline">
            설정
          </Link>
          에서 조직을 만들어 주세요.
        </p>
      </main>
    );
  }
  const db = getDb();
  const list = await db.select().from(schema.missions).where(eq(schema.missions.orgId, org.id)).orderBy(desc(schema.missions.createdAt)).limit(50);
  const allTasks = list.length
    ? await db
        .select({ missionId: schema.tasks.missionId, status: schema.tasks.status })
        .from(schema.tasks)
        .where(
          inArray(
            schema.tasks.missionId,
            list.map((m) => m.id),
          ),
        )
    : [];
  const ACTIVE = ["RUNNING", "PAUSED", "REVIEW"];
  const sorted = [...list].sort((a, b) => Number(ACTIVE.includes(b.status)) - Number(ACTIVE.includes(a.status)));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">미션</h1>
        <Link href="/missions/new" className={`${button} flex items-center`}>
          + 새 미션
        </Link>
      </div>
      {list.length === 0 && <p className="text-sm opacity-70">아직 미션이 없습니다. 주제 하나만 적으면 리더가 팀원에게 나눠 맡깁니다.</p>}
      <ul className="flex flex-col gap-3">
        {sorted.map((m) => {
          const tasks = allTasks.filter((t) => t.missionId === m.id);
          const pct = progress(tasks);
          const st = MISSION_STATUS[m.status];
          return (
            <li key={m.id}>
              <Link href={`/missions/${m.id}`} className={`${card} flex flex-col gap-2 hover:bg-black/5 dark:hover:bg-white/5`}>
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 font-semibold">{m.title}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${st.className}`}>{st.label}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/15" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-blue-600" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-xs opacity-70">
                  Task {tasks.filter((t) => t.status === "DONE").length}/{tasks.length} · {pct}%
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
