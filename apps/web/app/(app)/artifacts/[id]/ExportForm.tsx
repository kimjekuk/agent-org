"use client";

// F205 보내기: 연결된 곳(이메일·슬랙)을 골라 승인함에 요청을 올린다. 승인해야 실제로 나간다
import type { ExportChannel } from "@agentorg/shared/export";
import Link from "next/link";
import { useActionState, useState } from "react";
import { useT } from "@/components/I18n";
import { button, errorText, input } from "@/lib/ui";
import { requestExportAction } from "../actions";

// 서버 전용 모듈(메일 발송)을 화면 번들에 넣지 않으려고 이름표만 따로 둔다
const CHANNEL_LABEL: Record<ExportChannel, string> = { EMAIL: "이메일", SLACK: "슬랙" }; // i18n-ignore (화면에서 t(label))

export function ExportForm({ artifactId, channels }: { artifactId: string; channels: { kind: ExportChannel; label: string; defaultTo?: string }[] }) {
  const t = useT();
  const [state, action, pending] = useActionState(requestExportAction, undefined);
  const [channel, setChannel] = useState<ExportChannel>(channels[0].kind);
  const current = channels.find((c) => c.kind === channel)!;

  if (state?.approvalId)
    return (
      <p className="text-sm text-green-700 dark:text-green-400">
        {state.existing ? t("이미 승인함에 같은 요청이 있습니다.") : t("승인함에 올렸습니다. 승인하면 바로 보냅니다.")}{" "}
        <Link href={`/approvals/${state.approvalId}`} className="font-semibold underline">
          {t("승인하러 가기")} →
        </Link>
      </p>
    );
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={artifactId} />
      <input type="hidden" name="channel" value={channel} />
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("보낼 곳")}>
        {channels.map((c) => (
          <button
            key={c.kind}
            type="button"
            role="radio"
            aria-checked={channel === c.kind}
            onClick={() => setChannel(c.kind)}
            className={`h-11 rounded-lg border text-sm font-semibold ${channel === c.kind ? "border-foreground ring-2 ring-foreground" : "border-black/15 dark:border-white/15"}`}
          >
            {c.kind === "EMAIL" ? "✉️" : "💬"} {t(CHANNEL_LABEL[c.kind])}
          </button>
        ))}
      </div>
      {channel === "EMAIL" ? (
        <label className="flex flex-col gap-1 text-sm">
          {t("받는 사람 (쉼표로 여러 명)")}
          <input key="to" name="to" type="text" inputMode="email" defaultValue={current.defaultTo ?? ""} className={input} />
        </label>
      ) : (
        <p className="break-all text-sm opacity-70">{current.label}</p>
      )}
      <button type="submit" disabled={pending} className={button}>
        {pending ? t("올리는 중…") : t("보내기 (승인 후 발송)")}
      </button>
      {state?.error && <p className={errorText}>{state.error}</p>}
    </form>
  );
}
