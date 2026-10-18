"use client";

import { AUTONOMY_HELP, AUTONOMY_LABEL, type Autonomy, OUTPUT_FORMATS } from "@agentorg/shared/missions";
import { useActionState, useRef } from "react";
import { button, errorText, input } from "@/lib/ui";
import { createMission, type FormState, sendMissionNote, updateMissionSettings } from "./actions";

function Message({ state }: { state: FormState }) {
  if (state?.error) return <p className={errorText}>{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>;
  return null;
}

const select = `${input} appearance-none`;
const textarea = `${input} h-auto min-h-11 py-2`;
const label = "flex flex-col gap-1 text-sm font-semibold";
const AUTONOMIES = Object.keys(AUTONOMY_LABEL) as Autonomy[];

/** F006 미션 생성 폼 — 필수는 주제 하나. 나머지는 기본값으로 바로 시작할 수 있다 */
export function MissionForm({ leaders, defaultAutonomy }: { leaders: { id: string; name: string }[]; defaultAutonomy: Autonomy }) {
  const [state, action, pending] = useActionState(createMission, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className={label}>
        주제 (필수)
        <input name="topic" required minLength={2} maxLength={200} placeholder="예: 2026년 숏폼 콘텐츠 트렌드" className={input} />
      </label>
      <label className={label}>
        목표
        <textarea name="goal" rows={2} maxLength={1000} placeholder="예: 다음 달 채널 기획에 쓸 근거 정리" className={textarea} />
      </label>
      <label className={label}>
        성공 기준 (한 줄에 하나)
        <textarea name="criteria" rows={3} placeholder={"출처 3개 이상\nA4 1장 분량"} className={textarea} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          산출물 형식
          <select name="outputFormat" defaultValue="보고서" className={select}>
            {OUTPUT_FORMATS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className={label}>
          우선순위
          <select name="priority" defaultValue="0" className={select}>
            <option value="0">보통</option>
            <option value="1">높음</option>
            <option value="2">긴급</option>
          </select>
        </label>
        <label className={label}>
          예산 한도 (원)
          <input name="budgetLimit" type="number" inputMode="numeric" min={100} max={1000000} defaultValue={5000} className={input} />
        </label>
        <label className={label}>
          마감
          <input name="deadline" type="date" className={input} />
        </label>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">자율성 수준</legend>
        {AUTONOMIES.map((a) => (
          <label key={a} className="flex min-h-11 items-center gap-3 rounded-lg border border-black/15 px-3 text-sm dark:border-white/15">
            <input type="radio" name="autonomy" value={a} defaultChecked={a === defaultAutonomy} className="size-5" />
            <span>
              <b>{AUTONOMY_LABEL[a]}</b> — {AUTONOMY_HELP[a]}
            </span>
          </label>
        ))}
      </fieldset>
      <label className={label}>
        담당 리더
        <select name="leaderId" defaultValue="" className={select}>
          <option value="">자동 지정 (리더 직급)</option>
          {leaders.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        참고 자료 (URL·메모)
        <textarea name="references" rows={3} maxLength={8000} placeholder="https://… 한 줄에 하나, 또는 참고할 내용" className={textarea} />
      </label>
      <button type="submit" disabled={pending} className={button}>
        {pending ? "시작하는 중" : "미션 시작"}
      </button>
      <Message state={state} />
    </form>
  );
}

export function MissionSettingsForm({ id, autonomy, budgetLimit }: { id: string; autonomy: Autonomy; budgetLimit: number }) {
  const [state, action, pending] = useActionState(updateMissionSettings, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <label className={label}>
        자율성 수준
        <select name="autonomy" defaultValue={autonomy} className={select}>
          {AUTONOMIES.map((a) => (
            <option key={a} value={a}>
              {AUTONOMY_LABEL[a]} — {AUTONOMY_HELP[a]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        예산 한도 (원)
        <input name="budgetLimit" type="number" inputMode="numeric" min={0} max={1000000} defaultValue={budgetLimit} className={input} />
      </label>
      <button type="submit" disabled={pending} className={button}>
        저장
      </button>
      <Message state={state} />
    </form>
  );
}

/** 미션 대화에 끼어들기 — 리더에게 전달 (화면 아래 고정) */
export function NoteForm({ id, disabled }: { id: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState(sendMissionNote, undefined);
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <form
      action={async (fd) => {
        await action(fd);
        if (ref.current) ref.current.value = "";
      }}
      className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0 flex flex-col gap-1 border-t border-black/10 bg-background/95 p-3 backdrop-blur dark:border-white/15"
    >
      <input type="hidden" name="id" value={id} />
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          name="content"
          rows={2}
          maxLength={2000}
          required
          disabled={disabled}
          placeholder="리더에게 메시지 (예: 20대 시청자 위주로 봐 주세요)"
          className={textarea}
          aria-label="리더에게 메시지"
        />
        <button type="submit" disabled={pending || disabled} className={`${button} shrink-0`}>
          {pending ? "보내는 중" : "보내기"}
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}
