import { isPersonalityType, PERSONALITY_TYPES } from "@agentorg/shared/agents/personality";
import type { Avatar } from "@agentorg/shared/agents/templates";
import { getDb, schema } from "@agentorg/shared/db";
import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { AgentAvatar } from "@/components/AgentAvatar";
import { type Agent, RANK_LABEL, isRestTime, statusBadge } from "@/lib/agents";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { buttonGhost } from "@/lib/ui";
import { PlacementForm } from "./forms";

export const dynamic = "force-dynamic";

const RANK_ORDER = { LEADER: 0, MANAGER: 1, MEMBER: 2 } as const;

// F004 조직도: 리더 → 팀장 → 팀원 트리. 노드를 탭하면 프로필 요약·상사/직급 변경·지시하기
export default async function OrgPage() {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) return <main className="mx-auto max-w-3xl p-4 text-sm">먼저 설정에서 조직을 만들어 주세요.</main>;
  const all = await getDb().select().from(schema.agents).where(eq(schema.agents.orgId, org.id)).orderBy(asc(schema.agents.createdAt));
  const active = all.filter((a) => a.isActive);
  const ids = new Set(active.map((a) => a.id));
  const sort = (list: Agent[]) => [...list].sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
  // 상사가 없거나 해고된 사람은 최상위로 그린다
  const roots = sort(active.filter((a) => !a.supervisorId || !ids.has(a.supervisorId)));
  const childrenOf = (id: string) => sort(active.filter((a) => a.supervisorId === id));

  const Node = ({ agent, depth }: { agent: Agent; depth: number }) => {
    const badge = statusBadge(agent, isRestTime(org));
    const skills = (agent.skills ?? []) as string[];
    const kids = childrenOf(agent.id);
    return (
      <li className="flex flex-col gap-2">
        <details className="rounded-xl border border-black/10 bg-background dark:border-white/15">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
            <AgentAvatar avatar={agent.avatar as Avatar | null} size={44} label={agent.name} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{agent.name}</span>
                <span className="text-xs opacity-60">{RANK_LABEL[agent.rank]}</span>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {skills.slice(0, 4).map((s) => (
                  <span key={s} className="rounded bg-black/5 px-1.5 text-xs dark:bg-white/10">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </summary>
          <div className="flex flex-col gap-3 border-t border-black/10 p-3 dark:border-white/15">
            {(agent.personality || isPersonalityType(agent.personalityType)) && (
              <p className="text-sm opacity-80">
                성격: {isPersonalityType(agent.personalityType) ? `${PERSONALITY_TYPES[agent.personalityType].emoji} ${PERSONALITY_TYPES[agent.personalityType].label}` : ""}
                {agent.personality && isPersonalityType(agent.personalityType) ? " · " : ""}
                {agent.personality}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Link href={`/agents/${agent.id}#directive`} className={`${buttonGhost} flex items-center justify-center`}>
                ✍️ 지시하기
              </Link>
              <Link href={`/agents/${agent.id}`} className={`${buttonGhost} flex items-center justify-center`}>
                프로필
              </Link>
            </div>
            <PlacementForm
              id={agent.id}
              rank={agent.rank}
              supervisorId={agent.supervisorId}
              candidates={active.filter((a) => a.id !== agent.id).map((a) => ({ id: a.id, name: `${a.name} (${RANK_LABEL[a.rank]})` }))}
            />
          </div>
        </details>
        {kids.length > 0 && (
          <ul className={`flex flex-col gap-2 border-l-2 border-black/10 pl-3 dark:border-white/15 ${depth < 4 ? "ml-5" : "ml-2"}`}>
            {kids.map((k) => (
              <Node key={k.id} agent={k} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    );
  };

  const fired = all.filter((a) => !a.isActive);
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <h1 className="text-xl font-bold">조직도</h1>
      <p className="text-sm opacity-70">카드를 누르면 지시하거나 상사·직급을 바꿀 수 있습니다.</p>
      {active.length === 0 && (
        <p className="text-sm">
          아직 에이전트가 없습니다.{" "}
          <Link href="/agents" className="underline">
            에이전트 채용
          </Link>
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {roots.map((r) => (
          <Node key={r.id} agent={r} depth={0} />
        ))}
      </ul>
      {fired.length > 0 && (
        <p className="text-xs opacity-60">
          해고된 에이전트: {fired.map((f) => f.name).join(", ")} (에이전트 화면에서 재고용)
        </p>
      )}
    </main>
  );
}
