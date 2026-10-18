"use client";

import { AUTONOMY_HELP, AUTONOMY_LABEL, type Autonomy, OUTPUT_FORMATS } from "@agentorg/shared/missions";
import { useActionState, useState } from "react";
import { button, buttonGhost, errorText, input } from "@/lib/ui";
import { createSchedule, type FormState, runScheduleNow, saveWorkHours } from "./actions";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const select = `${input} appearance-none`;
const textarea = `${input} h-auto min-h-11 py-2`;
const label = "flex flex-col gap-1 text-sm font-semibold";

function Message({ state }: { state: FormState }) {
  if (state?.error) return <p className={errorText}>{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>;
  return null;
}

function DayPicker({ name, defaults }: { name: string; defaults: number[] }) {
  return (
    <div className="grid grid-cols-7 gap-1">
      {WEEKDAYS.map((d, i) => (
        <label key={d} className="flex h-11 cursor-pointer items-center justify-center rounded-lg border border-black/15 text-sm font-semibold has-[:checked]:bg-foreground has-[:checked]:text-background dark:border-white/20">
          <input type="checkbox" name={name} value={i} defaultChecked={defaults.includes(i)} className="sr-only" />
          {d}
        </label>
      ))}
    </div>
  );
}

/** 반복 미션 · 예약 지시 만들기 */
export function ScheduleForm({ agents, defaultAutonomy }: { agents: { id: string; name: string }[]; defaultAutonomy: Autonomy }) {
  const [state, action, pending] = useActionState(createSchedule, undefined);
  const [kind, setKind] = useState<"MISSION" | "DIRECTIVE">("MISSION");
  const [repeat, setRepeat] = useState("WEEKLY");
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="종류">
        {(["MISSION", "DIRECTIVE"] as const).map((k) => (
          <label key={k} className={`flex h-11 cursor-pointer items-center justify-center rounded-lg text-sm font-semibold ${kind === k ? "bg-foreground text-background" : "bg-black/5 dark:bg-white/10"}`}>
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
            {k === "MISSION" ? "🎯 반복 미션" : "✍️ 예약 지시"}
          </label>
        ))}
      </div>

      {kind === "MISSION" ? (
        <>
          <label className={label}>
            주제
            <input name="topic" required minLength={2} maxLength={200} placeholder="예: 이번 주 숏폼 트렌드 정리" className={input} />
          </label>
          <label className={label}>
            목표
            <textarea name="goal" rows={2} maxLength={1000} className={textarea} />
          </label>
          <label className={label}>
            성공 기준 (한 줄에 하나)
            <textarea name="criteria" rows={2} className={textarea} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>
              형식
              <select name="outputFormat" defaultValue="보고서" className={select}>
                {OUTPUT_FORMATS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className={label}>
              회차당 예산 (원)
              <input name="budgetLimit" type="number" inputMode="numeric" min={100} max={1000000} defaultValue={3000} className={input} />
            </label>
          </div>
          <label className={label}>
            자율성
            <select name="autonomy" defaultValue={defaultAutonomy} className={select}>
              {(Object.keys(AUTONOMY_LABEL) as Autonomy[]).map((a) => (
                <option key={a} value={a}>
                  {AUTONOMY_LABEL[a]} — {AUTONOMY_HELP[a]}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          <label className={label}>
            받을 에이전트
            <select name="agentId" required className={select} defaultValue="">
              <option value="" disabled>
                골라 주세요
              </option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            지시
            <textarea name="content" required rows={3} maxLength={4000} placeholder="예: 어제 나온 AI 뉴스 5개를 요약해줘" className={textarea} />
          </label>
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className={label}>
          반복
          <select name="repeat" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={select}>
            <option value="ONCE">한 번</option>
            <option value="DAILY">매일</option>
            <option value="WEEKLY">매주</option>
            <option value="MONTHLY">매월</option>
          </select>
        </label>
        <label className={label}>
          시각
          <input name="time" type="time" required defaultValue="09:00" className={input} />
        </label>
      </div>
      {repeat === "WEEKLY" && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold">요일</legend>
          <DayPicker name="weekdays" defaults={[1]} />
        </fieldset>
      )}
      {repeat === "MONTHLY" && (
        <label className={label}>
          날짜 (1~28일)
          <input name="dayOfMonth" type="number" inputMode="numeric" min={1} max={28} defaultValue={1} className={input} />
        </label>
      )}
      {repeat === "ONCE" && (
        <label className={label}>
          날짜
          <input name="runDate" type="date" required className={input} />
        </label>
      )}
      <button type="submit" disabled={pending} className={button}>
        {pending ? "저장 중" : "예약하기"}
      </button>
      <Message state={state} />
    </form>
  );
}

export function RunNowForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(runScheduleNow, undefined);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className={`${buttonGhost} w-full`}>
        {pending ? "실행 중" : "▶ 지금 실행"}
      </button>
      <Message state={state} />
    </form>
  );
}

export function WorkHoursForm({ value }: { value: { enabled: boolean; days: number[]; start: string; end: string } }) {
  const [state, action, pending] = useActionState(saveWorkHours, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
        <input type="checkbox" name="enabled" defaultChecked={value.enabled} className="size-5" />
        근무 시간 정하기
      </label>
      <DayPicker name="days" defaults={value.days} />
      <div className="grid grid-cols-2 gap-2">
        <label className={label}>
          시작
          <input name="start" type="time" defaultValue={value.start} className={input} />
        </label>
        <label className={label}>
          끝
          <input name="end" type="time" defaultValue={value.end} className={input} />
        </label>
      </div>
      <p className="text-xs opacity-70">근무 시간 밖에는 예약 실행과 에이전트끼리의 일이 다음 근무 시작까지 기다립니다. 내가 직접 내린 지시·미션은 언제든 처리합니다.</p>
      <button type="submit" disabled={pending} className={button}>
        저장
      </button>
      <Message state={state} />
    </form>
  );
}
