// F209 에이전트 사용 언어 (2026-10-21 결정): 조직 기본값 + 에이전트별로 바꾸기. 결과물·보고·회의 발언을 이 언어로 쓴다
// 화면(클라이언트)에서도 불러 쓰므로 DB를 가져오지 않는다 — 조직 기본값 찾기는 워커 loops/common.ts agentLanguage
export const LANGUAGES = {
  ko: { label: "한국어", name: "한국어" },
  en: { label: "English", name: "영어(English)" },
  ja: { label: "日本語", name: "일본어(日本語)" },
} as const;
export type AgentLanguage = keyof typeof LANGUAGES;

export function isLanguage(v: unknown): v is AgentLanguage {
  return typeof v === "string" && v in LANGUAGES;
}

/** 시스템 프롬프트에 넣을 언어 지침. 한국어면 없음 (지침이 한국어라 그대로 한국어로 쓴다) */
export function languagePrompt(lang: AgentLanguage | undefined): string {
  if (!lang || lang === "ko") return "";
  return (
    `결과물·보고·답변·회의 발언은 모두 ${LANGUAGES[lang].name}로 쓴다 (지침과 사용자 지시가 한국어여도). ` +
    "단, 지침에서 정한 제목(예: '## 자기검토', '## 다음 제안')과 JSON 키·형식은 적힌 그대로 둔다."
  );
}
