import { isPersonalityType, PERSONALITY_TYPES } from "@agentorg/shared/agents/personality";
import { normalizeAvatar, type ToolPermissions } from "@agentorg/shared/agents/templates";
import { getDb, schema } from "@agentorg/shared/db";
import { levelProgress, levelTitle, masteredSkills } from "@agentorg/shared/growth";
import { agentDailyJournal, kstDayRange, shiftDay } from "@agentorg/shared/journal";
import { listModelChoices } from "@agentorg/shared/llm/models";
import { MEMORY_LABEL } from "@agentorg/shared/memory";
import { and, asc, desc, eq, inArray, ne, or } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentAvatar } from "@/components/AgentAvatar";
import { getOrgAgent, RANK_LABEL, isRestTime, statusBadge } from "@/lib/agents";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { buttonDanger, buttonGhost, card } from "@/lib/ui";
import { cloneAgent, deleteAgent, toggleActive, togglePause } from "../actions";
import { CharacterEditor, DirectiveForm, ProfileForm } from "../forms";
import { deleteMemory, resetMemories } from "../memory-actions";
import { AddMemoryForm, EditMemoryForm } from "../memory-forms";

export const dynamic = "force-dynamic";

const timeFmt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul" });
const won = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
const clockFmt = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });
const TYPE_LABEL = { DIRECTIVE: "지시", REPORT: "보고", QUESTION: "질문", PROPOSAL: "제안" } as const;

// F005 프로필 + F009 대화(지시·보고) + 직접 지시
export default async function AgentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ day?: string }> }) {
  const { id } = await params;
  const { day } = await searchParams;
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) notFound();
  const agent = await getOrgAgent(org.id, id);
  if (!agent) notFound();
  const db = getDb();

  const others = await db
    .select({ id: schema.agents.id, name: schema.agents.name })
    .from(schema.agents)
    .where(and(eq(schema.agents.orgId, org.id), ne(schema.agents.id, agent.id)))
    .orderBy(asc(schema.agents.createdAt));
  const names = new Map(others.map((o) => [o.id, o.name]));

  // 최근 대화 50개 (오래된 것부터 표시)
  const convo = (
    await db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.orgId, org.id), or(eq(schema.messages.receiverAgentId, agent.id), eq(schema.messages.senderAgentId, agent.id))))
      .orderBy(desc(schema.messages.createdAt))
      .limit(50)
  ).reverse();
  const artifactIds = convo.map((m) => (m.payload as { artifactId?: string } | null)?.artifactId).filter((x): x is string => Boolean(x));
  const arts = artifactIds.length ? await db.select().from(schema.artifacts).where(inArray(schema.artifacts.id, artifactIds)) : [];
  const artById = new Map(arts.map((a) => [a.id, a]));

  // 고를 수 있는 모델 (Claude + 켜진 추가 모델). 지금 쓰는 모델이 꺼졌으면 그것도 보여 준다
  const models = await listModelChoices(db);
  for (const id of [agent.modelPrimary, agent.modelEconomy]) if (id && !models.some((m) => m.id === id)) models.push({ id, label: `${id} (꺼짐 — 다른 모델로 바꿔 주세요)` });
  // F101 기억 (장기·중기·단기)
  const mems = await db.select().from(schema.memories).where(eq(schema.memories.agentId, agent.id)).orderBy(desc(schema.memories.createdAt));
  const missionIds = [...new Set(mems.map((m) => m.missionId).filter((x): x is string => Boolean(x)))];
  const missionTitle = new Map(
    (missionIds.length ? await db.select({ id: schema.missions.id, title: schema.missions.title }).from(schema.missions).where(inArray(schema.missions.id, missionIds)) : []).map((m) => [m.id, m.title]),
  );
  const badge = statusBadge(agent, isRestTime(org));
  // F103 하루 일지
  const journal = await agentDailyJournal(db, agent.id, day);
  const today = kstDayRange().day;
  // F102 성장
  const growth = levelProgress(agent.xp);
  const mastered = masteredSkills(agent.skillXp as Record<string, number>);
  const personality = isPersonalityType(agent.personalityType) ? PERSONALITY_TYPES[agent.personalityType] : null;
  const avatar = normalizeAvatar(agent.avatar);
  const working = agent.status === "WORKING";

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 pt-4">
      <div className="flex items-center gap-3 px-4">
        <Link href="/agents" className="text-sm opacity-70">
          ← 목록
        </Link>
      </div>
      <section className="flex items-center gap-4 px-4">
        <AgentAvatar avatar={avatar} size={72} label={agent.name} level={growth.level} />
        <div className="min-w-0">
          <h1 className="text-xl font-bold">{agent.name}</h1>
          <p className="text-sm opacity-70">
            Lv.{growth.level} {levelTitle(growth.level)} · {RANK_LABEL[agent.rank]}
            {agent.supervisorId && names.get(agent.supervisorId) ? ` · 상사 ${names.get(agent.supervisorId)}` : ""}
          </p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
          <div className="mt-1 flex items-center gap-2" title={`경험치 ${agent.xp} / 다음 레벨 ${growth.next}`}>
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-black/10 dark:bg-white/15" role="progressbar" aria-label="경험치" aria-valuenow={Math.round(growth.ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-amber-400" style={{ width: `${Math.round(growth.ratio * 100)}%` }} />
            </div>
            <span className="text-xs opacity-60">
              XP {agent.xp}/{growth.next}
            </span>
          </div>
          {mastered.length > 0 && <p className="mt-1 text-xs">⭐ 숙련: {mastered.join(", ")}</p>}
          {personality && (
            <span className="ml-1 mt-1 inline-block rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">
              {personality.emoji} {personality.label}
            </span>
          )}
        </div>
      </section>

      {/* 대화: 지시와 보고 (F009). 보고에 산출물이 있으면 펼쳐 볼 수 있다 */}
      <section className="flex flex-col gap-3 px-4" aria-label="대화">
        {convo.length === 0 && <p className="text-sm opacity-60">아직 대화가 없습니다. 아래에서 첫 지시를 내려 보세요.</p>}
        {convo.map((m) => {
          const fromUser = m.senderType === "USER";
          const p = (m.payload ?? {}) as { artifactId?: string; costKrw?: number; model?: string; webSearchRequests?: number; failed?: boolean };
          const art = p.artifactId ? artById.get(p.artifactId) : undefined;
          const from = fromUser ? "나" : m.senderAgentId === agent.id ? agent.name : (names.get(m.senderAgentId ?? "") ?? "에이전트");
          const to = m.receiverAgentId === agent.id ? agent.name : m.receiverAgentId ? (names.get(m.receiverAgentId) ?? "에이전트") : "나";
          return (
            <article
              key={m.id}
              className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm ${
                fromUser ? "self-end bg-foreground text-background" : p.failed ? "self-start bg-red-50 dark:bg-red-950/40" : "self-start bg-black/5 dark:bg-white/10"
              }`}
            >
              <p className="mb-1 text-xs opacity-70">
                {from} → {to} · {TYPE_LABEL[m.type]} · {timeFmt.format(m.createdAt)}
                {m.type === "DIRECTIVE" && !m.readAt ? " · 대기 중" : ""}
              </p>
              <p className="whitespace-pre-wrap break-words">{m.content}</p>
              {art && (
                <details className="mt-2 rounded-lg bg-background p-3 text-foreground">
                  <summary className="cursor-pointer font-semibold">📄 {art.title}</summary>
                  <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{art.content}</div>
                </details>
              )}
              {p.costKrw !== undefined && (
                <p className="mt-1 text-xs opacity-60">
                  {p.model} · {won.format(p.costKrw)}원{p.webSearchRequests ? ` · 웹 검색 ${p.webSearchRequests}회` : ""}
                </p>
              )}
            </article>
          );
        })}
        {working && <p className="self-start text-sm opacity-70">✍️ {agent.name}이(가) 작업 중입니다…</p>}
      </section>

      <DirectiveForm agentId={agent.id} />

      <section className="flex flex-col gap-4 px-4 pb-12">
        <details id="profile" className={`${card} scroll-mt-20`}>
          <summary className="cursor-pointer font-semibold">프로필 · 모델 · 도구 권한 · 예산</summary>
          <div className="pt-3">
            <ProfileForm
              agent={{
                id: agent.id,
                name: agent.name,
                rank: agent.rank,
                personality: agent.personality,
                personalityType: agent.personalityType,
                speechTone: agent.speechTone,
                language: agent.language,
                skills: (agent.skills ?? []) as string[],
                supervisorId: agent.supervisorId,
                modelPrimary: agent.modelPrimary,
                modelEconomy: agent.modelEconomy,
                maxTurns: agent.maxTurns,
                budgetLimit: agent.budgetLimit,
                toolPermissions: (agent.toolPermissions ?? {}) as ToolPermissions,
              }}
              supervisors={others}
              models={models}
            />
          </div>
        </details>

        <details id="character" className={`${card} scroll-mt-20`}>
          <summary className="cursor-pointer font-semibold">🎨 캐릭터 꾸미기</summary>
          <div className="pt-3">
            <CharacterEditor agentId={agent.id} avatar={avatar} level={growth.level} />
          </div>
        </details>

        <details id="journal" className={`${card} scroll-mt-20`} open={Boolean(day)}>
          <summary className="cursor-pointer font-semibold">📔 하루 일지</summary>
          <div className="flex flex-col gap-3 pt-3 text-sm">
            <nav className="flex items-center justify-between gap-2" aria-label="날짜">
              <Link href={`?day=${shiftDay(journal.day, -1)}#journal`} className={`${buttonGhost} flex items-center`}>
                ← 전날
              </Link>
              <span className="font-semibold">{journal.day === today ? `오늘 (${journal.day})` : journal.day}</span>
              {journal.day < today ? (
                <Link href={`?day=${shiftDay(journal.day, 1)}#journal`} className={`${buttonGhost} flex items-center`}>
                  다음날 →
                </Link>
              ) : (
                <span className="w-20" />
              )}
            </nav>
            {journal.llmCalls === 0 && journal.reports === 0 && journal.failures.length === 0 ? (
              <p className="opacity-60">이날은 한 일이 없습니다.</p>
            ) : (
              <>
                <ul className="grid grid-cols-2 gap-2">
                  <li className="rounded-lg bg-black/5 p-3 dark:bg-white/10">보고 <b>{journal.reports}</b>건</li>
                  <li className="rounded-lg bg-black/5 p-3 dark:bg-white/10">끝낸 Task <b>{journal.tasksDone}</b>개</li>
                  <li className="rounded-lg bg-black/5 p-3 dark:bg-white/10">AI 호출 <b>{journal.llmCalls}</b>회</li>
                  <li className="rounded-lg bg-black/5 p-3 dark:bg-white/10">비용 <b>{won.format(journal.costKrw)}</b>원</li>
                </ul>
                {journal.firstAt && journal.lastAt && (
                  <p className="opacity-70">
                    일한 시간: {clockFmt.format(journal.firstAt)} ~ {clockFmt.format(journal.lastAt)}
                  </p>
                )}
                {journal.missions.length > 0 && (
                  <div>
                    <h3 className="font-semibold">참여한 미션</h3>
                    <ul className="list-disc pl-5">
                      {journal.missions.map((m) => (
                        <li key={m.id}>
                          <Link href={`/missions/${m.id}`} className="underline">
                            {m.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {journal.artifacts.length > 0 && (
                  <div>
                    <h3 className="font-semibold">만든 산출물</h3>
                    <ul className="list-disc pl-5">
                      {journal.artifacts.map((a) => (
                        <li key={a.id}>
                          <Link href={`/artifacts/${a.id}`} className="underline">
                            {a.title}
                          </Link>{" "}
                          <span className="opacity-60">
                            v{a.version}
                            {a.rating ? ` · ★${a.rating}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {journal.failures.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-red-600 dark:text-red-400">막힌 일 {journal.failures.length}건</h3>
                    <ul className="list-disc pl-5">
                      {journal.failures.map((f, i) => (
                        <li key={i}>
                          {clockFmt.format(f.at)} {f.content}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {journal.memories.length > 0 && (
                  <div>
                    <h3 className="font-semibold">새로 기억한 것</h3>
                    <ul className="list-disc pl-5">
                      {journal.memories.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </details>

        <details id="memory" className={`${card} scroll-mt-20`}>
          <summary className="cursor-pointer font-semibold">🧠 기억 {mems.length}개</summary>
          <div className="flex flex-col gap-3 pt-3">
            <p className="text-sm opacity-70">일을 마칠 때 스스로 적은 &lsquo;기억할 점&rsquo;과 미션 교훈입니다. 다음 일에 참고하지만, 내 지시가 항상 우선합니다.</p>
            {(["LONG", "MID", "SHORT"] as const).map((scope) => {
              const list = mems.filter((m) => m.scope === scope);
              if (list.length === 0) return null;
              return (
                <div key={scope} className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">
                    {MEMORY_LABEL[scope]} <span className="opacity-60">{list.length}</span>
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {list.map((m) => (
                      <li key={m.id} className="rounded-lg bg-black/5 p-3 text-sm dark:bg-white/10">
                        <details>
                          <summary className="cursor-pointer list-none">
                            {m.content}
                            <span className="block text-xs opacity-60">
                              {timeFmt.format(m.createdAt)}
                              {m.missionId && missionTitle.get(m.missionId) ? ` · ${missionTitle.get(m.missionId)}` : ""}
                              {m.source?.startsWith("user") ? " · 직접 입력·수정" : ""}
                            </span>
                          </summary>
                          <div className="mt-2 flex flex-col gap-2">
                            <EditMemoryForm agentId={agent.id} id={m.id} content={m.content} />
                            <form action={deleteMemory}>
                              <input type="hidden" name="agentId" value={agent.id} />
                              <input type="hidden" name="id" value={m.id} />
                              <button type="submit" className={`${buttonGhost} w-full text-red-600 dark:text-red-400`}>
                                지우기
                              </button>
                            </form>
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {mems.length === 0 && <p className="text-sm opacity-60">아직 기억이 없습니다. 일을 하면 쌓입니다.</p>}
            <AddMemoryForm agentId={agent.id} />
            {mems.length > 0 && (
              <details>
                <summary className="cursor-pointer py-2 text-sm text-red-600 dark:text-red-400">기억 전체 초기화</summary>
                <form action={resetMemories} className="flex flex-col gap-2 pt-1">
                  <input type="hidden" name="agentId" value={agent.id} />
                  <p className="text-sm opacity-80">&ldquo;{agent.name}&rdquo;의 기억 {mems.length}개를 모두 지웁니다. 되돌릴 수 없습니다.</p>
                  <button type="submit" className={buttonDanger}>
                    정말 초기화
                  </button>
                </form>
              </details>
            )}
          </div>
        </details>

        <div className="grid grid-cols-3 gap-2">
          <form action={togglePause}>
            <input type="hidden" name="id" value={agent.id} />
            <button type="submit" className={`${buttonGhost} w-full`} disabled={!agent.isActive}>
              {agent.status === "PAUSED" ? "재개" : "멈추기"}
            </button>
          </form>
          <form action={cloneAgent}>
            <input type="hidden" name="id" value={agent.id} />
            <button type="submit" className={`${buttonGhost} w-full`}>
              복제
            </button>
          </form>
          <form action={toggleActive}>
            <input type="hidden" name="id" value={agent.id} />
            <button type="submit" className={`${buttonGhost} w-full`}>
              {agent.isActive ? "해고" : "재고용"}
            </button>
          </form>
        </div>
        <details>
          <summary className="cursor-pointer py-2 text-sm text-red-600 dark:text-red-400">에이전트 삭제</summary>
          <form action={deleteAgent} className="flex flex-col gap-2 pt-1">
            <input type="hidden" name="id" value={agent.id} />
            <p className="text-sm opacity-80">&ldquo;{agent.name}&rdquo;을(를) 삭제합니다. 대화 기록의 이름은 남지 않습니다. 되돌릴 수 없습니다.</p>
            <button type="submit" className={buttonDanger}>
              정말 삭제
            </button>
          </form>
        </details>
      </section>
    </main>
  );
}
