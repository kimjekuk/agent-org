import type { Avatar } from "@agentorg/shared/agents/templates";
import { getDb, schema } from "@agentorg/shared/db";
import { MEETING_LABEL } from "@agentorg/shared/meetings";
import { AUTONOMY_LABEL, type Autonomy } from "@agentorg/shared/missions";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentAvatar } from "@/components/AgentAvatar";
import { MISSION_STATUS, PRIORITY_LABEL, progress, TASK_COLUMNS, getOrgMission } from "@/lib/missions";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { buttonDanger, buttonGhost, card } from "@/lib/ui";
import { cancelMission, moveTask, pauseMission, resumeMission } from "../actions";
import { MeetingReplyForm, MissionSettingsForm, NoteForm } from "../forms";

export const dynamic = "force-dynamic";

const timeFmt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul" });
const dateFmt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" });
const won = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
const TYPE_LABEL = { DIRECTIVE: "지시", REPORT: "보고", QUESTION: "질문", PROPOSAL: "제안" } as const;
const TABS = [
  { key: "board", label: "보드" },
  { key: "log", label: "대화" },
  { key: "meetings", label: "회의" },
  { key: "artifacts", label: "산출물" },
  { key: "cost", label: "비용" },
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
          ← 미션 목록
        </Link>
      </div>

      {/* 헤더: 제목·상태·진행률·예산 + 일시정지·취소·자율성 변경 */}
      <section className="flex flex-col gap-3 px-4">
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 text-xl font-bold">{mission.title}</h1>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${st.className}`}>{st.label}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/15" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-blue-600" style={{ width: `${pct}%` }} />
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="opacity-60">진행</dt>
          <dd>
            Task {taskList.filter((t) => t.status === "DONE").length}/{taskList.length} · {pct}%
          </dd>
          <dt className="opacity-60">예산</dt>
          <dd className={used >= mission.budgetLimit * 0.8 ? "font-semibold text-red-600 dark:text-red-400" : ""}>
            {won.format(used)} / {won.format(mission.budgetLimit)}원
          </dd>
          <dt className="opacity-60">AI 호출</dt>
          <dd className={(spent?.calls ?? 0) >= mission.callLimit ? "font-semibold text-red-600 dark:text-red-400" : ""}>
            {spent?.calls ?? 0} / {mission.callLimit}회
          </dd>
          <dt className="opacity-60">리더 · 자율성</dt>
          <dd>
            {leader?.name ?? "없음"} · {AUTONOMY_LABEL[autonomy]}
          </dd>
          <dt className="opacity-60">형식 · 우선순위</dt>
          <dd>
            {mission.outputFormat ?? "보고서"} · {PRIORITY_LABEL[mission.priority] ?? "보통"}
            {mission.deadline ? ` · ~${dateFmt.format(mission.deadline)}` : ""}
          </dd>
        </dl>
        {!closed && (
          <div className="grid grid-cols-2 gap-2">
            {mission.status === "PAUSED" ? (
              <form action={resumeMission}>
                <input type="hidden" name="id" value={mission.id} />
                <button type="submit" className={`${buttonGhost} w-full`}>
                  ▶ 재개
                </button>
              </form>
            ) : (
              <form action={pauseMission}>
                <input type="hidden" name="id" value={mission.id} />
                <button type="submit" className={`${buttonGhost} w-full`} disabled={mission.status !== "RUNNING"}>
                  ⏸ 일시정지
                </button>
              </form>
            )}
            <details className="group">
              <summary className={`${buttonGhost} flex w-full cursor-pointer list-none items-center justify-center text-red-600 dark:text-red-400`}>미션 취소</summary>
              <form action={cancelMission} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="id" value={mission.id} />
                <p className="text-xs opacity-80">남은 지시와 승인 요청이 모두 종료됩니다. 되돌릴 수 없습니다.</p>
                <button type="submit" className={buttonDanger}>
                  정말 취소
                </button>
              </form>
            </details>
          </div>
        )}
        {!closed && (
          <details className={card}>
            <summary className="cursor-pointer text-sm font-semibold">자율성 · 예산 · 회의 변경</summary>
            <div className="pt-3">
              <MissionSettingsForm id={mission.id} autonomy={autonomy} budgetLimit={mission.budgetLimit} meetings={mission.meetings} />
            </div>
          </details>
        )}
      </section>

      {openApprovals.length > 0 && (
        <section className="flex flex-col gap-2 px-4" aria-label="승인 요청">
          {openApprovals.map((a) => (
            <Link
              key={a.id}
              href={`/approvals/${a.id}`}
              className="flex min-h-11 items-center gap-2 rounded-xl bg-purple-100 px-4 py-3 text-sm font-semibold text-purple-900 dark:bg-purple-900/40 dark:text-purple-100"
            >
              <span aria-hidden>✋</span>
              <span className="min-w-0 flex-1 truncate">{a.status === "HELD" ? "보류 중: " : "승인이 필요합니다: "}{a.content.split("\n")[0]}</span>
              <span aria-hidden>›</span>
            </Link>
          ))}
        </section>
      )}

      {final && (
        <section className={`${card} mx-4 border-green-600/40`}>
          <details open>
            <summary className="cursor-pointer font-semibold">🏁 최종 결과 — {final.title}</summary>
            <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{final.content}</div>
          </details>
        </section>
      )}

      <nav className="flex gap-1 border-b border-black/10 px-2 dark:border-white/15" aria-label="미션 탭">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/missions/${mission.id}?tab=${t.key}`}
            scroll={false}
            className={`flex h-11 flex-1 items-center justify-center text-sm font-semibold ${tab === t.key ? "border-b-2 border-foreground" : "opacity-60"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "board" && (
        <section className="grid gap-3 px-4 pb-12 sm:grid-cols-2 lg:grid-cols-4" aria-label="칸반">
          {taskList.length === 0 && (
            <p className="text-sm opacity-70 sm:col-span-2 lg:col-span-4">
              {closed ? "Task가 없습니다." : `리더 ${leader?.name ?? ""}이(가) 계획을 세우는 중입니다…`}
            </p>
          )}
          {taskList.length > 0 &&
            TASK_COLUMNS.map((col) => {
              const items = taskList.filter((t) => t.status === col.status);
              return (
                <div key={col.status} className="flex flex-col gap-2 rounded-xl bg-black/5 p-2 dark:bg-white/5">
                  <h2 className="px-1 text-sm font-semibold">
                    {col.label} <span className="opacity-60">{items.length}</span>
                  </h2>
                  {items.map((t) => {
                    const who = t.assigneeId ? agentById.get(t.assigneeId) : undefined;
                    return (
                      <details key={t.id} className="rounded-lg bg-background p-3 shadow-sm">
                        <summary className="flex cursor-pointer list-none items-center gap-2">
                          <AgentAvatar avatar={who?.avatar as Avatar | null} size={28} label={who?.name ?? "담당 없음"} />
                          <span className="min-w-0 flex-1 text-sm font-semibold">{t.title}</span>
                          {(t.rejectCount > 0 || t.failCount > 0) && (
                            <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-900/40 dark:text-red-100">
                              {[t.rejectCount ? `반려 ${t.rejectCount}` : "", t.failCount ? `실패 ${t.failCount}` : ""].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </summary>
                        <div className="mt-2 flex flex-col gap-2 text-sm">
                          <p className="opacity-70">
                            담당 {who?.name ?? "없음"}
                            {t.rejectCount ? ` · 반려 ${t.rejectCount}회` : ""}
                            {t.failCount ? ` · 실패 ${t.failCount}회` : ""}
                          </p>
                          {t.description && <p className="whitespace-pre-wrap">{t.description}</p>}
                          {historyOf(t.id).length > 0 && (
                            <ol className="flex flex-col gap-1 border-l-2 border-black/10 pl-2 text-xs dark:border-white/15" aria-label="검토·실패 이력">
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
                                      {to === "TODO" ? "↺ 다시 하기" : "✓ 완료 처리"}
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
              <summary className="cursor-pointer text-sm font-semibold">미션 내용</summary>
              <div className="mt-2 flex flex-col gap-2 text-sm">
                <p>주제: {mission.topic}</p>
                {mission.goal && <p>목표: {mission.goal}</p>}
                {criteria.length > 0 && (
                  <ul className="list-disc pl-5">
                    {criteria.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
                {mission.referenceNotes && <p className="whitespace-pre-wrap break-words opacity-80">참고 자료: {mission.referenceNotes}</p>}
              </div>
            </details>
          )}
        </section>
      )}

      {tab === "log" && <MissionLog missionId={mission.id} agentById={agentById} closed={mission.status === "CANCELLED"} />}
      {tab === "meetings" && <MissionMeetings missionId={mission.id} agentById={agentById} enabled={mission.meetings} cancelled={mission.status === "CANCELLED"} />}
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
  const working = [...agentById.values()].filter((a) => a.status === "WORKING" && list.some((m) => m.receiverAgentId === a.id || m.senderAgentId === a.id));

  return (
    <>
      <section className="flex flex-col gap-3 px-4 pb-4" aria-label="대화 로그">
        {list.length === 0 && <p className="text-sm opacity-60">아직 대화가 없습니다.</p>}
        {list.map((m) => {
          const fromUser = m.senderType === "USER";
          const sender = m.senderAgentId ? agentById.get(m.senderAgentId) : undefined;
          const receiver = m.receiverAgentId ? agentById.get(m.receiverAgentId) : undefined;
          const p = (m.payload ?? {}) as { artifactId?: string; costKrw?: number; model?: string; failed?: boolean };
          const art = p.artifactId ? artById.get(p.artifactId) : undefined;
          const to = receiver ? (receiver.id === sender?.id ? "" : ` → ${receiver.name}`) : fromUser ? "" : " → 나";
          return (
            <article key={m.id} className={`flex max-w-[92%] items-end gap-2 ${fromUser ? "flex-row-reverse self-end" : "self-start"}`}>
              {!fromUser && <AgentAvatar avatar={sender?.avatar as Avatar | null} size={32} label={sender?.name ?? "에이전트"} />}
              <div
                className={`min-w-0 rounded-2xl px-4 py-3 text-sm ${
                  fromUser ? "bg-foreground text-background" : p.failed ? "bg-red-50 dark:bg-red-950/40" : "bg-black/5 dark:bg-white/10"
                }`}
              >
                <p className="mb-1 text-xs opacity-70">
                  {fromUser ? "나" : (sender?.name ?? "에이전트")}
                  {to} · {TYPE_LABEL[m.type]} · {timeFmt.format(m.createdAt)}
                </p>
                <details className="group" open={m.content.length <= 280}>
                  <summary className="cursor-pointer list-none group-open:hidden">
                    <span className="whitespace-pre-wrap break-words">{m.content.slice(0, 200)}… </span>
                    <span className="underline">더 보기</span>
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
                    {p.model} · {won.format(p.costKrw)}원
                  </p>
                )}
              </div>
            </article>
          );
        })}
        {working.map((a) => (
          <p key={a.id} className="self-start text-sm opacity-70">
            ✍️ {a.name}이(가) 작업 중입니다…
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
  return (
    <section className="flex flex-col gap-3 px-4 pb-12" aria-label="회의">
      {list.length === 0 && (
        <p className="text-sm opacity-70">
          {enabled ? "계획을 세우면 담당 팀원들이 킥오프 회의를 하고, 미션이 끝나면 회고 회의를 합니다." : "이 미션은 회의를 하지 않습니다. 위 '자율성 · 예산 · 회의 변경'에서 켤 수 있습니다."}
        </p>
      )}
      {list.map((m) => {
        const mine = turns.filter((t) => t.meetingId === m.id);
        const names = ((m.participants ?? []) as string[]).map((id) => agentById.get(id)?.name ?? "(없음)");
        return (
          <article key={m.id} className={`${card} flex flex-col gap-3`}>
            <header className="flex items-center gap-2">
              <h2 className="min-w-0 flex-1 font-semibold">
                {m.kind === "KICKOFF" ? "🚀" : "🔁"} {MEETING_LABEL[m.kind]}
              </h2>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${m.status === "RUNNING" ? "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100" : "bg-black/10 dark:bg-white/15"}`}>
                {m.status === "RUNNING" ? "진행 중" : "끝남"}
              </span>
            </header>
            <p className="text-xs opacity-60">
              참여 {names.join(" → ")} · {timeFmt.format(m.createdAt)}
            </p>
            {m.conclusion && (
              <div className="rounded-lg bg-green-50 p-3 text-sm dark:bg-green-950/40">
                <p className="mb-1 text-xs font-semibold opacity-70">결론</p>
                <p className="whitespace-pre-wrap break-words">{m.conclusion}</p>
              </div>
            )}
            <ol className="flex flex-col gap-2">
              {mine
                .filter((t) => !(t.speakerType === "AGENT" && t.content.startsWith("[결론")))
                .map((t) => {
                  const fromUser = t.speakerType === "USER";
                  const who = t.agentId ? agentById.get(t.agentId) : undefined;
                  return (
                    <li key={t.id} className={`flex max-w-[92%] items-end gap-2 ${fromUser ? "flex-row-reverse self-end" : "self-start"}`}>
                      {!fromUser && <AgentAvatar avatar={who?.avatar as Avatar | null} size={28} label={who?.name ?? "에이전트"} />}
                      <div className={`min-w-0 rounded-2xl px-3 py-2 text-sm ${fromUser ? "bg-foreground text-background" : "bg-black/5 dark:bg-white/10"}`}>
                        <p className="mb-0.5 text-xs opacity-70">
                          {fromUser ? "나" : (who?.name ?? "에이전트")} · {timeFmt.format(t.createdAt)}
                        </p>
                        <p className="whitespace-pre-wrap break-words">{t.content}</p>
                      </div>
                    </li>
                  );
                })}
              {m.status === "RUNNING" && <li className="text-sm opacity-70">💬 다음 차례가 의견을 정리하는 중입니다…</li>}
            </ol>
            <MeetingReplyForm missionId={missionId} meetingId={m.id} disabled={cancelled} />
          </article>
        );
      })}
    </section>
  );
}

async function MissionArtifacts({ missionId, agentById, taskTitles }: { missionId: string; agentById: AgentMap; taskTitles: Map<string, string> }) {
  const list = await getDb().select().from(schema.artifacts).where(eq(schema.artifacts.missionId, missionId)).orderBy(desc(schema.artifacts.createdAt));
  return (
    <section className="flex flex-col gap-3 px-4 pb-12" aria-label="산출물">
      {list.length === 0 && <p className="text-sm opacity-60">아직 산출물이 없습니다.</p>}
      {list.map((a) => (
        <details key={a.id} className={card}>
          <summary className="cursor-pointer">
            <span className="font-semibold">
              {a.taskId ? "📄" : "🏁"} {a.title}
            </span>
            <span className="block text-xs opacity-60">
              {a.agentId ? (agentById.get(a.agentId)?.name ?? "에이전트") : "에이전트"} · {a.taskId ? (taskTitles.get(a.taskId) ?? "Task") : "최종 결과"} · v{a.version} ·{" "}
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
  return (
    <section className="flex flex-col gap-3 px-4 pb-12" aria-label="비용">
      <p className="text-sm">
        합계 <b>{won.format(used)}원</b> / 한도 {won.format(limit)}원 · 호출 {list.length}번
      </p>
      <ul className="flex flex-col divide-y divide-black/10 text-sm dark:divide-white/15">
        {list.map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-2">
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{c.agentId ? (agentById.get(c.agentId)?.name ?? "에이전트") : "시스템"}</span>
              <span className="block text-xs opacity-60">
                {timeFmt.format(c.createdAt)} · {c.model} · 입력 {c.inputTokens.toLocaleString("ko-KR")} / 출력 {c.outputTokens.toLocaleString("ko-KR")} 토큰
              </span>
            </span>
            <span className="shrink-0 tabular-nums">{won.format(Number(c.cost))}원</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
