import type { Avatar } from "@agentorg/shared/agents/templates";
import { getDb, schema } from "@agentorg/shared/db";
import { MEETING_LABEL } from "@agentorg/shared/meetings";
import { dateFormat, INTL_LOCALE, type Locale, numberFormat } from "@agentorg/shared/i18n";
import { AUTONOMY_LABEL, type Autonomy, OUTPUT_FORMATS } from "@agentorg/shared/missions";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentAvatar } from "@/components/AgentAvatar";
import { getLocale, getT } from "@/lib/i18n";
import { MISSION_STATUS, PRIORITY_LABEL, progress, TASK_COLUMNS, getOrgMission } from "@/lib/missions";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { buttonDanger, buttonGhost, card } from "@/lib/ui";
import { cancelMission, moveTask, pauseMission, resumeMission } from "../actions";
import { MeetingReplyForm, MissionSettingsForm, NoteForm } from "../forms";
import { ReplayPlayer } from "@/components/ReplayPlayer";
import { missionReplay } from "@agentorg/shared/replay";

export const dynamic = "force-dynamic";

/** 날짜·금액 표기 (언어별, 시간대는 한국) */
function formats(locale: Locale) {
  return {
    timeFmt: dateFormat(locale, { dateStyle: "short", timeStyle: "short" }),
    dateFmt: dateFormat(locale, { dateStyle: "medium" }),
    won: new Intl.NumberFormat(INTL_LOCALE[locale], { maximumFractionDigits: 1 }),
  };
}
// 이름표는 화면에서 tr(label)로 번역한다
const TYPE_LABEL = { DIRECTIVE: "지시", REPORT: "보고", QUESTION: "질문", PROPOSAL: "제안" } as const; // i18n-ignore
const TABS = [
  { key: "board", label: "보드" }, // i18n-ignore
  { key: "log", label: "대화" }, // i18n-ignore
  { key: "meetings", label: "회의" }, // i18n-ignore
  { key: "replay", label: "리플레이" }, // i18n-ignore
  { key: "artifacts", label: "산출물" }, // i18n-ignore
  { key: "cost", label: "비용" }, // i18n-ignore
] as const;
type Tab = (typeof TABS)[number]["key"];

// F010 미션 상세: 헤더 · 칸반 · 대화 로그 · 산출물 · 비용 (SSE로 자동 갱신)
export default async function MissionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const wanted = (await searchParams).tab;
  const tab: Tab = TABS.find((t) => t.key === wanted)?.key ?? "board";
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) notFound();
  const mission = await getOrgMission(org.id, id);
  if (!mission) notFound();
  const db = getDb();
  const tr = await getT();
  const { timeFmt, dateFmt, won } = formats(await getLocale());

  const [taskList, agentList, [spent], openApprovals, finals, reviewLog] = await Promise.all([
    db.select().from(schema.tasks).where(eq(schema.tasks.missionId, mission.id)).orderBy(asc(schema.tasks.order)),
    db.select().from(schema.agents).where(eq(schema.agents.orgId, org.id)),
    db.select({ total: sql<string>`coalesce(sum(${schema.costLogs.cost}), 0)`, calls: sql<number>`count(*)::int` }).from(schema.costLogs).where(eq(schema.costLogs.missionId, mission.id)),
    db
      .select()
      .from(schema.approvalRequests)
      .where(and(eq(schema.approvalRequests.missionId, mission.id), inArray(schema.approvalRequests.status, ["PENDING", "HELD"])))
      .orderBy(asc(schema.approvalRequests.createdAt)),
    db
      .select()
      .from(schema.artifacts)
      .where(and(eq(schema.artifacts.missionId, mission.id), isNull(schema.artifacts.taskId)))
      .orderBy(desc(schema.artifacts.version))
      .limit(1),
    // F107 Task별 품질 이력: 실패 보고 · 검토 반려/통과
    db
      .select({ taskId: schema.messages.taskId, content: schema.messages.content, payload: schema.messages.payload, createdAt: schema.messages.createdAt })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.missionId, mission.id),
          eq(schema.messages.type, "REPORT"),
          sql`(${schema.messages.payload}->>'failed' = 'true' or ${schema.messages.payload} ? 'review')`,
        ),
      )
      .orderBy(asc(schema.messages.createdAt)),
  ]);
  const historyOf = (taskId: string) => reviewLog.filter((h) => h.taskId === taskId);
  const agentById = new Map(agentList.map((a) => [a.id, a]));
  const leader = mission.leaderId ? agentById.get(mission.leaderId) : undefined;
  const pct = progress(taskList);
  const used = Number(spent?.total ?? 0);
  const st = MISSION_STATUS[mission.status];
  const autonomy = (mission.autonomy ?? org.autonomyDefault) as Autonomy;
  const closed = mission.status === "DONE" || mission.status === "CANCELLED";
  const final = mission.status === "DONE" ? finals[0] : undefined;
  const criteria = (mission.successCriteria ?? []) as string[];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 pt-4">
      <div className="px-4">
        <Link href="/missions" className="text-sm opacity-70">
          ← {tr("미션 목록")}
        </Link>
      </div>

      {/* 헤더: 제목·상태·진행률·예산 + 일시정지·취소·자율성 변경 */}
      <section className="flex flex-col gap-3 px-4">
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 text-xl font-bold">{mission.title}</h1>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${st.className}`}>{tr(st.label)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/15" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-blue-600" style={{ width: `${pct}%` }} />
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="opacity-60">{tr("진행")}</dt>
          <dd>{tr("Task {done}/{total} · {pct}%", { done: taskList.filter((t) => t.status === "DONE").length, total: taskList.length, pct })}</dd>
          <dt className="opacity-60">{tr("예산")}</dt>
          <dd className={used >= mission.budgetLimit * 0.8 ? "font-semibold text-red-600 dark:text-red-400" : ""}>
            {tr("{used} / {limit}원", { used: won.format(used), limit: won.format(mission.budgetLimit) })}
          </dd>
          <dt className="opacity-60">{tr("AI 호출")}</dt>
          <dd className={(spent?.calls ?? 0) >= mission.callLimit ? "font-semibold text-red-600 dark:text-red-400" : ""}>
            {tr("{used} / {limit}회", { used: spent?.calls ?? 0, limit: mission.callLimit })}
          </dd>
          <dt className="opacity-60">{tr("리더 · 자율성")}</dt>
          <dd>
            {leader?.name ?? tr("없음")} · {tr(AUTONOMY_LABEL[autonomy])}
          </dd>
          <dt className="opacity-60">{tr("형식 · 우선순위")}</dt>
          <dd>
            {tr(mission.outputFormat ?? OUTPUT_FORMATS[0])} · {tr(PRIORITY_LABEL[mission.priority] ?? PRIORITY_LABEL[0])}
            {mission.deadline ? ` · ~${dateFmt.format(mission.deadline)}` : ""}
          </dd>
        </dl>
        {!closed && (
          <div className="grid grid-cols-2 gap-2">
            {mission.status === "PAUSED" ? (
              <form action={resumeMission}>
                <input type="hidden" name="id" value={mission.id} />
                <button type="submit" className={`${buttonGhost} w-full`}>
                  ▶ {tr("재개")}
                </button>
              </form>
            ) : (
              <form action={pauseMission}>
                <input type="hidden" name="id" value={mission.id} />
                <button type="submit" className={`${buttonGhost} w-full`} disabled={mission.status !== "RUNNING"}>
                  ⏸ {tr("일시정지")}
                </button>
              </form>
            )}
            <details className="group">
              <summary className={`${buttonGhost} flex w-full cursor-pointer list-none items-center justify-center text-red-600 dark:text-red-400`}>{tr("미션 취소")}</summary>
              <form action={cancelMission} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="id" value={mission.id} />
                <p className="text-xs opacity-80">{tr("남은 지시와 승인 요청이 모두 종료됩니다. 되돌릴 수 없습니다.")}</p>
                <button type="submit" className={buttonDanger}>
                  {tr("정말 취소")}
                </button>
              </form>
            </details>
          </div>
        )}
        {!closed && (
          <details className={card}>
            <summary className="cursor-pointer text-sm font-semibold">{tr("자율성 · 예산 · 회의 변경")}</summary>
            <div className="pt-3">
              <MissionSettingsForm id={mission.id} autonomy={autonomy} budgetLimit={mission.budgetLimit} meetings={mission.meetings} />
            </div>
          </details>
        )}
      </section>

      {openApprovals.length > 0 && (
        <section className="flex flex-col gap-2 px-4" aria-label={tr("승인 요청")}>
          {openApprovals.map((a) => (
            <Link
              key={a.id}
              href={`/approvals/${a.id}`}
              className="flex min-h-11 items-center gap-2 rounded-xl bg-purple-100 px-4 py-3 text-sm font-semibold text-purple-900 dark:bg-purple-900/40 dark:text-purple-100"
            >
              <span aria-hidden>✋</span>
              <span className="min-w-0 flex-1 truncate">{a.status === "HELD" ? tr("보류 중: {text}", { text: a.content.split("\n")[0] }) : tr("승인이 필요합니다: {text}", { text: a.content.split("\n")[0] })}</span>
              <span aria-hidden>›</span>
            </Link>
          ))}
        </section>
      )}

      {final && (
        <section className={`${card} mx-4 border-green-600/40`}>
          <details open>
            <summary className="cursor-pointer font-semibold">🏁 {tr("최종 결과")} — {final.title}</summary>
            <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{final.content}</div>
          </details>
        </section>
      )}

      <nav className="flex gap-1 overflow-x-auto border-b border-black/10 px-2 dark:border-white/15" aria-label={tr("미션 탭")}>
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/missions/${mission.id}?tab=${t.key}`}
            scroll={false}
            className={`flex h-11 flex-1 shrink-0 items-center justify-center whitespace-nowrap px-2 text-sm font-semibold ${tab === t.key ? "border-b-2 border-foreground" : "opacity-60"}`}
          >
            {tr(t.label)}
          </Link>
        ))}
      </nav>

      {tab === "board" && (
        <section className="grid gap-3 px-4 pb-12 sm:grid-cols-2 lg:grid-cols-4" aria-label={tr("칸반")}>
          {taskList.length === 0 && (
            <p className="text-sm opacity-70 sm:col-span-2 lg:col-span-4">
              {closed ? tr("Task가 없습니다.") : tr("리더 {name}이(가) 계획을 세우는 중입니다…", { name: leader?.name ?? "" })}
            </p>
          )}
          {taskList.length > 0 &&
            TASK_COLUMNS.map((col) => {
              const items = taskList.filter((t) => t.status === col.status);
              return (
                <div key={col.status} className="flex flex-col gap-2 rounded-xl bg-black/5 p-2 dark:bg-white/5">
                  <h2 className="px-1 text-sm font-semibold">
                    {tr(col.label)} <span className="opacity-60">{items.length}</span>
                  </h2>
                  {items.map((t) => {
                    const who = t.assigneeId ? agentById.get(t.assigneeId) : undefined;
                    return (
                      <details key={t.id} className="rounded-lg bg-background p-3 shadow-sm">
                        <summary className="flex cursor-pointer list-none items-center gap-2">
                          <AgentAvatar avatar={who?.avatar as Avatar | null} size={28} label={who?.name ?? tr("담당 없음")} />
                          <span className="min-w-0 flex-1 text-sm font-semibold">{t.title}</span>
                          {(t.rejectCount > 0 || t.failCount > 0) && (
                            <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-900/40 dark:text-red-100">
                              {[t.rejectCount ? tr("반려 {n}", { n: t.rejectCount }) : "", t.failCount ? tr("실패 {n}", { n: t.failCount }) : ""].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </summary>
                        <div className="mt-2 flex flex-col gap-2 text-sm">
                          <p className="opacity-70">
                            {tr("담당 {name}", { name: who?.name ?? tr("없음") })}
                            {t.rejectCount ? ` · ${tr("반려 {n}회", { n: t.rejectCount })}` : ""}
                            {t.failCount ? ` · ${tr("실패 {n}회", { n: t.failCount })}` : ""}
                          </p>
                          {t.description && <p className="whitespace-pre-wrap">{t.description}</p>}
                          {historyOf(t.id).length > 0 && (
                            <ol className="flex flex-col gap-1 border-l-2 border-black/10 pl-2 text-xs dark:border-white/15" aria-label={tr("검토·실패 이력")}>
                              {historyOf(t.id).map((h) => {
                                const p = (h.payload ?? {}) as { failed?: boolean; review?: "PASS" | "REJECT" };
                                const icon = p.failed ? "❌" : p.review === "REJECT" ? "↩️" : "✅";
                                return (
                                  <li key={`${h.createdAt.toISOString()}${h.content.slice(0, 8)}`} className="break-words">
                                    {icon} <span className="opacity-60">{timeFmt.format(h.createdAt)}</span> {h.content.length > 160 ? `${h.content.slice(0, 160)}…` : h.content}
                                  </li>
                                );
                              })}
                            </ol>
                          )}
                          {!closed && (
                            <div className="grid grid-cols-2 gap-2">
                              {(["TODO", "DONE"] as const)
                                .filter((to) => to !== t.status)
                                .map((to) => (
                                  <form key={to} action={moveTask}>
                                    <input type="hidden" name="id" value={mission.id} />
                                    <input type="hidden" name="taskId" value={t.id} />
                                    <input type="hidden" name="to" value={to} />
                                    <button type="submit" className={`${buttonGhost} w-full`}>
                                      {to === "TODO" ? `↺ ${tr("다시 하기")}` : `✓ ${tr("완료 처리")}`}
                                    </button>
                                  </form>
                                ))}
                            </div>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              );
            })}
          {(criteria.length > 0 || mission.goal || mission.referenceNotes) && (
            <details className={`${card} sm:col-span-2 lg:col-span-4`}>
              <summary className="cursor-pointer text-sm font-semibold">{tr("미션 내용")}</summary>
              <div className="mt-2 flex flex-col gap-2 text-sm">
                <p>{tr("주제: {text}", { text: mission.topic })}</p>
                {mission.goal && <p>{tr("목표: {text}", { text: mission.goal })}</p>}
                {criteria.length > 0 && (
                  <ul className="list-disc pl-5">
                    {criteria.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
                {mission.referenceNotes && <p className="whitespace-pre-wrap break-words opacity-80">{tr("참고 자료: {text}", { text: mission.referenceNotes })}</p>}
              </div>
            </details>
          )}
        </section>
      )}

      {tab === "log" && <MissionLog missionId={mission.id} agentById={agentById} closed={mission.status === "CANCELLED"} />}
      {tab === "meetings" && <MissionMeetings missionId={mission.id} agentById={agentById} enabled={mission.meetings} cancelled={mission.status === "CANCELLED"} />}
      {tab === "replay" && <MissionReplay orgId={org.id} missionId={mission.id} theme={org.officeTheme} />}
      {tab === "artifacts" && <MissionArtifacts missionId={mission.id} agentById={agentById} taskTitles={new Map(taskList.map((t) => [t.id, t.title]))} />}
      {tab === "cost" && <MissionCost missionId={mission.id} agentById={agentById} used={used} limit={mission.budgetLimit} />}
    </main>
  );
}

type AgentMap = Map<string, typeof schema.agents.$inferSelect>;

/** 에이전트 간 메시지 타임라인 (캐릭터 말풍선) + 사용자 끼어들기 */
async function MissionLog({ missionId, agentById, closed }: { missionId: string; agentById: AgentMap; closed: boolean }) {
  const db = getDb();
  const list = (await db.select().from(schema.messages).where(eq(schema.messages.missionId, missionId)).orderBy(desc(schema.messages.createdAt)).limit(100)).reverse();
  const artIds = list.map((m) => (m.payload as { artifactId?: string } | null)?.artifactId).filter((x): x is string => Boolean(x));
  const arts = artIds.length ? await db.select().from(schema.artifacts).where(inArray(schema.artifacts.id, artIds)) : [];
  const artById = new Map(arts.map((a) => [a.id, a]));
  const tr = await getT();
  const { timeFmt, won } = formats(await getLocale());
  const working = [...agentById.values()].filter((a) => a.status === "WORKING" && list.some((m) => m.receiverAgentId === a.id || m.senderAgentId === a.id));

  return (
    <>
      <section className="flex flex-col gap-3 px-4 pb-4" aria-label={tr("대화 로그")}>
        {list.length === 0 && <p className="text-sm opacity-60">{tr("아직 대화가 없습니다.")}</p>}
        {list.map((m) => {
          const fromUser = m.senderType === "USER";
          const sender = m.senderAgentId ? agentById.get(m.senderAgentId) : undefined;
          const receiver = m.receiverAgentId ? agentById.get(m.receiverAgentId) : undefined;
          const p = (m.payload ?? {}) as { artifactId?: string; costKrw?: number; model?: string; failed?: boolean };
          const art = p.artifactId ? artById.get(p.artifactId) : undefined;
          const to = receiver ? (receiver.id === sender?.id ? "" : ` → ${receiver.name}`) : fromUser ? "" : ` → ${tr("나")}`;
          return (
            <article key={m.id} className={`flex max-w-[92%] items-end gap-2 ${fromUser ? "flex-row-reverse self-end" : "self-start"}`}>
              {!fromUser && <AgentAvatar avatar={sender?.avatar as Avatar | null} size={32} label={sender?.name ?? tr("에이전트")} />}
              <div
                className={`min-w-0 rounded-2xl px-4 py-3 text-sm ${
                  fromUser ? "bg-foreground text-background" : p.failed ? "bg-red-50 dark:bg-red-950/40" : "bg-black/5 dark:bg-white/10"
                }`}
              >
                <p className="mb-1 text-xs opacity-70">
                  {fromUser ? tr("나") : (sender?.name ?? tr("에이전트"))}
                  {to} · {tr(TYPE_LABEL[m.type])} · {timeFmt.format(m.createdAt)}
                </p>
                <details className="group" open={m.content.length <= 280}>
                  <summary className="cursor-pointer list-none group-open:hidden">
                    <span className="whitespace-pre-wrap break-words">{m.content.slice(0, 200)}… </span>
                    <span className="underline">{tr("더 보기")}</span>
                  </summary>
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                </details>
                {art && (
                  <details className="mt-2 rounded-lg bg-background p-3 text-foreground">
                    <summary className="cursor-pointer font-semibold">
                      📄 {art.title}
                      {art.version > 1 ? ` (v${art.version})` : ""}
                    </summary>
                    <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{art.content}</div>
                  </details>
                )}
                {p.costKrw !== undefined && (
                  <p className="mt-1 text-xs opacity-60">
                    {p.model} · {tr("{n}원", { n: won.format(p.costKrw) })}
                  </p>
                )}
              </div>
            </article>
          );
        })}
        {working.map((a) => (
          <p key={a.id} className="self-start text-sm opacity-70">
            ✍️ {tr("{name}이(가) 작업 중입니다…", { name: a.name })}
          </p>
        ))}
      </section>
      <NoteForm id={missionId} disabled={closed} />
    </>
  );
}

/** F104 회의록: 킥오프·회고, 발언 순서대로 + 리더 결론 + 사용자 답글 */
async function MissionMeetings({ missionId, agentById, enabled, cancelled }: { missionId: string; agentById: AgentMap; enabled: boolean; cancelled: boolean }) {
  const db = getDb();
  const list = await db.select().from(schema.meetings).where(eq(schema.meetings.missionId, missionId)).orderBy(asc(schema.meetings.createdAt));
  const turns = list.length
    ? await db
        .select()
        .from(schema.meetingTurns)
        .where(inArray(schema.meetingTurns.meetingId, list.map((m) => m.id)))
        .orderBy(asc(schema.meetingTurns.createdAt))
    : [];
  const tr = await getT();
  const { timeFmt } = formats(await getLocale());
  return (
    <section className="flex flex-col gap-3 px-4 pb-12" aria-label={tr("회의")}>
      {list.length === 0 && (
        <p className="text-sm opacity-70">
          {enabled ? tr("계획을 세우면 담당 팀원들이 킥오프 회의를 하고, 미션이 끝나면 회고 회의를 합니다.") : tr("이 미션은 회의를 하지 않습니다. 위 '자율성 · 예산 · 회의 변경'에서 켤 수 있습니다.")}
        </p>
      )}
      {list.map((m) => {
        const mine = turns.filter((t) => t.meetingId === m.id);
        const names = ((m.participants ?? []) as string[]).map((id) => agentById.get(id)?.name ?? tr("(없음)"));
        return (
          <article key={m.id} className={`${card} flex flex-col gap-3`}>
            <header className="flex items-center gap-2">
              <h2 className="min-w-0 flex-1 font-semibold">
                {m.kind === "KICKOFF" ? "🚀" : "🔁"} {tr(MEETING_LABEL[m.kind])}
              </h2>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${m.status === "RUNNING" ? "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100" : "bg-black/10 dark:bg-white/15"}`}>
                {m.status === "RUNNING" ? tr("진행 중") : tr("끝남")}
              </span>
            </header>
            <p className="text-xs opacity-60">
              {tr("참여 {names}", { names: names.join(" → ") })} · {timeFmt.format(m.createdAt)}
            </p>
            {m.conclusion && (
              <div className="rounded-lg bg-green-50 p-3 text-sm dark:bg-green-950/40">
                <p className="mb-1 text-xs font-semibold opacity-70">{tr("결론")}</p>
                <p className="whitespace-pre-wrap break-words">{m.conclusion}</p>
              </div>
            )}
            <ol className="flex flex-col gap-2">
              {mine
                .filter((t) => !(t.speakerType === "AGENT" && t.content.startsWith("[결론"))) // i18n-ignore (저장된 결론 표시)
                .map((t) => {
                  const fromUser = t.speakerType === "USER";
                  const who = t.agentId ? agentById.get(t.agentId) : undefined;
                  return (
                    <li key={t.id} className={`flex max-w-[92%] items-end gap-2 ${fromUser ? "flex-row-reverse self-end" : "self-start"}`}>
                      {!fromUser && <AgentAvatar avatar={who?.avatar as Avatar | null} size={28} label={who?.name ?? tr("에이전트")} />}
                      <div className={`min-w-0 rounded-2xl px-3 py-2 text-sm ${fromUser ? "bg-foreground text-background" : "bg-black/5 dark:bg-white/10"}`}>
                        <p className="mb-0.5 text-xs opacity-70">
                          {fromUser ? tr("나") : (who?.name ?? tr("에이전트"))} · {timeFmt.format(t.createdAt)}
                        </p>
                        <p className="whitespace-pre-wrap break-words">{t.content}</p>
                      </div>
                    </li>
                  );
                })}
              {m.status === "RUNNING" && <li className="text-sm opacity-70">💬 {tr("다음 차례가 의견을 정리하는 중입니다…")}</li>}
            </ol>
            <MeetingReplyForm missionId={missionId} meetingId={m.id} disabled={cancelled} />
          </article>
        );
      })}
    </section>
  );
}

/** F204 리플레이: 감사 로그로 만든 장면을 사무실 화면에서 재생 */
async function MissionReplay({ orgId, missionId, theme }: { orgId: string; missionId: string; theme: string }) {
  const r = await missionReplay(getDb(), orgId, missionId);
  if (!r) return null;
  const tr = await getT();
  return (
    <section className="flex flex-col gap-2 px-4 pb-12" aria-label={tr("리플레이")}>
      <ReplayPlayer agents={r.agents} frames={r.frames.map((f) => ({ ...f, at: f.at.toISOString() }))} theme={theme} />
    </section>
  );
}

async function MissionArtifacts({ missionId, agentById, taskTitles }: { missionId: string; agentById: AgentMap; taskTitles: Map<string, string> }) {
  const list = await getDb().select().from(schema.artifacts).where(eq(schema.artifacts.missionId, missionId)).orderBy(desc(schema.artifacts.createdAt));
  const tr = await getT();
  const { timeFmt } = formats(await getLocale());
  return (
    <section className="flex flex-col gap-3 px-4 pb-12" aria-label={tr("산출물")}>
      {list.length === 0 && <p className="text-sm opacity-60">{tr("아직 산출물이 없습니다.")}</p>}
      {list.map((a) => (
        <details key={a.id} className={card}>
          <summary className="cursor-pointer">
            <span className="font-semibold">
              {a.taskId ? "📄" : "🏁"} {a.title}
            </span>
            <span className="block text-xs opacity-60">
              {a.agentId ? (agentById.get(a.agentId)?.name ?? tr("에이전트")) : tr("에이전트")} · {a.taskId ? (taskTitles.get(a.taskId) ?? "Task") : tr("최종 결과")} · v{a.version} ·{" "}
              {timeFmt.format(a.createdAt)}
            </span>
          </summary>
          <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{a.content}</div>
        </details>
      ))}
    </section>
  );
}

async function MissionCost({ missionId, agentById, used, limit }: { missionId: string; agentById: AgentMap; used: number; limit: number }) {
  const list = await getDb().select().from(schema.costLogs).where(eq(schema.costLogs.missionId, missionId)).orderBy(desc(schema.costLogs.createdAt)).limit(200);
  const tr = await getT();
  const locale = await getLocale();
  const { timeFmt, won } = formats(locale);
  return (
    <section className="flex flex-col gap-3 px-4 pb-12" aria-label={tr("비용")}>
      <p className="text-sm">
        {tr("합계")} <b>{tr("{n}원", { n: won.format(used) })}</b> / {tr("한도 {n}원 · 호출 {calls}번", { n: won.format(limit), calls: list.length })}
      </p>
      <ul className="flex flex-col divide-y divide-black/10 text-sm dark:divide-white/15">
        {list.map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-2">
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{c.agentId ? (agentById.get(c.agentId)?.name ?? tr("에이전트")) : tr("시스템")}</span>
              <span className="block text-xs opacity-60">
                {timeFmt.format(c.createdAt)} · {c.model} · {tr("입력 {input} / 출력 {output} 토큰", { input: numberFormat(locale, c.inputTokens), output: numberFormat(locale, c.outputTokens) })}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">{tr("{n}원", { n: won.format(Number(c.cost)) })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
