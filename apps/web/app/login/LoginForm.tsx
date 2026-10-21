"use client";

import { useActionState } from "react";
import { useT } from "@/components/I18n";
import { button, errorText, input } from "@/lib/ui";
import { login } from "./actions";

export function LoginForm() {
  const t = useT();
  const [error, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {t("이메일")}
        <input name="email" type="email" autoComplete="email" required className={input} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("비밀번호")}
        <input name="password" type="password" autoComplete="current-password" required className={input} />
      </label>
      {error && <p className={errorText}>{error}</p>}
      <button type="submit" disabled={pending} className={button}>
        {pending ? t("로그인 중…") : t("로그인")}
      </button>
    </form>
  );
}
