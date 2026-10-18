// 메뉴 정의 (PRD 4장 네비게이션, F017 하단 탭바 5개)

export const TABS = [
  { href: "/dashboard", label: "대시보드", icon: "🏠" },
  { href: "/missions", label: "미션", icon: "🎯" },
  { href: "/approvals", label: "승인함", icon: "✋" },
  { href: "/agents", label: "에이전트", icon: "👥" },
  { href: "/more", label: "더보기", icon: "☰" },
];

export const SIDEBAR = [
  { href: "/dashboard", label: "대시보드", icon: "🏠" },
  { href: "/org", label: "조직도", icon: "🌳" },
  { href: "/agents", label: "에이전트", icon: "👥" },
  { href: "/missions", label: "미션", icon: "🎯" },
  { href: "/artifacts", label: "산출물", icon: "📄" },
  { href: "/knowledge", label: "지식", icon: "📚" },
  { href: "/schedules", label: "예약", icon: "⏰" },
  { href: "/approvals", label: "승인함", icon: "✋" },
  { href: "/audit", label: "로그", icon: "📜" },
  { href: "/settings", label: "설정", icon: "⚙️" },
];

/** 더보기 탭은 하단 탭바에 없는 화면들을 모두 포함한다 */
export const MORE_PATHS = ["/more", "/org", "/artifacts", "/knowledge", "/schedules", "/audit", "/settings"];

/** 더보기 화면의 메뉴 (하단 탭바에 없는 것들) */
export const MORE_LINKS = SIDEBAR.filter((s) => !TABS.some((t) => t.href === s.href));
