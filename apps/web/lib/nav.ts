// 메뉴 정의 (PRD 4장 네비게이션, F017 하단 탭바 5개)

export const TABS = [
  { href: "/dashboard", label: "대시보드", icon: "🏠" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
  { href: "/missions", label: "미션", icon: "🎯" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
  { href: "/approvals", label: "승인함", icon: "✋" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
  { href: "/agents", label: "에이전트", icon: "👥" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
  { href: "/more", label: "더보기", icon: "☰" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
];

export const SIDEBAR = [
  { href: "/dashboard", label: "대시보드", icon: "🏠" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
  { href: "/office", label: "사무실", icon: "🏢" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
  { href: "/org", label: "조직도", icon: "🌳" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
  { href: "/agents", label: "에이전트", icon: "👥" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
  { href: "/missions", label: "미션", icon: "🎯" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
  { href: "/artifacts", label: "산출물", icon: "📄" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
  { href: "/stats", label: "통계", icon: "📊" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
  { href: "/history", label: "연표", icon: "🗓️" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
  { href: "/knowledge", label: "지식", icon: "📚" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
  { href: "/schedules", label: "예약", icon: "⏰" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
  { href: "/approvals", label: "승인함", icon: "✋" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
  { href: "/audit", label: "로그", icon: "📜" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
  { href: "/settings", label: "설정", icon: "⚙️" }, // i18n-ignore (Nav.tsx에서 tr(label)로 번역)
];

/** 더보기 탭은 하단 탭바에 없는 화면들을 모두 포함한다 */
export const MORE_PATHS = ["/more", "/office", "/org", "/artifacts", "/stats", "/history", "/knowledge", "/schedules", "/audit", "/settings"];

/** 더보기 화면의 메뉴 (하단 탭바에 없는 것들) */
export const MORE_LINKS = SIDEBAR.filter((s) => !TABS.some((t) => t.href === s.href));
