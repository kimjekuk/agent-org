"use client";

// F201 사무실 뷰: 직접 그린 픽셀아트 SVG (외부 타일셋 없음). 캐릭터는 상태가 바뀌면 새 자리로 걸어가듯 이동하고,
// 누르면 아래에서 카드가 올라와 바로 지시할 수 있다. 화면 갱신은 LiveRefresh(SSE)가 서버 데이터를 다시 읽어 온다.
import {
  deskAt,
  LEADER_DESK,
  MEETING_TABLE,
  OFFICE_H,
  OFFICE_W,
  ROOMS,
} from "@agentorg/shared/office";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { type FormState, sendDirective } from "@/app/(app)/agents/actions";
import { AgentAvatar } from "@/components/AgentAvatar";
import type { OfficeAgent } from "@/lib/office";
import { button, errorText, input } from "@/lib/ui";

const SHIRT = ["#F2B33D", "#EC6FA9", "#3FA7E0", "#4DBF6B", "#9B7BE0", "#F08A3C"];
const HAIR = "#3F3A36";
const SKIN = "#FFE0C2";

const CSS = `
.office-agent { transition: transform 1.6s ease-in-out; cursor: pointer; }
.office-agent:focus { outline: none; }
.office-agent:focus-visible .office-tag { stroke: #2563EB; stroke-width: 1; }
@keyframes office-type { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-1px) } }
.office-typing .office-arms { animation: office-type .35s steps(2) infinite; }
@keyframes office-dot { 0%,20% { opacity: .2 } 50% { opacity: 1 } 100% { opacity: .2 } }
.office-dot { animation: office-dot 1.2s infinite; }
.office-dot:nth-child(2) { animation-delay: .2s } .office-dot:nth-child(3) { animation-delay: .4s }
@keyframes office-blink { 50% { opacity: .3 } }
.office-alert { animation: office-blink 1s steps(2) infinite; }
@keyframes office-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-1px) } }
.office-idle { animation: office-bob 2.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .office-agent { transition: none } .office-typing .office-arms, .office-dot, .office-alert, .office-idle { animation: none }
}`;

export function Office({ agents, deskCount, full = false }: { agents: OfficeAgent[]; deskCount: number; full?: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const selected = agents.find((a) => a.id === selectedId) ?? null;
  const workingDesks = new Set(agents.filter((a) => a.status === "WORKING" && a.place.zone === "DESK" && a.place.seat?.kind === "DESK").map((a) => (a.place.seat as { index: number }).index));
  const leaderWorking = agents.some((a) => a.status === "WORKING" && a.place.zone === "LEADER");

  return (
    <div className="flex flex-col gap-2">
      {full && (
        <div className="flex items-center gap-2 text-sm">
          <span className="opacity-70">확대</span>
          {[1, 1.5, 2, 3].map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoom(z)}
              className={`h-11 min-w-11 rounded-lg px-3 font-semibold ${zoom === z ? "bg-foreground text-background" : "bg-black/5 dark:bg-white/10"}`}
            >
              {z}×
            </button>
          ))}
        </div>
      )}
      <div className={`overflow-auto rounded-xl border border-black/10 dark:border-white/15 ${full ? "max-h-[calc(100dvh-14rem)]" : ""}`}>
        <svg
          viewBox={`0 0 ${OFFICE_W} ${OFFICE_H}`}
          style={{ width: `${zoom * 100}%`, display: "block", imageRendering: "pixelated" }}
          shapeRendering="crispEdges"
          role="img"
          aria-label={`사무실: ${agents.map((a) => `${a.name} ${a.badge.label}`).join(", ") || "에이전트 없음"}`}
        >
          <style>{CSS}</style>
          <Floor />
          <LeaderRoom working={leaderWorking} />
          <MeetingRoom />
          <Pantry />
          {Array.from({ length: Math.max(deskCount, 1) }, (_, i) => (
            <Desk key={i} index={i} on={workingDesks.has(i)} empty={i >= deskCount} />
          ))}
          <Lounge />
          {agents.map((a) => (
            <Character key={a.id} agent={a} selected={a.id === selectedId} onSelect={() => setSelectedId(a.id)} />
          ))}
        </svg>
      </div>
      {selected && <AgentSheet agent={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

// ── 바닥·방 ─────────────────────────────────────────────

function Floor() {
  return (
    <g>
      <rect x={0} y={0} width={OFFICE_W} height={OFFICE_H} fill="#4B3B33" />
      {/* 나무 바닥 */}
      <rect x={4} y={4} width={OFFICE_W - 8} height={OFFICE_H - 8} fill="#E7CFA6" />
      {Array.from({ length: 31 }, (_, i) => (
        <rect key={i} x={4} y={10 + i * 8} width={OFFICE_W - 8} height={1} fill="#D9BD8F" />
      ))}
      {/* 벽 사이 칸막이 */}
      <rect x={96} y={4} width={4} height={84} fill="#6B5A4E" />
      <rect x={216} y={4} width={4} height={84} fill="#6B5A4E" />
      <rect x={4} y={88} width={312} height={4} fill="#6B5A4E" />
      {/* 문 (칸막이 아래쪽 틈) */}
      <rect x={140} y={88} width={24} height={4} fill="#E7CFA6" />
      <rect x={252} y={88} width={24} height={4} fill="#E7CFA6" />
      {/* 창문 */}
      {[16, 120, 236].map((x) => (
        <g key={x}>
          <rect x={x} y={0} width={36} height={4} fill="#9BD3F5" />
          <rect x={x + 17} y={0} width={2} height={4} fill="#E8F6FD" />
        </g>
      ))}
    </g>
  );
}

function LeaderRoom({ working }: { working: boolean }) {
  const r = ROOMS.leader;
  return (
    <g>
      <rect x={r.x} y={r.y} width={r.w - 4} height={r.h} fill="#F1E3C7" />
      {/* 유리 칸막이 */}
      <rect x={r.x + r.w - 6} y={r.y} width={2} height={r.h - 24} fill="#9BD3F5" opacity={0.9} />
      <rect x={r.x} y={r.y + r.h - 2} width={r.w - 30} height={2} fill="#9BD3F5" opacity={0.9} />
      {/* 리더 책상 */}
      <rect x={LEADER_DESK.x} y={LEADER_DESK.y} width={LEADER_DESK.w} height={LEADER_DESK.h} fill="#8B5E3C" />
      <rect x={LEADER_DESK.x} y={LEADER_DESK.y + LEADER_DESK.h} width={LEADER_DESK.w} height={2} fill="#6E4A2F" />
      <Monitor x={LEADER_DESK.x + 15} y={LEADER_DESK.y - 6} on={working} />
      <rect x={LEADER_DESK.x + 4} y={LEADER_DESK.y + 4} width={6} height={4} fill="#F5F5F4" />
      <rect x={42} y={50} width={12} height={8} fill="#374151" />
      {/* 화분·책장 */}
      <Plant x={8} y={66} />
      <rect x={8} y={8} width={14} height={20} fill="#7A5232" />
      {["#E57373", "#64B5F6", "#81C784", "#FFD54F"].map((c, i) => (
        <rect key={c} x={9 + i * 3} y={10} width={2} height={7} fill={c} />
      ))}
      {["#BA68C8", "#4DB6AC", "#FF8A65"].map((c, i) => (
        <rect key={c} x={9 + i * 4} y={19} width={3} height={7} fill={c} />
      ))}
      <text x={78} y={14} fontSize={6} textAnchor="middle" fill="#6B5A4E">
        리더
      </text>
    </g>
  );
}

function MeetingRoom() {
  const t = MEETING_TABLE;
  return (
    <g>
      <rect x={100} y={4} width={116} height={84} fill="#E9EEF2" />
      {/* 화이트보드·시계 */}
      <rect x={140} y={6} width={40} height={9} fill="#FFFFFF" stroke="#9CA3AF" strokeWidth={1} />
      <rect x={144} y={9} width={16} height={1} fill="#3B82F6" />
      <rect x={144} y={12} width={24} height={1} fill="#EF4444" />
      <circle cx={196} cy={12} r={5} fill="#FFFFFF" stroke="#6B7280" strokeWidth={1} />
      <rect x={196} y={9} width={1} height={3} fill="#111827" />
      <rect x={196} y={12} width={3} height={1} fill="#111827" />
      {/* 회의 테이블 */}
      <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={4} fill="#8B5E3C" />
      <rect x={t.x + 2} y={t.y + 2} width={t.w - 4} height={2} fill="#A87650" />
      <rect x={t.x + 10} y={t.y + 8} width={8} height={6} fill="#F5F5F4" />
      <rect x={t.x + 40} y={t.y + 9} width={6} height={4} fill="#93C5FD" />
      <text x={110} y={14} fontSize={6} fill="#6B7280">
        회의실
      </text>
    </g>
  );
}

function Pantry() {
  return (
    <g>
      <rect x={220} y={4} width={96} height={84} fill="#EDE7DD" />
      {/* 조리대 */}
      <rect x={224} y={10} width={88} height={14} fill="#B0A090" />
      <rect x={224} y={24} width={88} height={2} fill="#8C7B6B" />
      {/* 커피머신 */}
      <rect x={230} y={6} width={12} height={14} fill="#374151" />
      <rect x={233} y={14} width={6} height={4} fill="#F5F5F4" />
      <rect x={239} y={8} width={2} height={2} fill="#EF4444" />
      {/* 정수기 */}
      <rect x={252} y={6} width={10} height={20} fill="#E5E7EB" />
      <rect x={253} y={4} width={8} height={8} fill="#7DD3FC" />
      {/* 복합기 */}
      <rect x={280} y={44} width={26} height={18} fill="#9CA3AF" />
      <rect x={282} y={46} width={22} height={4} fill="#4B5563" />
      <rect x={286} y={56} width={14} height={2} fill="#F9FAFB" />
      {/* 작은 테이블·의자 */}
      <rect x={236} y={50} width={24} height={14} rx={2} fill="#C08A5B" />
      <rect x={228} y={54} width={6} height={6} fill="#6B7280" />
      <rect x={262} y={54} width={6} height={6} fill="#6B7280" />
      <Plant x={300} y={70} />
      <text x={268} y={86} fontSize={6} textAnchor="middle" fill="#6B5A4E">
        탕비실
      </text>
    </g>
  );
}

function Desk({ index, on, empty }: { index: number; on: boolean; empty: boolean }) {
  const d = deskAt(index);
  return (
    <g opacity={empty ? 0.45 : 1}>
      <rect x={d.x} y={d.y} width={d.w} height={d.h} fill="#A0703F" />
      <rect x={d.x} y={d.y + d.h} width={d.w} height={2} fill="#7A5232" />
      <Monitor x={d.x + 13} y={d.y - 6} on={on} />
      <rect x={d.x + 3} y={d.y + 4} width={6} height={4} fill="#F5F5F4" />
      <rect x={d.x + 30} y={d.y + 3} width={4} height={5} fill="#F4F4F5" />
      {/* 의자 */}
      <rect x={d.x + 15} y={d.y + 18} width={10} height={8} fill="#4B5563" />
    </g>
  );
}

function Monitor({ x, y, on }: { x: number; y: number; on: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={14} height={9} fill="#1F2937" />
      <rect x={x + 1} y={y + 1} width={12} height={6} fill={on ? "#60A5FA" : "#374151"} />
      {on && <rect x={x + 2} y={y + 2} width={7} height={1} fill="#DBEAFE" />}
      <rect x={x + 6} y={y + 9} width={2} height={2} fill="#1F2937" />
    </g>
  );
}

function Lounge() {
  return (
    <g>
      {/* 러그 */}
      <rect x={104} y={214} width={128} height={38} fill="#C7D2FE" opacity={0.7} />
      {/* 소파 */}
      <rect x={18} y={218} width={80} height={10} fill="#5E8C61" />
      <rect x={18} y={226} width={80} height={10} fill="#76A879" />
      <rect x={14} y={218} width={4} height={18} fill="#5E8C61" />
      <rect x={98} y={218} width={4} height={18} fill="#5E8C61" />
      {/* 커피 테이블 */}
      <rect x={140} y={232} width={60} height={10} fill="#8B5E3C" />
      <rect x={150} y={234} width={6} height={4} fill="#F5F5F4" />
      <rect x={180} y={234} width={4} height={4} fill="#B45309" />
      {/* TV */}
      <rect x={250} y={200} width={40} height={20} fill="#111827" />
      <rect x={252} y={202} width={36} height={16} fill="#1E3A8A" />
      <rect x={256} y={206} width={12} height={2} fill="#93C5FD" />
      <rect x={266} y={220} width={8} height={4} fill="#374151" />
      {/* 책장 */}
      <rect x={292} y={226} width={20} height={24} fill="#7A5232" />
      {["#E57373", "#64B5F6", "#81C784", "#FFD54F", "#BA68C8"].map((c, i) => (
        <rect key={c} x={294 + (i % 3) * 6} y={228 + Math.floor(i / 3) * 11} width={4} height={9} fill={c} />
      ))}
      <Plant x={240} y={236} />
      <Plant x={6} y={238} />
      <text x={60} y={250} fontSize={6} textAnchor="middle" fill="#6B5A4E">
        휴게 공간
      </text>
    </g>
  );
}

function Plant({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x + 2} y={y + 8} width={8} height={6} fill="#B45309" />
      <rect x={x} y={y + 2} width={12} height={7} fill="#4CAF50" />
      <rect x={x + 3} y={y} width={6} height={4} fill="#66BB6A" />
    </g>
  );
}

// ── 캐릭터 ─────────────────────────────────────────────

function Character({ agent, selected, onSelect }: { agent: OfficeAgent; selected: boolean; onSelect: () => void }) {
  const { x, y } = agent.place.at;
  const shirt = SHIRT[(agent.avatar?.color ?? 0) % SHIRT.length];
  const hair = agent.avatar?.hair ?? 0;
  const face = agent.avatar?.face ?? 0;
  const typing = agent.status === "WORKING" && agent.activity === "WORK";
  const tagW = Math.max(18, agent.name.length * 6 + 6);

  return (
    <g
      className={`office-agent ${typing ? "office-typing" : ""}`}
      style={{ transform: `translate(${x}px, ${y}px)` }}
      role="button"
      tabIndex={0}
      aria-label={`${agent.name} — ${agent.badge.label}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {/* 누르기 쉬운 영역 */}
      <rect x={-10} y={-30} width={20} height={32} fill="transparent" />
      <g className={agent.status === "IDLE" ? "office-idle" : undefined}>
        <ellipse cx={0} cy={0} rx={5} ry={1.5} fill="#000" opacity={0.2} />
        <g transform="translate(-6,-17)">
          {/* 다리 */}
          <rect x={3} y={13} width={2} height={3} fill="#374151" />
          <rect x={7} y={13} width={2} height={3} fill="#374151" />
          {/* 몸 */}
          <rect x={2} y={8} width={8} height={6} fill={shirt} />
          <g className="office-arms">
            <rect x={1} y={9} width={1} height={4} fill={shirt} />
            <rect x={10} y={9} width={1} height={4} fill={shirt} />
            <rect x={1} y={13} width={1} height={1} fill={SKIN} />
            <rect x={10} y={13} width={1} height={1} fill={SKIN} />
          </g>
          {/* 얼굴 */}
          <rect x={3} y={2} width={6} height={6} fill={SKIN} />
          <rect x={4} y={4} width={1} height={1} fill="#3F3A36" />
          {face === 3 ? <rect x={7} y={4} width={1} height={1} fill={SKIN} /> : <rect x={7} y={4} width={1} height={1} fill="#3F3A36" />}
          {face === 3 && <rect x={6} y={4} width={2} height={1} fill="#3F3A36" />}
          <rect x={5} y={6} width={face === 1 ? 2 : 2} height={1} fill={face === 2 ? "#3F3A36" : "#E08A7A"} />
          {/* 머리 */}
          {hair === 0 && (
            <>
              <rect x={3} y={1} width={6} height={2} fill={HAIR} />
              <rect x={2} y={2} width={1} height={4} fill={HAIR} />
              <rect x={9} y={2} width={1} height={4} fill={HAIR} />
            </>
          )}
          {hair === 1 && <rect x={2} y={0} width={8} height={3} fill={HAIR} />}
          {hair === 2 && (
            <>
              <rect x={3} y={1} width={6} height={2} fill={HAIR} />
              <rect x={5} y={-1} width={2} height={2} fill={HAIR} />
            </>
          )}
          {hair === 3 && (
            <>
              <rect x={2} y={0} width={8} height={2} fill="#1F2937" />
              <rect x={1} y={2} width={10} height={1} fill="#1F2937" />
            </>
          )}
        </g>
      </g>
      <StatusBubble agent={agent} />
      {/* 이름표 */}
      <g className="office-tag-group">
        <rect className="office-tag" x={-tagW / 2} y={-27} width={tagW} height={7} rx={2} fill={selected ? "#2563EB" : "#FFFFFF"} opacity={0.92} />
        <text x={0} y={-22} fontSize={5} textAnchor="middle" fill={selected ? "#FFFFFF" : "#111827"} fontWeight={700}>
          {agent.name}
        </text>
      </g>
    </g>
  );
}

function StatusBubble({ agent }: { agent: OfficeAgent }) {
  const at = { x: 7, y: -20 };
  if (agent.status === "BLOCKED")
    return (
      <g className="office-alert">
        <rect x={at.x} y={at.y} width={7} height={8} rx={1} fill="#DC2626" />
        <text x={at.x + 3.5} y={at.y + 6.5} fontSize={6} textAnchor="middle" fill="#FFFFFF" fontWeight={700}>
          !
        </text>
      </g>
    );
  if (agent.status === "PAUSED") return <Emoji at={at} text="⏸" />;
  if (agent.status === "WORKING") {
    if (agent.activity === "MEETING") return <Emoji at={at} text="💬" />;
    if (agent.activity === "REVIEW") return <Emoji at={at} text="🔍" />;
    return (
      <g>
        <rect x={at.x} y={at.y + 1} width={11} height={6} rx={2} fill="#FFFFFF" opacity={0.95} />
        {[0, 1, 2].map((i) => (
          <rect key={i} className="office-dot" x={at.x + 2 + i * 3} y={at.y + 3.5} width={1.5} height={1.5} fill="#2563EB" />
        ))}
      </g>
    );
  }
  return <Emoji at={at} text={agent.resting ? "💤" : "☕"} />;
}

function Emoji({ at, text }: { at: { x: number; y: number }; text: string }) {
  return (
    <text x={at.x + 4} y={at.y + 7} fontSize={7} textAnchor="middle">
      {text}
    </text>
  );
}

// ── 누르면 올라오는 카드: 상태·지금 하는 일·바로 지시·프로필 ─────────────────

function AgentSheet({ agent, onClose }: { agent: OfficeAgent; onClose: () => void }) {
  const [state, action, pending] = useActionState<FormState, FormData>(sendDirective, undefined);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label={`${agent.name} 카드`}
      className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-3xl rounded-t-2xl border border-black/10 bg-background p-4 shadow-2xl md:bottom-0 dark:border-white/15"
    >
      <div className="flex items-start gap-3">
        <AgentAvatar avatar={agent.avatar} size={48} label={agent.name} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {agent.name}{" "}
            <span className="text-xs font-normal opacity-60">
              Lv.{agent.level} {agent.rankLabel}
            </span>
          </p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${agent.badge.className}`}>{agent.badge.label}</span>
          {agent.doing && <p className="mt-1 break-words text-sm opacity-80">{agent.doing}</p>}
        </div>
        <button type="button" onClick={onClose} className="h-11 w-11 shrink-0 rounded-lg bg-black/5 text-lg dark:bg-white/10" aria-label="닫기">
          ✕
        </button>
      </div>
      <form
        action={async (fd) => {
          await action(fd);
          if (ref.current) ref.current.value = "";
        }}
        className="mt-3 flex flex-col gap-1"
      >
        <input type="hidden" name="id" value={agent.id} />
        <div className="flex items-end gap-2">
          <textarea
            ref={ref}
            name="content"
            rows={2}
            maxLength={4000}
            required
            placeholder={`${agent.name}에게 지시`}
            className={`${input} h-auto min-h-11 py-2`}
            aria-label={`${agent.name}에게 지시`}
          />
          <button type="submit" disabled={pending} className={`${button} shrink-0`}>
            {pending ? "보내는 중" : "지시"}
          </button>
        </div>
        {state?.error && <p className={errorText}>{state.error}</p>}
        {state?.ok && <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>}
      </form>
      <Link href={`/agents/${agent.id}`} className="mt-2 flex h-11 items-center justify-center rounded-lg bg-black/5 text-sm font-semibold dark:bg-white/10">
        프로필·대화 보기 ›
      </Link>
    </div>
  );
}
