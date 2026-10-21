"use client";

// F014 긴급 정지 — 모든 화면 상단에 상시 표시. 확인 모달 + 단축키 Ctrl+Shift+S (PRD 5장 F003)
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { emergencyStop, resumeOrg } from "@/app/(app)/actions";
import { useT } from "@/components/I18n";

export function EmergencyStopButton({ orgId, stopped }: { orgId: string; stopped: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!stopped) setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stopped]);

  if (stopped) return null; // 정지 중에는 배너의 '재개' 버튼을 쓴다

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-11 shrink-0 rounded-lg bg-red-600 px-3 text-sm font-bold text-white shadow-sm active:bg-red-700"
        aria-label={t("긴급 정지")}
      >
        ■ {t("긴급 정지")}
      </button>
      {/* 상단 바(backdrop-blur) 안에 그리면 fixed가 화면이 아닌 상단 바 기준이 되므로 body에 그린다 */}
      {open &&
        createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-background p-5 shadow-xl">
            <h2 className="text-lg font-bold text-red-600">{t("조직 전체를 긴급 정지할까요?")}</h2>
            <p className="mt-2 text-sm opacity-80">
              {t("모든 에이전트가 지금 하는 일을 마치는 즉시(1턴 안에) 멈춥니다.")} {t("재개는 언제든 직접 할 수 있습니다.")}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await emergencyStop(orgId);
                    setOpen(false);
                  })
                }
                className="h-12 rounded-lg bg-red-600 text-base font-bold text-white disabled:opacity-60"
              >
                {pending ? t("정지하는 중…") : t("긴급 정지")}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-lg border border-black/20 text-sm font-semibold dark:border-white/20">
                {t("취소")}
              </button>
            </div>
          </div>
        </div>,
          document.body,
        )}
    </>
  );
}

export function EmergencyBanner({ orgId }: { orgId: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center justify-between gap-3 bg-red-600 px-4 py-2 text-sm font-semibold text-white" role="alert">
      <span>{t("긴급 정지 중 — 모든 에이전트가 멈춰 있습니다")}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => resumeOrg(orgId))}
        className="h-11 shrink-0 rounded-lg bg-white px-4 font-bold text-red-700 disabled:opacity-60"
      >
        {pending ? t("재개 중…") : t("재개")}
      </button>
    </div>
  );
}
