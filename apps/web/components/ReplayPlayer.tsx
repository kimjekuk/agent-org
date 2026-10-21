"use client";

// F204 미션 리플레이: 장면을 차례로 사무실 화면에 보여 준다. 재생·일시정지·속도(1·2·4배)·슬라이더·앞뒤 이동, 아래에 그 순간의 자막
import { type OfficeActivity, officeLayout } from "@agentorg/shared/office";
import { useEffect, useMemo, useState } from "react";
import { Office } from "@/components/Office";
import type { OfficeAgent } from "@/lib/office";

export interface ReplayPlayerAgent {
  id: string;
  name: string;
  rank: "LEADER" | "MANAGER" | "MEMBER";
  level: number;
  avatar: unknown;
}
export interface ReplayPlayerFrame {
  at: string;
  icon: string;
  text: string;
  states: Record<string, { status: "IDLE" | "WORKING" | "BLOCKED"; activity: OfficeActivity | null }>;
}

const RANK = { LEADER: "리더", MANAGER: "팀장", MEMBER: "팀원" } as const;
const BADGE = {
  WORKING: { label: "작업 중", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200" },
  BLOCKED: { label: "막힘", className: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200" },
  IDLE: { label: "대기", className: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200" },
};
const timeFmt = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });
const STEP_MS = 1600;

export function ReplayPlayer({ agents, frames, theme }: { agents: ReplayPlayerAgent[]; frames: ReplayPlayerFrame[]; theme?: string | null }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const last = frames.length - 1;

  useEffect(() => {
    if (!playing) return;
    if (i >= last) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setI((n) => Math.min(last, n + 1)), STEP_MS / speed);
    return () => clearTimeout(t);
  }, [playing, i, last, speed]);

  const frame = frames[i];
  const office = useMemo(() => {
    const states = frame?.states ?? {};
    const { placements, deskCount } = officeLayout(
      agents.map((a) => ({ id: a.id, rank: a.rank, status: states[a.id]?.status ?? "IDLE", activity: states[a.id]?.activity ?? null })),
    );
    const list: OfficeAgent[] = agents.map((a, k) => {
      const s = states[a.id] ?? { status: "IDLE" as const, activity: null };
      return {
        id: a.id,
        name: a.name,
        avatar: a.avatar as OfficeAgent["avatar"],
        rankLabel: RANK[a.rank],
        level: a.level,
        status: s.status,
        resting: false,
        badge: BADGE[s.status],
        activity: s.activity,
        doing: null,
        place: placements[k],
      };
    });
    return { list, deskCount };
  }, [agents, frame]);

  if (frames.length === 0) return <p className="text-sm opacity-70">아직 다시 볼 기록이 없습니다.</p>;

  const recent = frames.slice(Math.max(0, i - 3), i).reverse();
  return (
    <div className="flex flex-col gap-3">
      <Office agents={office.list} deskCount={office.deskCount} theme={theme} readOnly speed={speed} />
      <div className="rounded-xl bg-black/5 p-3 dark:bg-white/10" aria-live="polite">
        <p className="text-xs tabular-nums opacity-60">
          {i + 1} / {frames.length} · {timeFmt.format(new Date(frame.at))}
        </p>
        <p className="mt-1 break-words font-semibold">
          <span aria-hidden>{frame.icon}</span> {frame.text}
        </p>
        {recent.length > 0 && (
          <ul className="mt-2 flex flex-col gap-0.5 text-xs opacity-60">
            {recent.map((f) => (
              <li key={`${f.at}-${f.text}`} className="truncate">
                {f.icon} {f.text}
              </li>
            ))}
          </ul>
        )}
      </div>
      <input
        type="range"
        min={0}
        max={last}
        value={i}
        onChange={(e) => {
          setPlaying(false);
          setI(Number(e.target.value));
        }}
        className="h-11 w-full"
        aria-label="장면 이동"
      />
      <div className="grid grid-cols-4 gap-2">
        <button type="button" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0} className="h-11 rounded-lg bg-black/5 font-semibold disabled:opacity-40 dark:bg-white/10" aria-label="이전 장면">
          ◀
        </button>
        <button
          type="button"
          onClick={() => {
            if (i >= last) setI(0);
            setPlaying((p) => !p);
          }}
          className="col-span-2 h-11 rounded-lg bg-foreground font-semibold text-background"
        >
          {playing ? "⏸ 일시정지" : i >= last ? "↺ 처음부터" : "▶ 재생"}
        </button>
        <button type="button" onClick={() => setI((n) => Math.min(last, n + 1))} disabled={i >= last} className="h-11 rounded-lg bg-black/5 font-semibold disabled:opacity-40 dark:bg-white/10" aria-label="다음 장면">
          ▶
        </button>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="opacity-70">속도</span>
        {[1, 2, 4].map((s) => (
          <button key={s} type="button" onClick={() => setSpeed(s)} aria-pressed={speed === s} className={`h-11 min-w-11 rounded-lg px-3 font-semibold ${speed === s ? "bg-foreground text-background" : "bg-black/5 dark:bg-white/10"}`}>
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
