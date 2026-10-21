// F209 서버 화면용 번역: 언어는 쿠키(설정에서 고를 때·로그인할 때 저장) → 없으면 계정 설정 → 한국어
import { isLocale, LOCALE_COOKIE, type Locale, makeT, type T } from "@agentorg/shared/i18n";
import { cookies } from "next/headers";
import { cache } from "react";

export const getLocale = cache(async (): Promise<Locale> => {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : "ko";
});

/** 서버 컴포넌트·서버 액션에서: const t = await getT(); t("승인함") */
export async function getT(): Promise<T> {
  return makeT(await getLocale());
}
