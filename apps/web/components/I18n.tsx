"use client";

// F209 클라이언트 화면용 번역: 루트 레이아웃이 언어를 넣어 주고, 컴포넌트는 useT()로 쓴다
import { type Locale, makeT, type T } from "@agentorg/shared/i18n";
import { createContext, useContext, useMemo } from "react";

const LocaleContext = createContext<Locale>("ko");

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): T {
  const locale = useLocale();
  return useMemo(() => makeT(locale), [locale]);
}
