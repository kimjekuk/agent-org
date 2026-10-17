import { getDb, schema } from "@agentorg/shared/db";
import { and, count, eq } from "drizzle-orm";
import Link from "next/link";
import { EmergencyBanner, EmergencyStopButton } from "@/components/EmergencyStop";
import { LiveRefresh } from "@/components/LiveRefresh";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/missions", label: "미션" },
  { href: "/approvals", label: "승인함" },
  { href: "/agents", label: "에이전트" },
  { href: "/audit", label: "로그" },
  { href: "/settings", label: "설정" },
];

// 로그인 후 모든 화면 공통: 조직 이름 · 메뉴 · 긴급 정지 (PRD 4장). 하단 탭바는 F017(1-F)에서.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  // 승인함 배지: 기다리는 요청 수 (PRD 4장)
  const [pending] = org
    ? await getDb()
        .select({ n: count() })
        .from(schema.approvalRequests)
        .where(and(eq(schema.approvalRequests.orgId, org.id), eq(schema.approvalRequests.status, "PENDING")))
    : [];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-black/10 bg-background/95 backdrop-blur dark:border-white/15">
        {org?.emergencyStop && <EmergencyBanner orgId={org.id} />}
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-2">
          <div className="min-w-0">
            <p className="truncate text-xs opacity-60">AgentOrg</p>
            <p className="truncate font-bold">{org?.name ?? "조직 없음"}</p>
          </div>
          {org && <EmergencyStopButton orgId={org.id} stopped={org.emergencyStop} />}
        </div>
        <nav className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-2 pb-2">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="flex h-11 shrink-0 items-center rounded-lg px-3 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/10">
              {n.label}
              {n.href === "/approvals" && pending?.n ? (
                <span className="ml-1 rounded-full bg-red-600 px-1.5 text-xs leading-5 text-white" aria-label={`대기 ${pending.n}건`}>
                  {pending.n}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
      </header>
      {org && <LiveRefresh orgId={org.id} />}
      {children}
    </div>
  );
}
