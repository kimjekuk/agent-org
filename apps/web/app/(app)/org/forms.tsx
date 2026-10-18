"use client";

import { useActionState } from "react";
import { button, errorText, input } from "@/lib/ui";
import { type FormState, updatePlacement } from "./actions";

const RANKS = [
  { value: "LEADER", label: "리더" },
  { value: "MANAGER", label: "팀장" },
  { value: "MEMBER", label: "팀원" },
];

function Message({ state }: { state: FormState }) {
  if (state?.error) return <p className={errorText}>{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>;
  return null;
}

/** 상사·직급 변경 (드래그 대신 메뉴) */
export function PlacementForm({ id, rank, supervisorId, candidates }: { id: string; rank: string; supervisorId: string | null; candidates: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(updatePlacement, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-semibold">
          상사
          <select name="supervisorId" defaultValue={supervisorId ?? ""} className={`${input} appearance-none`}>
            <option value="">없음 (최상위)</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          직급
          <select name="rank" defaultValue={rank} className={`${input} appearance-none`}>
            {RANKS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button type="submit" disabled={pending} className={button}>
        {pending ? "저장 중" : "자리 바꾸기"}
      </button>
      <Message state={state} />
    </form>
  );
}
