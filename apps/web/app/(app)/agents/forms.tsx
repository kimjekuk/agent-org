"use client";

import { type AgentLanguage, LANGUAGES } from "@agentorg/shared/agents/language";
import { PERSONALITY_TYPES, type PersonalityType, SPEECH_TONES, type SpeechTone } from "@agentorg/shared/agents/personality";
import {
  ACCESSORY_NAMES,
  type Avatar,
  COLOR_NAMES,
  FACE_NAMES,
  HAIR_COLORS,
  HAIR_NAMES,
  levelLook,
  OUTFIT_NAMES,
  SHIRT_COLORS,
  SKIN_TONES,
  type ToolPermissions,
  TOOL_NAMES,
} from "@agentorg/shared/agents/templates";
import { useActionState, useRef, useState } from "react";
import type { T } from "@agentorg/shared/i18n";
import { AgentAvatar } from "@/components/AgentAvatar";
import { useT } from "@/components/I18n";
import { PixelSprite } from "@/components/PixelSprite";
import { button, errorText, input } from "@/lib/ui";
import { type FormState, hireAgent, saveAvatar, sendDirective, updateAgent } from "./actions";

function Message({ state }: { state: FormState }) {
  if (state?.error) return <p className={errorText}>{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>;
  return null;
}

const select = `${input} appearance-none`;

export function HireForm({ templates }: { templates: { key: string; title: string; name: string }[] }) {
  const t = useT();
  const [state, action, pending] = useActionState(hireAgent, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <select name="template" className={select} aria-label={t("역할")} defaultValue={templates[0]?.key}>
        {templates.map((r) => (
          <option key={r.key} value={r.key}>
            {r.title}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <input name="name" placeholder={t("이름")} maxLength={20} required className={input} aria-label={t("이름")} />
        <button type="submit" disabled={pending} className={`${button} shrink-0`}>
          {t("채용")}
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

/** 직접 지시 입력 — 모바일에서 화면 아래에 붙는다 (PRD F017: 지시 입력창 하단 고정) */
export function DirectiveForm({ agentId, disabled }: { agentId: string; disabled?: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(sendDirective, undefined);
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <form
      id="directive"
      action={async (fd) => {
        await action(fd);
        if (ref.current) ref.current.value = "";
      }}
      className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0 flex flex-col gap-1 border-t border-black/10 bg-background/95 p-3 backdrop-blur dark:border-white/15"
    >
      <input type="hidden" name="id" value={agentId} />
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          name="content"
          rows={2}
          maxLength={4000}
          required
          placeholder={t("지시를 입력하세요 (예: 2026년 AI 에이전트 동향을 5줄로 정리해줘)")}
          className={`${input} h-auto min-h-11 py-2`}
          aria-label={t("지시")}
        />
        <button type="submit" disabled={pending || disabled} className={`${button} shrink-0`}>
          {pending ? t("보내는 중") : t("지시")}
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

interface ProfileProps {
  agent: {
    id: string;
    name: string;
    rank: string;
    personality: string | null;
    personalityType: string | null;
    speechTone: string | null;
    language: string | null;
    skills: string[];
    supervisorId: string | null;
    modelPrimary: string | null;
    modelEconomy: string | null;
    maxTurns: number;
    budgetLimit: number | null;
    toolPermissions: ToolPermissions;
  };
  supervisors: { id: string; name: string }[];
  models: readonly { id: string; label: string }[];
}

export function ProfileForm({ agent, supervisors, models }: ProfileProps) {
  const t = useT();
  const [state, action, pending] = useActionState(updateAgent, undefined);
  const field = "flex flex-col gap-1 text-sm";
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={agent.id} />
      <label className={field}>
        {t("이름")}
        <input name="name" defaultValue={agent.name} maxLength={20} required className={input} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={field}>
          {t("직급")}
          <select name="rank" defaultValue={agent.rank} className={select}>
            <option value="LEADER">{t("리더")}</option>
            <option value="MANAGER">{t("팀장")}</option>
            <option value="MEMBER">{t("팀원")}</option>
          </select>
        </label>
        <label className={field}>
          {t("상사")}
          <select name="supervisorId" defaultValue={agent.supervisorId ?? ""} className={select}>
            <option value="">{t("없음")}</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={field}>
        {t("성격 유형 (일하는 방식·말투)")}
        <select name="personalityType" defaultValue={agent.personalityType ?? ""} className={select}>
          <option value="">{t("정하지 않음")}</option>
          {(Object.keys(PERSONALITY_TYPES) as PersonalityType[]).map((k) => (
            <option key={k} value={k}>
              {PERSONALITY_TYPES[k].emoji} {t(PERSONALITY_TYPES[k].label)} — {t(PERSONALITY_TYPES[k].desc)}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        {t("말투")}
        <select name="speechTone" defaultValue={agent.speechTone ?? ""} className={select}>
          <option value="">{t("성격 유형대로")}</option>
          {(Object.keys(SPEECH_TONES) as SpeechTone[]).map((k) => (
            <option key={k} value={k}>
              {t(SPEECH_TONES[k].label)} — “{t(SPEECH_TONES[k].example)}”
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        {t("사용 언어 (결과물·보고)")}
        <select name="language" defaultValue={agent.language ?? ""} className={select}>
          <option value="">{t("조직 기본값")}</option>
          {(Object.keys(LANGUAGES) as AgentLanguage[]).map((k) => (
            <option key={k} value={k}>
              {LANGUAGES[k].label}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        {t("성격 (자유 입력)")}
        <input name="personality" defaultValue={agent.personality ?? ""} maxLength={200} className={input} />
      </label>
      <label className={field}>
        {t("특기 (쉼표로 구분)")}
        <input name="skills" defaultValue={agent.skills.join(", ")} className={input} />
      </label>

      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="mb-1">{t("도구 권한 (기본 꺼짐)")}</legend>
        {(Object.keys(TOOL_NAMES) as (keyof ToolPermissions)[]).map((k) => (
          <label key={k} className="flex min-h-11 items-center gap-3">
            <input type="checkbox" name={`tool_${k}`} defaultChecked={Boolean(agent.toolPermissions[k])} className="h-5 w-5" />
            {t(TOOL_NAMES[k])}
            {k === "web_search" && <span className="text-xs opacity-60">{t("회당 {n}원", { n: 14 })}</span>}
            {k === "code_exec" && <span className="text-xs opacity-60">{t("Sonnet·Opus만")}</span>}
          </label>
        ))}
      </fieldset>

      <label className={field}>
        {t("기본 모델")}
        <select key={agent.modelPrimary ?? ""} name="modelPrimary" defaultValue={agent.modelPrimary ?? models[0].id} className={select}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {t(m.label)}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        {t("절약 모드 모델 (예산 80% 이상)")}
        <select name="modelEconomy" defaultValue={agent.modelEconomy ?? models[1].id} className={select}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {t(m.label)}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={field}>
          {t("최대 턴 수")}
          <input name="maxTurns" type="number" min={1} max={200} defaultValue={agent.maxTurns} className={input} />
        </label>
        <label className={field}>
          {t("예산 한도 (원, 비우면 없음)")}
          <input name="budgetLimit" type="number" min={0} step={100} defaultValue={agent.budgetLimit ?? ""} className={input} />
        </label>
      </div>


      <button type="submit" disabled={pending} className={button}>
        {pending ? t("저장 중…") : t("프로필 저장")}
      </button>
      <Message state={state} />
    </form>
  );
}

// ── F202 캐릭터 꾸미기: 미리보기 + 버튼으로 고르기 (타이핑 없음) ─────────────────────

type Part = keyof Required<Avatar>;
/** 파츠 이름표 (HAIR_NAMES 등 공통 이름은 t(name)으로 번역) */
function partsOf(t: T): { key: Part; label: string; options: readonly { name: string; swatch?: string }[] }[] {
  return [
    { key: "hair", label: t("머리 모양"), options: HAIR_NAMES.map((name) => ({ name: t(name) })) },
    { key: "hairColor", label: t("머리색"), options: HAIR_COLORS.map((c) => ({ name: t(c.name), swatch: c.hex })) },
    { key: "skin", label: t("피부색"), options: SKIN_TONES.map((c) => ({ name: t(c.name), swatch: c.hex })) },
    { key: "face", label: t("표정"), options: FACE_NAMES.map((name) => ({ name: t(name) })) },
    { key: "outfit", label: t("옷"), options: OUTFIT_NAMES.map((name) => ({ name: t(name) })) },
    { key: "color", label: t("옷 색"), options: COLOR_NAMES.map((name, i) => ({ name: t(name), swatch: SHIRT_COLORS[i] })) },
    { key: "accessory", label: t("액세서리"), options: ACCESSORY_NAMES.map((name) => ({ name: t(name) })) },
  ];
}

export function CharacterEditor({ agentId, avatar, level }: { agentId: string; avatar: Required<Avatar>; level: number }) {
  const t = useT();
  const PARTS = partsOf(t);
  const [state, action, pending] = useActionState(saveAvatar, undefined);
  const [a, setA] = useState(avatar);
  const look = levelLook(level);
  const changed = PARTS.some((p) => a[p.key] !== avatar[p.key]);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={agentId} />
      {PARTS.map((p) => (
        <input key={p.key} type="hidden" name={p.key} value={a[p.key]} />
      ))}
      <div className="flex items-end justify-center gap-6 rounded-xl bg-black/5 p-3 dark:bg-white/10">
        <AgentAvatar avatar={a} size={88} level={level} label={t("미리보기")} />
        <svg viewBox="-10 -24 20 26" width={66} height={86} shapeRendering="crispEdges" aria-label={t("사무실 캐릭터 미리보기")} role="img">
          <ellipse cx={0} cy={0} rx={5} ry={1.5} fill="#000" opacity={0.2} />
          <PixelSprite avatar={a} />
        </svg>
      </div>
      <p className="text-center text-xs opacity-70">
        {t("레벨 외형: {look}", { look: look.label ? `${look.badge} ${t(look.label)} (Lv.${level})` : t("Lv.3 별 · Lv.5 은메달 · Lv.7 금메달 · Lv.10 왕관") })}
      </p>
      {PARTS.map((p) => (
        <fieldset key={p.key} className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold">{p.label}</legend>
          <div className="flex flex-wrap gap-2">
            {p.options.map((o, i) => (
              <button
                key={o.name}
                type="button"
                onClick={() => setA({ ...a, [p.key]: i })}
                aria-pressed={a[p.key] === i}
                className={`flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ${a[p.key] === i ? "bg-foreground text-background" : "bg-black/5 dark:bg-white/10"}`}
              >
                {o.swatch && <span className="inline-block h-4 w-4 rounded-full border border-black/20" style={{ background: o.swatch }} aria-hidden />}
                {o.name}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setA(avatar)} disabled={!changed} className="h-11 rounded-lg bg-black/5 text-sm font-semibold disabled:opacity-40 dark:bg-white/10">
          {t("되돌리기")}
        </button>
        <button type="submit" disabled={pending || !changed} className={button}>
          {pending ? t("저장 중…") : t("캐릭터 저장")}
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}
