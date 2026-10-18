import type { Avatar, ToolPermissions } from "@agentorg/shared/agents/templates";
import { getDb, schema } from "@agentorg/shared/db";
import { MODEL_CHOICES } from "@agentorg/shared/llm/pricing";
import { and, asc, desc, eq, inArray, ne, or } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentAvatar } from "@/components/AgentAvatar";
import { getOrgAgent, RANK_LABEL, statusBadge } from "@/lib/agents";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { buttonDanger, buttonGhost, card } from "@/lib/ui";
import { cloneAgent, deleteAgent, toggleActive, togglePause } from "../actions";
import { DirectiveForm, ProfileForm } from "../forms";

export const dynamic = "force-dynamic";

const timeFmt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul" });
const won = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
const TYPE_LABEL = { DIRECTIVE: "지시", REPORT: "보고", QUESTION: "질문", PROPOSAL: "제안" } as const;

// F005 프로필 + F009 대화(지시·보고) + 직접 지시
export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const badge = statusBadge(agent);
  const avatar = (agent.avatar ?? { hair: 0, face: 0, color: 0 }) as Avatar;
  const working = agent.status === "WORKING";

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 pt-4">
      <div className="flex items-center gap-3 px-4">
        <Link href="/agents" className="text-sm opacity-70">
          ← 목록
        </Link>
      </div>
      <section className="flex items-center gap-4 px-4">
        <AgentAvatar avatar={avatar} size={72} label={agent.name} />
        <div className="min-w-0">
          <h1 className="text-xl font-bold">{agent.name}</h1>
          <p className="text-sm opacity-70">
            {RANK_LABEL[agent.rank]}
            {agent.supervisorId && names.get(agent.supervisorId) ? ` · 상사 ${names.get(agent.supervisorId)}` : ""}
          </p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
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
                skills: (agent.skills ?? []) as string[],
                supervisorId: agent.supervisorId,
                modelPrimary: agent.modelPrimary,
                modelEconomy: agent.modelEconomy,
                maxTurns: agent.maxTurns,
                budgetLimit: agent.budgetLimit,
                toolPermissions: (agent.toolPermissions ?? {}) as ToolPermissions,
                avatar,
              }}
              supervisors={others}
              models={MODEL_CHOICES}
            />
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
