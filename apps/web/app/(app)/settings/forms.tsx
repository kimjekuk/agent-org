"use client";

import { numberFormat } from "@agentorg/shared/i18n";
import { useActionState } from "react";
import { useLocale, useT } from "@/components/I18n";
import { button, buttonGhost, errorText, input } from "@/lib/ui";
import { type ActionResult, createOrg, renameOrg, saveApiKey, testConnection } from "./actions";

function Message({ state }: { state: ActionResult }) {
  if (state?.error) return <p className={errorText}>{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>;
  return null;
}

export function CreateOrgForm() {
  const t = useT();
  const [state, action, pending] = useActionState(createOrg, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input name="name" placeholder={t("새 조직 이름 (예: 콘텐츠 제작팀)")} maxLength={50} required className={input} />
        <button type="submit" disabled={pending} className={`${button} shrink-0`}>
          {t("만들기")}
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

export function RenameOrgForm({ id, name }: { id: string; name: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(renameOrg, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <div className="flex gap-2">
        <input name="name" defaultValue={name} maxLength={50} required className={input} aria-label={t("조직 이름")} />
        <button type="submit" disabled={pending} className={`${buttonGhost} shrink-0`}>
          {t("이름 변경")}
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

const KEY_HINT: Record<string, string> = { anthropic: "sk-ant-…", openai: "sk-…", gemini: "AIza…", deepseek: "sk-…" };

export function ApiKeyForm({ provider, registered }: { provider: string; registered: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveApiKey, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="provider" value={provider} />
      <input
        name="key"
        type="password"
        autoComplete="off"
        placeholder={registered ? t("새 키로 바꾸려면 입력") : (KEY_HINT[provider] ?? t("API 키"))}
        required
        className={input}
        aria-label={t("API 키")}
      />
      <button type="submit" disabled={pending} className={button}>
        {pending ? t("저장 중…") : registered ? t("키 바꾸기") : t("키 저장")}
      </button>
      <Message state={state} />
    </form>
  );
}

export function TestConnectionForm({ provider }: { provider: string }) {
  const t = useT();
  const locale = useLocale();
  const won = (n: number) => numberFormat(locale, Math.round(n * 100) / 100);
  const [state, action, pending] = useActionState(testConnection, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="provider" value={provider} />
      <button type="submit" disabled={pending} className={`${buttonGhost} w-full`}>
        {pending ? t("확인 중…") : t("연결 테스트 (가장 싼 모델, 1원 미만)")}
      </button>
      {state?.error && <p className={errorText}>{state.error}</p>}
      {state?.reply && (
        <div className="rounded-lg bg-black/5 p-3 text-sm dark:bg-white/10">
          <p>{t("응답: {reply}", { reply: state.reply })}</p>
          {state.model && <p className="opacity-70">{t("모델: {model}", { model: state.model })}</p>}
          <p className="opacity-70">
            {t("비용: {cost}원 · 오늘 조직 사용률: {ratio}% (일 한도 {limit}원)", {
              cost: won(state.costKrw ?? 0),
              ratio: ((state.todayRatio ?? 0) * 100).toFixed(2),
              limit: won(state.budgetDaily ?? 0),
            })}
          </p>
        </div>
      )}
    </form>
  );
}
