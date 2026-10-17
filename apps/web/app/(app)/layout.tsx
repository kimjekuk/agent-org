import Link from "next/link";
import { EmergencyBanner, EmergencyStopButton } from "@/components/EmergencyStop";
import { LiveRefresh } from "@/components/LiveRefresh";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/agents", label: "에이전트" },
  { href: "/audit", label: "로그" },
  { href: "/settings", label: "설정" },
];

// 로그인 후 모든 화면 공통: 조직 이름 · 메뉴 · 긴급 정지 (PRD 4장). 하단 탭바는 F017(1-F)에서.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);

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
            <Link key={n.href} href={n.href} className="flex h-11 items-center rounded-lg px-3 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/10">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      {org && <LiveRefresh orgId={org.id} />}
      {children}
    </div>
  );
}
