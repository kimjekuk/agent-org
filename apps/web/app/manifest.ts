import type { MetadataRoute } from "next";

// F017 PWA: 홈 화면 "앱 설치" (PRD 5장 F017)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AgentOrg — AI 에이전트 조직", // i18n-ignore (설치 앱 정보는 쿠키 없이 받아 캐시된다)
    short_name: "AgentOrg",
    description: "AI 에이전트 조직에 지시하고, 승인하고, 결과를 받아 보세요", // i18n-ignore
    lang: "ko",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0a",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
