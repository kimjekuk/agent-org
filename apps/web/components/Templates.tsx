"use client";

// F208 지시 템플릿 버튼 줄 (누르면 칸을 채우기만 한다 — 확인 후 보내기) + '템플릿으로 저장' 버튼
import type { DirectiveTemplate } from "@agentorg/shared/directiveTemplates";
import { useActionState } from "react";
import { saveTemplate } from "@/app/(app)/templates/actions";
import { useT } from "@/components/I18n";

export function TemplateChips({ templates, onPick }: { templates: DirectiveTemplate[]; onPick: (content: string) => void }) {
  const t = useT();
  if (templates.length === 0) return null;
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label={t("자주 쓰는 지시")}>
      {templates.map((x) => (
        <button
          key={x.id}
          type="button"
          onClick={() => onPick(x.content)}
          className="h-9 shrink-0 rounded-full border border-black/15 px-3 text-sm font-semibold dark:border-white/20"
        >
          {x.builtin ? "📋" : "⭐"} {x.title}
        </button>
      ))}
    </div>
  );
}

/** 보낸 지시·미션 주제를 템플릿으로 저장 */
export function SaveTemplateButton({ content, className = "" }: { content: string; className?: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveTemplate, undefined);
  if (state?.ok) return <span className={`text-xs opacity-70 ${className}`}>⭐ {state.ok}</span>;
  return (
    <form action={action} className={className}>
      <input type="hidden" name="content" value={content} />
      <button type="submit" disabled={pending} className="min-h-9 text-xs underline opacity-70" title={t("템플릿으로 저장")}>
        ⭐ {t("템플릿으로 저장")}
      </button>
      {state?.error && <span className="ml-2 text-xs text-red-600 dark:text-red-400">{state.error}</span>}
    </form>
  );
}

/** 설정: 템플릿 직접 추가 */
export function AddTemplateForm() {
  const t = useT();
  const [state, action, pending] = useActionState(saveTemplate, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input name="title" maxLength={20} placeholder={t("이름 (비우면 첫 줄)")} className="h-11 w-full rounded-lg border border-black/20 bg-transparent px-3 text-base dark:border-white/20" aria-label={t("이름")} />
      <textarea
        name="content"
        rows={3}
        maxLength={4000}
        required
        placeholder={t("지시 내용 (새 미션에서는 첫 줄이 주제, 나머지가 목표)")}
        className="min-h-11 w-full rounded-lg border border-black/20 bg-transparent px-3 py-2 text-base dark:border-white/20"
        aria-label={t("지시 내용")}
      />
      <button type="submit" disabled={pending} className="h-11 rounded-lg bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50">
        {t("템플릿 추가")}
      </button>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>}
    </form>
  );
}
