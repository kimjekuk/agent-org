"use client";

import { useActionState } from "react";
import { useT } from "@/components/I18n";
import { button, errorText, input } from "@/lib/ui";
import { saveDoc } from "./actions";

const label = "flex flex-col gap-1 text-sm font-semibold";

/** 지식 문서 쓰기·고치기 */
export function DocForm({ doc }: { doc?: { id: string; title: string; content: string; tags: string[] } }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveDoc, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      {doc && <input type="hidden" name="id" value={doc.id} />}
      <label className={label}>
        {t("제목")}
        <input name="title" required maxLength={200} defaultValue={doc?.title} className={input} placeholder={t("예: 숏폼 트렌드 조사 방법")} />
      </label>
      <label className={label}>
        {t("내용 (마크다운)")}
        <textarea
          name="content"
          required
          rows={12}
          defaultValue={doc?.content}
          className="w-full rounded-lg border border-black/20 bg-transparent p-3 text-base dark:border-white/20"
          placeholder={t("에이전트가 참고할 자료·노하우·기준을 적어 주세요")}
        />
      </label>
      <label className={label}>
        {t("태그 (쉼표로 구분)")}
        <input name="tags" defaultValue={doc?.tags.join(", ")} className={input} placeholder={t("예: 숏폼, 트렌드")} />
      </label>
      <button type="submit" disabled={pending} className={button}>
        {pending ? t("저장 중") : t("저장")}
      </button>
      {state?.error && <p className={errorText}>{state.error}</p>}
    </form>
  );
}
