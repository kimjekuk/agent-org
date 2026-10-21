"use client";

import { useActionState } from "react";
import { button, errorText, input } from "@/lib/ui";
import { saveChannel } from "./export-actions";

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input className={input} autoComplete="off" {...props} />
    </label>
  );
}

/** F205 슬랙: 채널의 Incoming Webhook 주소 하나 */
export function SlackChannelForm({ registered }: { registered: boolean }) {
  const [state, action, pending] = useActionState(saveChannel, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="kind" value="SLACK" />
      <Field label="웹훅 주소" name="webhookUrl" type="password" placeholder={registered ? "새 주소로 바꾸려면 입력" : "https://hooks.slack.com/services/…"} required />
      <button type="submit" disabled={pending} className={button}>
        저장
      </button>
      {state?.error && <p className={errorText}>{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>}
    </form>
  );
}

/** F205 이메일: SMTP (Gmail이면 smtp.gmail.com · 587 · 앱 비밀번호) */
export function EmailChannelForm({ registered }: { registered: boolean }) {
  const [state, action, pending] = useActionState(saveChannel, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="kind" value="EMAIL" />
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <Field label="SMTP 서버" name="host" placeholder="smtp.gmail.com" required />
        <Field label="포트" name="port" type="number" inputMode="numeric" defaultValue={587} required />
      </div>
      <Field label="아이디 (보통 이메일 주소)" name="user" type="email" inputMode="email" required />
      <Field label="비밀번호 (Gmail은 앱 비밀번호)" name="pass" type="password" placeholder={registered ? "다시 입력해 주세요" : ""} required />
      <Field label="보내는 사람 (비우면 아이디)" name="from" type="email" inputMode="email" />
      <Field label="기본 받는 사람 (쉼표로 여러 명)" name="to" inputMode="email" required />
      <button type="submit" disabled={pending} className={button}>
        저장
      </button>
      {state?.error && <p className={errorText}>{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>}
    </form>
  );
}
