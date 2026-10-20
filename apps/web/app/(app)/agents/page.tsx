import { CONTENT_TEAM, ROLE_TEMPLATES } from "@agentorg/shared/agents/templates";
import { getDb, schema } from "@agentorg/shared/db";
import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { AgentAvatar } from "@/components/AgentAvatar";
import { RANK_LABEL, isRestTime, statusBadge } from "@/lib/agents";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { button, card } from "@/lib/ui";
import { hireContentTeam } from "./actions";
import { HireForm } from "./forms";

export const dynamic = "force-dynamic";

const RANK_ORDER = { LEADER: 0, MANAGER: 1, MEMBER: 2 } as const;

// F005 에이전트 목록·채용
export default async function AgentsPage() {
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

  const list = (await getDb().select().from(schema.agents).where(eq(schema.agents.orgId, org.id)).orderBy(asc(schema.agents.createdAt))).sort(
    (a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank],
  );

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <h1 className="text-xl font-bold">에이전트</h1>

      {list.length === 0 && (
        <section className={`${card} flex flex-col gap-3`}>
          <h2 className="font-semibold">첫 조직 템플릿 — 콘텐츠 제작팀</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {CONTENT_TEAM.map((t) => (
              <li key={t.key} className="flex items-center gap-3">
                <AgentAvatar avatar={t.avatar} size={36} label={t.name} />
                <span>
                  <b>{t.name}</b> · {t.title} — {t.skills.join(", ")}
                </span>
              </li>
            ))}
          </ul>
          <form action={hireContentTeam}>
            <button type="submit" className={`${button} w-full`}>
              4명 한 번에 채용
            </button>
          </form>
        </section>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {list.map((a) => {
          const badge = statusBadge(a, isRestTime(org));
          const skills = (a.skills ?? []) as string[];
          return (
            <li key={a.id}>
              <Link href={`/agents/${a.id}`} className={`${card} flex items-center gap-3 hover:bg-black/5 dark:hover:bg-white/5`}>
                <AgentAvatar avatar={a.avatar as never} size={52} label={a.name} level={a.level} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{a.name}</span>
                    <span className="text-xs opacity-60">
                      Lv.{a.level} · {RANK_LABEL[a.rank]}
                    </span>
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
                  </div>
                  <p className="truncate text-sm opacity-70">{skills.join(", ") || "특기 없음"}</p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <section className={`${card} flex flex-col gap-3`}>
        <h2 className="font-semibold">새로 채용</h2>
        <HireForm templates={ROLE_TEMPLATES.map((t) => ({ key: t.key, title: t.title, name: t.name }))} />
      </section>
    </main>
  );
}
