// F201·F202 도트 캐릭터 (12×17, 발 가운데가 원점). 사무실과 캐릭터 꾸미기 미리보기가 함께 쓴다
import { type Avatar, HAIR_COLORS, normalizeAvatar, SHIRT_COLORS, SKIN_TONES } from "@agentorg/shared/agents/templates";

const EYE = "#3F3A36";

export function PixelSprite({ avatar }: { avatar?: Partial<Avatar> | null }) {
  const a = normalizeAvatar(avatar);
  const shirt = SHIRT_COLORS[a.color];
  const hair = HAIR_COLORS[a.hairColor].hex;
  const skin = SKIN_TONES[a.skin].hex;
  // 옷: 0 티셔츠 · 1 셔츠·넥타이 · 2 후드 · 3 정장
  const sleeve = a.outfit === 3 ? "#1F2937" : shirt;
  const body = a.outfit === 1 ? "#F9FAFB" : a.outfit === 3 ? "#1F2937" : shirt;

  return (
    <g transform="translate(-6,-17)">
      {/* 다리 */}
      <rect x={3} y={13} width={2} height={3} fill={a.outfit === 3 ? "#111827" : "#374151"} />
      <rect x={7} y={13} width={2} height={3} fill={a.outfit === 3 ? "#111827" : "#374151"} />
      {/* 몸 */}
      <rect x={2} y={8} width={8} height={6} fill={body} />
      {a.outfit === 1 && <rect x={5} y={8} width={2} height={5} fill={shirt} />}
      {a.outfit === 2 && (
        <>
          <rect x={2} y={7} width={8} height={2} fill={shirt} />
          <rect x={4} y={11} width={4} height={2} fill="#000" opacity={0.15} />
          <rect x={4} y={9} width={1} height={2} fill="#F9FAFB" />
          <rect x={7} y={9} width={1} height={2} fill="#F9FAFB" />
        </>
      )}
      {a.outfit === 3 && (
        <>
          <rect x={5} y={8} width={2} height={3} fill="#F9FAFB" />
          <rect x={5} y={9} width={2} height={3} fill={shirt} />
        </>
      )}
      <g className="office-arms">
        <rect x={1} y={9} width={1} height={4} fill={sleeve} />
        <rect x={10} y={9} width={1} height={4} fill={sleeve} />
        <rect x={1} y={13} width={1} height={1} fill={skin} />
        <rect x={10} y={13} width={1} height={1} fill={skin} />
      </g>
      {/* 얼굴 */}
      <rect x={3} y={2} width={6} height={6} fill={skin} />
      <rect x={4} y={4} width={1} height={1} fill={EYE} />
      {a.face === 3 ? <rect x={6} y={4} width={2} height={1} fill={EYE} /> : <rect x={7} y={4} width={1} height={1} fill={EYE} />}
      <rect x={5} y={6} width={2} height={1} fill={a.face === 2 ? EYE : a.face === 1 ? "#B45F55" : "#E08A7A"} />
      {/* 머리: 0 단발 · 1 곱슬 · 2 묶음 · 3 모자 · 4 긴머리 · 5 짧은 머리 */}
      {a.hair === 0 && (
        <>
          <rect x={3} y={1} width={6} height={2} fill={hair} />
          <rect x={2} y={2} width={1} height={4} fill={hair} />
          <rect x={9} y={2} width={1} height={4} fill={hair} />
        </>
      )}
      {a.hair === 1 && <rect x={2} y={0} width={8} height={3} fill={hair} />}
      {a.hair === 2 && (
        <>
          <rect x={3} y={1} width={6} height={2} fill={hair} />
          <rect x={5} y={-1} width={2} height={2} fill={hair} />
        </>
      )}
      {a.hair === 3 && (
        <>
          <rect x={2} y={0} width={8} height={2} fill="#1F2937" />
          <rect x={1} y={2} width={10} height={1} fill="#1F2937" />
        </>
      )}
      {a.hair === 4 && (
        <>
          <rect x={3} y={1} width={6} height={2} fill={hair} />
          <rect x={2} y={2} width={1} height={8} fill={hair} />
          <rect x={9} y={2} width={1} height={8} fill={hair} />
        </>
      )}
      {a.hair === 5 && <rect x={3} y={1} width={6} height={1} fill={hair} />}
      {/* 액세서리: 1 안경 · 2 헤드셋 · 3 리본 · 4 꽃 */}
      {a.accessory === 1 && (
        <>
          <rect x={3} y={4} width={3} height={1} fill="#111827" opacity={0.8} />
          <rect x={6} y={4} width={3} height={1} fill="#111827" opacity={0.8} />
        </>
      )}
      {a.accessory === 2 && (
        <>
          <rect x={2} y={0} width={8} height={1} fill="#111827" />
          <rect x={1} y={3} width={2} height={3} fill="#111827" />
          <rect x={9} y={3} width={2} height={3} fill="#111827" />
          <rect x={9} y={6} width={2} height={1} fill="#EF4444" />
        </>
      )}
      {a.accessory === 3 && (
        <>
          <rect x={8} y={0} width={2} height={2} fill="#EC4899" />
          <rect x={10} y={0} width={1} height={1} fill="#EC4899" />
          <rect x={7} y={1} width={1} height={1} fill="#EC4899" />
        </>
      )}
      {a.accessory === 4 && (
        <>
          <rect x={2} y={1} width={2} height={2} fill="#FDE047" />
          <rect x={1} y={1} width={1} height={1} fill="#F472B6" />
          <rect x={4} y={1} width={1} height={1} fill="#F472B6" />
          <rect x={2} y={0} width={1} height={1} fill="#F472B6" />
        </>
      )}
    </g>
  );
}
