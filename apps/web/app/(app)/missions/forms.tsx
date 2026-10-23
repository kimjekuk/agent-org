"use client";

import { AUTONOMY_HELP, AUTONOMY_LABEL, type Autonomy, OUTPUT_FORMATS } from "@agentorg/shared/missions";
import { useActionState, useRef } from "react";
import type { DirectiveTemplate } from "@agentorg/shared/directiveTemplates";
import { useT } from "@/components/I18n";
import { TemplateChips } from "@/components/Templates";
import { button, errorText, input } from "@/lib/ui";
import { createMission, type FormState, replyMeeting, sendMissionNote, updateMissionSettings } from "./actions";

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
/** F208 템플릿 내용을 새 미션 칸에: 첫 줄 = 주제, 나머지 = 목표 (shared splitForMission과 같은 규칙) */
function splitForMission(content: string): { topic: string; goal: string } {
  const [first, ...rest] = content.trim().split("\n");
  return { topic: first.trim().slice(0, 200), goal: rest.join("\n").trim().slice(0, 1000) };
}

export function MissionForm({
  leaders,
  defaultAutonomy,
  templates = [],
  initial,
}: {
  leaders: { id: string; name: string }[];
  defaultAutonomy: Autonomy;
  templates?: DirectiveTemplate[];
  /** 대시보드에서 고른 템플릿 내용 */
  initial?: string;
}) {
  const [state, action, pending] = useActionState(createMission, undefined);
  const t = useT();
  const topicRef = useRef<HTMLInputElement>(null);
  const goalRef = useRef<HTMLTextAreaElement>(null);
  const start = initial ? splitForMission(initial) : null;
  return (
    <form action={action} className="flex flex-col gap-4">
      <TemplateChips
        templates={templates}
        onPick={(content) => {
          const v = splitForMission(content);
          if (topicRef.current) topicRef.current.value = v.topic;
          if (goalRef.current) goalRef.current.value = v.goal;
          topicRef.current?.focus();
        }}
      />
      <label className={label}>
        {t("주제 (필수)")}
        <input ref={topicRef} name="topic" required minLength={2} maxLength={200} defaultValue={start?.topic} placeholder={t("예: 2026년 숏폼 콘텐츠 트렌드")} className={input} />
      </label>
      <label className={label}>
        {t("목표")}
        <textarea ref={goalRef} name="goal" rows={2} maxLength={1000} defaultValue={start?.goal} placeholder={t("예: 다음 달 채널 기획에 쓸 근거 정리")} className={textarea} />
      </label>
      <label className={label}>
        {t("성공 기준 (한 줄에 하나)")}
        <textarea name="criteria" rows={3} placeholder={t("출처 3개 이상\nA4 1장 분량")} className={textarea} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          {t("산출물 형식")}
          <select name="outputFormat" defaultValue={OUTPUT_FORMATS[0]} className={select}>
            {OUTPUT_FORMATS.map((f) => (
              <option key={f} value={f}>
                {t(f)}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {t("우선순위")}
          <select name="priority" defaultValue="0" className={select}>
            <option value="0">{t("보통")}</option>
            <option value="1">{t("높음")}</option>
            <option value="2">{t("긴급")}</option>
          </select>
        </label>
        <label className={label}>
          {t("예산 한도 (원)")}
          <input name="budgetLimit" type="number" inputMode="numeric" min={100} max={1000000} defaultValue={5000} className={input} />
        </label>
        <label className={label}>
          {t("마감")}
          <input name="deadline" type="date" className={input} />
        </label>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">{t("자율성 수준")}</legend>
        {AUTONOMIES.map((a) => (
          <label key={a} className="flex min-h-11 items-center gap-3 rounded-lg border border-black/15 px-3 text-sm dark:border-white/15">
            <input type="radio" name="autonomy" value={a} defaultChecked={a === defaultAutonomy} className="size-5" />
            <span>
              <b>{t(AUTONOMY_LABEL[a])}</b> — {t(AUTONOMY_HELP[a])}
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex min-h-11 items-center gap-3 rounded-lg border border-black/15 px-3 text-sm dark:border-white/15">
        <input type="checkbox" name="meetings" defaultChecked={true} className="size-5" />
        <span>
          <b>{t("회의")}</b> — {t("시작 전 킥오프·끝난 뒤 회고 (팀원마다 AI 호출 1번씩 더)")}
        </span>
      </label>
      <label className={label}>
        {t("담당 리더")}
        <select name="leaderId" defaultValue="" className={select}>
          <option value="">{t("자동 지정 (리더 직급)")}</option>
          {leaders.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        {t("참고 자료 (URL·메모)")}
        <textarea name="references" rows={3} maxLength={8000} placeholder={t("https://… 한 줄에 하나, 또는 참고할 내용")} className={textarea} />
      </label>
      <button type="submit" disabled={pending} className={button}>
        {pending ? t("시작하는 중") : t("미션 시작")}
      </button>
      <Message state={state} />
    </form>
  );
}

export function MissionSettingsForm({ id, autonomy, budgetLimit, meetings }: { id: string; autonomy: Autonomy; budgetLimit: number; meetings: boolean }) {
  const [state, action, pending] = useActionState(updateMissionSettings, undefined);
  const t = useT();
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <label className={label}>
        {t("자율성 수준")}
        <select name="autonomy" defaultValue={autonomy} className={select}>
          {AUTONOMIES.map((a) => (
            <option key={a} value={a}>
              {t(AUTONOMY_LABEL[a])} — {t(AUTONOMY_HELP[a])}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        {t("예산 한도 (원)")}
        <input name="budgetLimit" type="number" inputMode="numeric" min={0} max={1000000} defaultValue={budgetLimit} className={input} />
      </label>
      <label className="flex min-h-11 items-center gap-3 rounded-lg border border-black/15 px-3 text-sm dark:border-white/15">
        <input type="checkbox" name="meetings" defaultChecked={meetings} className="size-5" />
        <span>
          <b>{t("회의")}</b> — {t("시작 전 킥오프·끝난 뒤 회고 (팀원마다 AI 호출 1번씩 더)")}
        </span>
      </label>
      <button type="submit" disabled={pending} className={button}>
        {t("저장")}
      </button>
      <Message state={state} />
    </form>
  );
}

/** 미션 대화에 끼어들기 — 리더에게 전달 (화면 아래 고정) */
export function NoteForm({ id, disabled }: { id: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState(sendMissionNote, undefined);
  const t = useT();
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
          placeholder={t("리더에게 메시지 (예: 20대 시청자 위주로 봐 주세요)")}
          className={textarea}
          aria-label={t("리더에게 메시지")}
        />
        <button type="submit" disabled={pending || disabled} className={`${button} shrink-0`}>
          {pending ? t("보내는 중") : t("보내기")}
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

/** F104 회의록 답글 — 진행 중이면 다음 발언·결론에, 끝난 회의면 리더가 결론을 다시 정리 */
export function MeetingReplyForm({ missionId, meetingId, disabled }: { missionId: string; meetingId: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState(replyMeeting, undefined);
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <form
      action={async (fd) => {
        await action(fd);
        if (ref.current) ref.current.value = "";
      }}
      className="flex flex-col gap-1"
    >
      <input type="hidden" name="id" value={missionId} />
      <input type="hidden" name="meetingId" value={meetingId} />
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          name="content"
          rows={2}
          maxLength={2000}
          required
          disabled={disabled}
          placeholder={t("회의에 의견 남기기 (예: 20대 위주로 봐 주세요)")}
          className={textarea}
          aria-label={t("회의 답글")}
        />
        <button type="submit" disabled={pending || disabled} className={`${button} shrink-0`}>
          {pending ? t("남기는 중") : t("답글")}
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}
