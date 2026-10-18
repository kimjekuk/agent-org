"use client";

import { COLOR_NAMES, FACE_NAMES, HAIR_NAMES, type ToolPermissions, TOOL_NAMES } from "@agentorg/shared/agents/templates";
import { useActionState, useRef } from "react";
import { button, errorText, input } from "@/lib/ui";
import { type FormState, hireAgent, sendDirective, updateAgent } from "./actions";

function Message({ state }: { state: FormState }) {
  if (state?.error) return <p className={errorText}>{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>;
  return null;
}

const select = `${input} appearance-none`;

export function HireForm({ templates }: { templates: { key: string; title: string; name: string }[] }) {
  const [state, action, pending] = useActionState(hireAgent, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <select name="template" className={select} aria-label="역할" defaultValue={templates[0]?.key}>
        {templates.map((t) => (
          <option key={t.key} value={t.key}>
            {t.title}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <input name="name" placeholder="이름" maxLength={20} required className={input} aria-label="이름" />
        <button type="submit" disabled={pending} className={`${button} shrink-0`}>
          채용
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

/** 직접 지시 입력 — 모바일에서 화면 아래에 붙는다 (PRD F017: 지시 입력창 하단 고정) */
export function DirectiveForm({ agentId, disabled }: { agentId: string; disabled?: boolean }) {
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
          placeholder="지시를 입력하세요 (예: 2026년 AI 에이전트 동향을 5줄로 정리해줘)"
          className={`${input} h-auto min-h-11 py-2`}
          aria-label="지시"
        />
        <button type="submit" disabled={pending || disabled} className={`${button} shrink-0`}>
          {pending ? "보내는 중" : "지시"}
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
    skills: string[];
    supervisorId: string | null;
    modelPrimary: string | null;
    modelEconomy: string | null;
    maxTurns: number;
    budgetLimit: number | null;
    toolPermissions: ToolPermissions;
    avatar: { hair: number; face: number; color: number };
  };
  supervisors: { id: string; name: string }[];
  models: readonly { id: string; label: string }[];
}

export function ProfileForm({ agent, supervisors, models }: ProfileProps) {
  const [state, action, pending] = useActionState(updateAgent, undefined);
  const field = "flex flex-col gap-1 text-sm";
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={agent.id} />
      <label className={field}>
        이름
        <input name="name" defaultValue={agent.name} maxLength={20} required className={input} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={field}>
          직급
          <select name="rank" defaultValue={agent.rank} className={select}>
            <option value="LEADER">리더</option>
            <option value="MANAGER">팀장</option>
            <option value="MEMBER">팀원</option>
          </select>
        </label>
        <label className={field}>
          상사
          <select name="supervisorId" defaultValue={agent.supervisorId ?? ""} className={select}>
            <option value="">없음</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={field}>
        성격
        <input name="personality" defaultValue={agent.personality ?? ""} maxLength={200} className={input} />
      </label>
      <label className={field}>
        특기 (쉼표로 구분)
        <input name="skills" defaultValue={agent.skills.join(", ")} className={input} />
      </label>

      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="mb-1">도구 권한 (기본 꺼짐)</legend>
        {(Object.keys(TOOL_NAMES) as (keyof ToolPermissions)[]).map((k) => (
          <label key={k} className="flex min-h-11 items-center gap-3">
            <input type="checkbox" name={`tool_${k}`} defaultChecked={Boolean(agent.toolPermissions[k])} className="h-5 w-5" />
            {TOOL_NAMES[k]}
            {k === "web_search" && <span className="text-xs opacity-60">회당 14원</span>}
          </label>
        ))}
      </fieldset>

      <label className={field}>
        기본 모델
        <select name="modelPrimary" defaultValue={agent.modelPrimary ?? models[0].id} className={select}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        절약 모드 모델 (예산 80% 이상)
        <select name="modelEconomy" defaultValue={agent.modelEconomy ?? models[1].id} className={select}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={field}>
          최대 턴 수
          <input name="maxTurns" type="number" min={1} max={200} defaultValue={agent.maxTurns} className={input} />
        </label>
        <label className={field}>
          예산 한도 (원, 비우면 없음)
          <input name="budgetLimit" type="number" min={0} step={100} defaultValue={agent.budgetLimit ?? ""} className={input} />
        </label>
      </div>

      <fieldset className="grid grid-cols-3 gap-2 text-sm">
        <legend className="mb-1">캐릭터</legend>
        {(
          [
            ["hair", "머리", HAIR_NAMES, agent.avatar.hair],
            ["face", "표정", FACE_NAMES, agent.avatar.face],
            ["color", "색", COLOR_NAMES, agent.avatar.color],
          ] as const
        ).map(([name, label, names, value]) => (
          <label key={name} className={field}>
            {label}
            <select name={name} defaultValue={value} className={select}>
              {names.map((n, i) => (
                <option key={n} value={i}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>

      <button type="submit" disabled={pending} className={button}>
        {pending ? "저장 중…" : "프로필 저장"}
      </button>
      <Message state={state} />
    </form>
  );
}
