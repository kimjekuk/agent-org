// 캐릭터 아바타 — 파츠 조합 SVG (PRD 2장: 머리 4 × 표정 4 × 색 6)
import type { Avatar } from "@agentorg/shared/agents/templates";

const COLORS = ["#FCD34D", "#F9A8D4", "#7DD3FC", "#86EFAC", "#C4B5FD", "#FDBA74"];
const HAIR = "#3F3A36";

export function AgentAvatar({ avatar, size = 48, label }: { avatar?: Partial<Avatar> | null; size?: number; label?: string }) {
  const hair = avatar?.hair ?? 0;
  const face = avatar?.face ?? 0;
  const color = COLORS[(avatar?.color ?? 0) % COLORS.length];

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={label ?? "에이전트 아바타"} className="shrink-0">
      <circle cx="32" cy="32" r="31" fill={color} />
      {/* 얼굴 */}
      <circle cx="32" cy="36" r="17" fill="#FFF1E6" />
      {/* 머리 */}
      {hair === 0 && <path d="M15 34 Q14 16 32 15 Q50 16 49 34 L46 26 Q32 22 18 26 Z" fill={HAIR} />}
      {hair === 1 && (
        <g fill={HAIR}>
          <circle cx="20" cy="24" r="6" />
          <circle cx="28" cy="19" r="6" />
          <circle cx="36" cy="19" r="6" />
          <circle cx="44" cy="24" r="6" />
        </g>
      )}
      {hair === 2 && (
        <g fill={HAIR}>
          <path d="M16 32 Q16 17 32 17 Q48 17 48 32 Q40 23 32 24 Q24 23 16 32 Z" />
          <circle cx="32" cy="13" r="5" />
        </g>
      )}
      {hair === 3 && (
        <g>
          <path d="M14 27 Q32 6 50 27 Z" fill="#1F2937" />
          <rect x="12" y="25" width="40" height="4" rx="2" fill="#1F2937" />
        </g>
      )}
      {/* 표정 */}
      <g fill="#3F3A36" stroke="#3F3A36" strokeWidth="2" strokeLinecap="round">
        {face === 3 ? (
          <>
            <circle cx="26" cy="35" r="2" stroke="none" />
            <path d="M35 35 L41 35" fill="none" />
          </>
        ) : (
          <>
            <circle cx="26" cy="35" r={face === 2 ? 2.6 : 2} stroke="none" />
            <circle cx="38" cy="35" r={face === 2 ? 2.6 : 2} stroke="none" />
          </>
        )}
        {face === 0 && <path d="M27 42 Q32 47 37 42" fill="none" />}
        {face === 1 && <path d="M28 44 L36 44" fill="none" />}
        {face === 2 && <circle cx="32" cy="44" r="2.5" fill="none" />}
        {face === 3 && <path d="M27 42 Q32 46 37 42" fill="none" />}
      </g>
    </svg>
  );
}
