import { getDb, schema } from "@agentorg/shared/db";
import { and, count, eq } from "drizzle-orm";
import { EmergencyBanner, EmergencyStopButton } from "@/components/EmergencyStop";
import { LiveRefresh } from "@/components/LiveRefresh";
import { BottomTabs, Sidebar } from "@/components/Nav";
import { getT } from "@/lib/i18n";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// 로그인 후 모든 화면 공통 (PRD 4장·F017): 상단 바(조직 이름 · 긴급 정지) + 모바일 하단 탭바 / PC 좌측 사이드바
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  const t = await getT();
  // 승인함 배지: 기다리는 요청 수 (PRD 4장)
  const [pending] = org
    ? await getDb()
        .select({ n: count() })
        .from(schema.approvalRequests)
        .where(and(eq(schema.approvalRequests.orgId, org.id), eq(schema.approvalRequests.status, "PENDING")))
    : [];
  const n = pending?.n ?? 0;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-black/10 bg-background/95 backdrop-blur dark:border-white/15">
        {org?.emergencyStop && <EmergencyBanner orgId={org.id} />}
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4">
          <div className="min-w-0">
            <p className="truncate text-xs opacity-60">AgentOrg</p>
            <p className="truncate font-bold">{org?.name ?? t("조직 없음")}</p>
          </div>
          {org && <EmergencyStopButton orgId={org.id} stopped={org.emergencyStop} />}
        </div>
      </header>
      {org && <LiveRefresh orgId={org.id} />}
      <div className="mx-auto flex max-w-6xl">
        <Sidebar pending={n} />
        {/* 모바일: 하단 탭바 높이만큼 아래 여백 */}
        <div className="min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">{children}</div>
      </div>
      <BottomTabs pending={n} />
    </div>
  );
}
