// F209 화면 언어 (2026-10-21 결정: 한국어 + 영어 먼저, 설정에서 고르기, 계정별 기억).
// 한국어 문장이 그대로 키다: t("승인 대기함") → 영어면 en 사전에서 찾고, 없으면 한국어를 그대로 보여 준다.
// 바뀌는 값은 {이름}으로: t("{n}분 대기", { n: 5 }). 일본어는 사전 파일만 더하면 된다.
import { en } from "./en";

export const LOCALES = { ko: "한국어", en: "English" } as const;
export type Locale = keyof typeof LOCALES;
export const LOCALE_COOKIE = "locale";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && v in LOCALES;
}

export type Vars = Record<string, string | number | null | undefined>;
export type T = (key: string, vars?: Vars) => string;

const DICTS: Record<Exclude<Locale, "ko">, Record<string, string>> = { en };

export function translate(locale: Locale, key: string, vars?: Vars): string {
  const text = locale === "ko" ? key : (DICTS[locale][key] ?? key);
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (vars[name] == null ? m : String(vars[name])));
}

export function makeT(locale: Locale): T {
  return (key, vars) => translate(locale, key, vars);
}

/** 날짜·숫자 표기 (시간대는 항상 한국) */
export const INTL_LOCALE: Record<Locale, string> = { ko: "ko-KR", en: "en-US" };
export function dateFormat(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone: "Asia/Seoul", ...options });
}
export function numberFormat(locale: Locale, n: number): string {
  return n.toLocaleString(INTL_LOCALE[locale]);
}

export { en };
