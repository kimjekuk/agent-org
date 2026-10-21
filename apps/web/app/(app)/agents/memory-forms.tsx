"use client";

import { useActionState } from "react";
import { useT } from "@/components/I18n";
import { button, buttonGhost, errorText, input } from "@/lib/ui";
import { addMemory, type MemoryFormState, updateMemory } from "./memory-actions";

function Message({ state }: { state: MemoryFormState }) {
  if (state?.error) return <p className={errorText}>{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>;
  return null;
}

export function EditMemoryForm({ agentId, id, content }: { agentId: string; id: string; content: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(updateMemory, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="id" value={id} />
      <textarea name="content" defaultValue={content} rows={2} maxLength={300} required className={`${input} h-auto min-h-11 py-2`} aria-label={t("기억 내용")} />
      <button type="submit" disabled={pending} className={buttonGhost}>
        {t("고치기")}
      </button>
      <Message state={state} />
    </form>
  );
}

export function AddMemoryForm({ agentId }: { agentId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(addMemory, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="agentId" value={agentId} />
      <textarea name="content" rows={2} maxLength={300} required placeholder={t("예: 보고서는 항상 3줄 요약으로 시작한다")} className={`${input} h-auto min-h-11 py-2`} aria-label={t("새 장기 기억")} />
      <button type="submit" disabled={pending} className={button}>
        {t("장기 기억에 넣기")}
      </button>
      <Message state={state} />
    </form>
  );
}
