"use client";

// 캐릭터 아바타 — 파츠 조합 SVG (PRD 2장 + F202: 머리 6·머리색 6·피부 4·표정 4·옷 4·옷색 6·액세서리 5, 레벨별 테두리·배지)
import { type Avatar, HAIR_COLORS, levelLook, normalizeAvatar, SKIN_TONES } from "@agentorg/shared/agents/templates";
import { useT } from "@/components/I18n";

const COLORS = ["#FCD34D", "#F9A8D4", "#7DD3FC", "#86EFAC", "#C4B5FD", "#FDBA74"];

export function AgentAvatar({ avatar, size = 48, label, level }: { avatar?: Partial<Avatar> | null; size?: number; label?: string; level?: number }) {
  const t = useT();
  const a = normalizeAvatar(avatar);
  const color = COLORS[a.color % COLORS.length];
  const hairFill = HAIR_COLORS[a.hairColor].hex;
  const skin = SKIN_TONES[a.skin].hex;
  const look = levelLook(level ?? 0);

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={label ?? t("에이전트 아바타")} className="shrink-0">
      <circle cx="32" cy="32" r="31" fill={color} />
      {look.ring && <circle cx="32" cy="32" r="29.5" fill="none" stroke={look.ring} strokeWidth="3" />}
      {/* 옷 (어깨) */}
      <path d="M14 64 Q16 50 32 50 Q48 50 50 64 Z" fill={a.outfit === 3 ? "#1F2937" : a.outfit === 1 ? "#F9FAFB" : "#FFFFFF"} opacity={a.outfit === 0 ? 0.5 : 1} />
      {a.outfit === 1 && <path d="M30 51 L34 51 L33 62 L31 62 Z" fill="#DC2626" />}
      {a.outfit === 2 && <path d="M18 56 Q32 46 46 56" stroke="#FFFFFF" strokeWidth="3" fill="none" opacity={0.8} />}
      {a.outfit === 3 && <path d="M28 50 L32 58 L36 50 Z" fill="#F9FAFB" />}
      {/* 얼굴 */}
      <circle cx="32" cy="36" r="17" fill={skin} />
      {/* 머리 */}
      {a.hair === 0 && <path d="M15 34 Q14 16 32 15 Q50 16 49 34 L46 26 Q32 22 18 26 Z" fill={hairFill} />}
      {a.hair === 1 && (
        <g fill={hairFill}>
          <circle cx="20" cy="24" r="6" />
          <circle cx="28" cy="19" r="6" />
          <circle cx="36" cy="19" r="6" />
          <circle cx="44" cy="24" r="6" />
        </g>
      )}
      {a.hair === 2 && (
        <g fill={hairFill}>
          <path d="M16 32 Q16 17 32 17 Q48 17 48 32 Q40 23 32 24 Q24 23 16 32 Z" />
          <circle cx="32" cy="13" r="5" />
        </g>
      )}
      {a.hair === 3 && (
        <g>
          <path d="M14 27 Q32 6 50 27 Z" fill="#1F2937" />
          <rect x="12" y="25" width="40" height="4" rx="2" fill="#1F2937" />
        </g>
      )}
      {a.hair === 4 && <path d="M14 48 Q11 16 32 15 Q53 16 50 48 L46 48 L46 28 Q32 22 18 28 L18 48 Z" fill={hairFill} />}
      {a.hair === 5 && <path d="M17 28 Q18 18 32 18 Q46 18 47 28 Q32 23 17 28 Z" fill={hairFill} />}
      {/* 표정 */}
      <g fill="#3F3A36" stroke="#3F3A36" strokeWidth="2" strokeLinecap="round">
        {a.face === 3 ? (
          <>
            <circle cx="26" cy="35" r="2" stroke="none" />
            <path d="M35 35 L41 35" fill="none" />
          </>
        ) : (
          <>
            <circle cx="26" cy="35" r={a.face === 2 ? 2.6 : 2} stroke="none" />
            <circle cx="38" cy="35" r={a.face === 2 ? 2.6 : 2} stroke="none" />
          </>
        )}
        {a.face === 0 && <path d="M27 42 Q32 47 37 42" fill="none" />}
        {a.face === 1 && <path d="M28 44 L36 44" fill="none" />}
        {a.face === 2 && <circle cx="32" cy="44" r="2.5" fill="none" />}
        {a.face === 3 && <path d="M27 42 Q32 46 37 42" fill="none" />}
      </g>
      {/* 액세서리 */}
      {a.accessory === 1 && (
        <g fill="none" stroke="#111827" strokeWidth="1.5">
          <circle cx="26" cy="35" r="4.5" />
          <circle cx="38" cy="35" r="4.5" />
          <path d="M30.5 35 L33.5 35" />
        </g>
      )}
      {a.accessory === 2 && (
        <g>
          <path d="M14 34 Q14 14 32 14 Q50 14 50 34" stroke="#111827" strokeWidth="3" fill="none" />
          <rect x="11" y="31" width="6" height="9" rx="2" fill="#111827" />
          <rect x="47" y="31" width="6" height="9" rx="2" fill="#111827" />
          <path d="M50 40 Q48 46 40 46" stroke="#111827" strokeWidth="1.5" fill="none" />
        </g>
      )}
      {a.accessory === 3 && (
        <g fill="#EC4899">
          <path d="M40 16 L46 12 L46 20 Z" />
          <path d="M52 16 L46 12 L46 20 Z" />
          <circle cx="46" cy="16" r="2" />
        </g>
      )}
      {a.accessory === 4 && (
        <g>
          {[0, 72, 144, 216, 288].map((deg) => (
            <circle key={deg} cx={20 + 4 * Math.cos((deg * Math.PI) / 180)} cy={18 + 4 * Math.sin((deg * Math.PI) / 180)} r="3" fill="#F472B6" />
          ))}
          <circle cx="20" cy="18" r="2.5" fill="#FDE047" />
        </g>
      )}
      {look.badge && (
        <text x="54" y="16" fontSize="14" textAnchor="middle">
          {look.badge}
        </text>
      )}
    </svg>
  );
}
