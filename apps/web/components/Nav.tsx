"use client";

// F017 네비게이션: 모바일은 하단 탭바 5개(대시보드·미션·승인함·에이전트·더보기), PC(md 이상)는 좌측 사이드바 (PRD 4장·F017)
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MORE_PATHS, SIDEBAR, TABS } from "@/lib/nav";

function isActive(pathname: string, href: string) {
  if (href === "/more") return MORE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="rounded-full bg-red-600 px-1.5 text-xs font-bold leading-5 text-white" aria-label={`대기 ${n}건`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function BottomTabs({ pending }: { pending: number }) {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden dark:border-white/15"
      aria-label="주 메뉴"
    >
      <ul className="grid grid-cols-5">
        {TABS.map((t) => {
          const on = isActive(pathname, t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={`relative flex h-16 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${on ? "" : "opacity-55"}`}
              >
                <span className="text-xl leading-none" aria-hidden>
                  {t.icon}
                </span>
                {t.label}
                {t.href === "/approvals" && pending > 0 && (
                  <span className="absolute right-[18%] top-1.5">
                    <Badge n={pending} />
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Sidebar({ pending }: { pending: number }) {
  const pathname = usePathname();
  return (
    <nav className="sticky top-16 hidden h-[calc(100vh-4rem)] w-52 shrink-0 flex-col gap-1 overflow-y-auto p-3 md:flex" aria-label="주 메뉴">
      {SIDEBAR.map((t) => {
        const on = isActive(pathname, t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold ${on ? "bg-black/10 dark:bg-white/15" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
          >
            <span aria-hidden>{t.icon}</span>
            <span className="flex-1">{t.label}</span>
            {t.href === "/approvals" && <Badge n={pending} />}
          </Link>
        );
      })}
    </nav>
  );
}
