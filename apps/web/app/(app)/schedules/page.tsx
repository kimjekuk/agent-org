import { getDb, schema } from "@agentorg/shared/db";
import type { Autonomy } from "@agentorg/shared/missions";
import { describeSchedule, parseWorkHours } from "@agentorg/shared/schedule";
import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { buttonGhost, card } from "@/lib/ui";
import { deleteSchedule, toggleSchedule } from "./actions";
import { RunNowForm, ScheduleForm, WorkHoursForm } from "./forms";

export const dynamic = "force-dynamic";

const timeFmt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul" });

// F106 예약: 반복 미션 · 예약 지시 · 근무 시간
export default async function SchedulesPage() {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) return <main className="mx-auto max-w-3xl p-4 text-sm">먼저 설정에서 조직을 만들어 주세요.</main>;
  const db = getDb();
  const [list, agents] = await Promise.all([
    db.select().from(schema.schedules).where(eq(schema.schedules.orgId, org.id)).orderBy(desc(schema.schedules.enabled), asc(schema.schedules.nextRunAt)),
    db
      .select({ id: schema.agents.id, name: schema.agents.name })
      .from(schema.agents)
      .where(and(eq(schema.agents.orgId, org.id), eq(schema.agents.isActive, true)))
      .orderBy(asc(schema.agents.createdAt)),
  ]);
  const wh = parseWorkHours(org.workHours);
  const raw = (org.workHours ?? {}) as { days?: number[]; start?: string; end?: string };

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <h1 className="text-xl font-bold">예약</h1>
      <p className="text-sm opacity-70">정해 둔 시각에 미션을 새로 시작하거나 에이전트에게 지시합니다. 이전 회차 미션이 아직 진행 중이면 그 회차는 건너뛰고 알려 드립니다.</p>

      {list.length === 0 && <p className="text-sm opacity-70">아직 예약이 없습니다.</p>}
      <ul className="flex flex-col gap-3">
        {list.map((s) => (
          <li key={s.id} className={`${card} flex flex-col gap-2 ${s.enabled ? "" : "opacity-60"}`}>
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1 font-semibold">
                {s.kind === "MISSION" ? "🎯 " : "✍️ "}
                {s.title}
              </span>
              <span className="shrink-0 rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold dark:bg-white/15">{s.enabled ? "켜짐" : "꺼짐"}</span>
            </div>
            <p className="text-sm">⏰ {describeSchedule(s)}</p>
            <p className="text-xs opacity-70">
              {s.enabled && s.nextRunAt ? `다음: ${timeFmt.format(s.nextRunAt)}` : "다음 실행 없음"}
              {s.lastRunAt ? ` · 마지막: ${timeFmt.format(s.lastRunAt)} ${s.lastResult ?? ""}` : ""}
            </p>
            {s.lastMissionId && (
              <Link href={`/missions/${s.lastMissionId}`} className="text-xs underline">
                마지막 회차 미션 보기
              </Link>
            )}
            <div className="grid grid-cols-2 gap-2">
              <RunNowForm id={s.id} />
              <form action={toggleSchedule}>
                <input type="hidden" name="id" value={s.id} />
                <button type="submit" className={`${buttonGhost} w-full`}>
                  {s.enabled ? "⏸ 끄기" : "▶ 켜기"}
                </button>
              </form>
            </div>
            <details>
              <summary className="cursor-pointer py-1 text-sm text-red-600 dark:text-red-400">예약 삭제</summary>
              <form action={deleteSchedule} className="pt-1">
                <input type="hidden" name="id" value={s.id} />
                <button type="submit" className="h-11 w-full rounded-lg bg-red-600 text-sm font-semibold text-white">
                  정말 삭제 (이미 만든 미션은 남습니다)
                </button>
              </form>
            </details>
          </li>
        ))}
      </ul>

      <details className={card} open={list.length === 0}>
        <summary className="cursor-pointer font-semibold">+ 새 예약</summary>
        <div className="mt-3">
          <ScheduleForm agents={agents} defaultAutonomy={org.autonomyDefault as Autonomy} />
        </div>
      </details>

      <details className={card}>
        <summary className="cursor-pointer font-semibold">🕘 근무 시간 {wh ? `— ${wh.start}~${wh.end}` : "— 제한 없음"}</summary>
        <div className="mt-3">
          <WorkHoursForm value={{ enabled: Boolean(wh), days: raw.days ?? [1, 2, 3, 4, 5], start: raw.start ?? "09:00", end: raw.end ?? "18:00" }} />
        </div>
      </details>
    </main>
  );
}
