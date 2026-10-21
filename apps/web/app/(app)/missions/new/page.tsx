import { getDb, schema } from "@agentorg/shared/db";
import type { Autonomy } from "@agentorg/shared/missions";
import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getT } from "@/lib/i18n";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { MissionForm } from "../forms";

export const dynamic = "force-dynamic";

// F006 미션 생성
export default async function NewMissionPage() {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) redirect("/settings");
  const t = await getT();
  const agents = await getDb()
    .select({ id: schema.agents.id, name: schema.agents.name, rank: schema.agents.rank })
    .from(schema.agents)
    .where(and(eq(schema.agents.orgId, org.id), eq(schema.agents.isActive, true)))
    .orderBy(asc(schema.agents.createdAt));
  const hasLeader = agents.some((a) => a.rank === "LEADER");

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <Link href="/missions" className="text-sm opacity-70">
        ← {t("미션 목록")}
      </Link>
      <h1 className="text-xl font-bold">{t("새 미션")}</h1>
      {!hasLeader && (
        <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          {t("리더 직급 에이전트가 없습니다.")}{" "}
          <Link href="/agents" className="underline">
            {t("에이전트")}
          </Link>
          {t("에서 리더를 채용하거나, 아래에서 담당을 직접 골라 주세요.")}
        </p>
      )}
      <MissionForm leaders={agents.map((a) => ({ id: a.id, name: a.name }))} defaultAutonomy={org.autonomyDefault as Autonomy} />
    </main>
  );
}
