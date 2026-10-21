"use client";

import { useActionState } from "react";
import { useT } from "@/components/I18n";
import { button, errorText, input } from "@/lib/ui";
import { createFirstUser } from "./actions";

export function SetupForm() {
  const t = useT();
  const [error, action, pending] = useActionState(createFirstUser, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {t("이메일")}
        <input name="email" type="email" autoComplete="email" required className={input} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("비밀번호 (8자 이상)")}
        <input name="password" type="password" autoComplete="new-password" minLength={8} required className={input} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("비밀번호 확인")}
        <input name="confirm" type="password" autoComplete="new-password" minLength={8} required className={input} />
      </label>
      {error && <p className={errorText}>{error}</p>}
      <button type="submit" disabled={pending} className={button}>
        {pending ? t("만드는 중…") : t("관리자 계정 만들기")}
      </button>
    </form>
  );
}
