"use client";

import type { ApprovalDecision } from "@agentorg/shared/approval";
import { useActionState } from "react";
import { button, buttonDanger, buttonGhost, errorText, input } from "@/lib/ui";
import { decide, type FormState, retryExport } from "./actions";

function Message({ state }: { state: FormState }) {
  if (state?.error) return <p className={errorText}>{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>;
  return null;
}

/** 승인 · 거절 · 보류 + 코멘트. 거절할 때 코멘트는 리더가 다시 할 때 그대로 반영한다 */
export function DecisionForm({ id, approveLabel, rejectLabel }: { id: string; approveLabel: string; rejectLabel: string }) {
  const [state, action, pending] = useActionState(decide, undefined);
  // 어떤 버튼을 눌렀는지는 버튼마다 넣는다 (form action에는 누른 버튼의 name/value가 실리지 않는다)
  const submit = (decision: ApprovalDecision) => (fd: FormData) => {
    fd.set("decision", decision);
    action(fd);
  };
  if (state?.ok) return <Message state={state} />;
  return (
    <form action={submit("HELD")} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <label className="flex flex-col gap-1 text-sm font-semibold">
        코멘트 (거절할 때는 무엇을 바꿀지 적어 주세요)
        <textarea name="comment" rows={3} maxLength={2000} className={`${input} h-auto min-h-11 py-2 font-normal`} />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <button type="submit" formAction={submit("APPROVED")} disabled={pending} className={button}>
          {approveLabel}
        </button>
        <button type="submit" formAction={submit("REJECTED")} disabled={pending} className={buttonDanger}>
          {rejectLabel}
        </button>
        <button type="submit" formAction={submit("HELD")} disabled={pending} className={buttonGhost}>
          보류
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

/** F205 발송 실패 → 다시 보내기 */
export function RetryExportForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(retryExport, undefined);
  if (state?.ok) return <Message state={state} />;
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className={button}>
        {pending ? "보내는 중…" : "다시 보내기"}
      </button>
      <Message state={state} />
    </form>
  );
}
