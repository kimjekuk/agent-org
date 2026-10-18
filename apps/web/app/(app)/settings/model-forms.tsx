"use client";

import { useActionState } from "react";
import { button, buttonDanger, errorText, input } from "@/lib/ui";
import { deleteModel, type ModelFormState, saveModel } from "./model-actions";

function Message({ state }: { state: ModelFormState }) {
  if (state?.error) return <p className={errorText}>{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>;
  return null;
}

const label = "flex flex-col gap-1 text-xs font-semibold";

export interface ModelValues {
  id: string;
  provider: string;
  label: string;
  inputUsd: string;
  outputUsd: string;
  cachedInputUsd: string | null;
}

/** 모델 추가·고치기. 요금은 100만 토큰당 달러 — 공식 페이지 값을 그대로 */
export function ModelForm({ providers, initial }: { providers: { value: string; label: string }[]; initial?: ModelValues }) {
  const [state, action, pending] = useActionState(saveModel, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <label className={label}>
          제공사
          <select name="provider" defaultValue={initial?.provider ?? providers[0]?.value} className={`${input} appearance-none`} disabled={Boolean(initial)}>
            {providers.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {initial && <input type="hidden" name="provider" value={initial.provider} />}
        </label>
        <label className={label}>
          모델 이름 (API)
          <input name="id" defaultValue={initial?.id} readOnly={Boolean(initial)} required placeholder="예: gpt-6.1-sol" className={input} autoCapitalize="off" />
        </label>
      </div>
      <label className={label}>
        표시 이름
        <input name="label" defaultValue={initial?.label} maxLength={60} placeholder="예: GPT-6.1 Sol — 균형" className={input} />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className={label}>
          입력 $
          <input name="inputUsd" type="number" inputMode="decimal" step="any" min={0} required defaultValue={initial ? Number(initial.inputUsd) : undefined} className={input} />
        </label>
        <label className={label}>
          출력 $
          <input name="outputUsd" type="number" inputMode="decimal" step="any" min={0} required defaultValue={initial ? Number(initial.outputUsd) : undefined} className={input} />
        </label>
        <label className={label}>
          캐시 입력 $
          <input
            name="cachedInputUsd"
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            placeholder="없으면 비움"
            defaultValue={initial?.cachedInputUsd != null ? Number(initial.cachedInputUsd) : undefined}
            className={input}
          />
        </label>
      </div>
      <p className="text-xs opacity-70">요금은 100만 토큰당 달러입니다. 저장하면 요금을 확인한 것으로 보고 모델을 켭니다.</p>
      <button type="submit" disabled={pending} className={button}>
        {pending ? "저장 중" : initial ? "확인하고 저장·켜기" : "추가하고 켜기"}
      </button>
      <Message state={state} />
    </form>
  );
}

export function DeleteModelForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deleteModel, undefined);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className={buttonDanger}>
        모델 지우기
      </button>
      <Message state={state} />
    </form>
  );
}
