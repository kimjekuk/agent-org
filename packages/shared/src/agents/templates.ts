// 에이전트 템플릿 (PRD 5장 F005 채용, 2장 첫 조직 템플릿 — 2026-10-18 확정)
import { DEFAULT_MODELS } from "../llm/pricing";
import type { PersonalityType } from "./personality";

/** 캐릭터 파츠 (PRD 2장 + F202 꾸미기). F202에서 늘어난 항목은 없으면 기본값 */
export interface Avatar {
  hair: number; // HAIR_NAMES
  face: number; // FACE_NAMES
  color: number; // 옷 색 COLOR_NAMES
  hairColor?: number; // HAIR_COLORS
  skin?: number; // SKIN_TONES
  outfit?: number; // OUTFIT_NAMES
  accessory?: number; // ACCESSORY_NAMES
}
export const HAIR_NAMES = ["단발", "곱슬", "묶음", "모자", "긴머리", "짧은 머리"] as const;
export const FACE_NAMES = ["웃음", "진지", "놀람", "윙크"] as const;
export const COLOR_NAMES = ["노랑", "분홍", "하늘", "연두", "보라", "주황"] as const;
/** 옷 색 (COLOR_NAMES 순서) */
export const SHIRT_COLORS = ["#F2B33D", "#EC6FA9", "#3FA7E0", "#4DBF6B", "#9B7BE0", "#F08A3C"] as const;
export const HAIR_COLORS = [
  { name: "검정", hex: "#3F3A36" },
  { name: "갈색", hex: "#7B4A2A" },
  { name: "금발", hex: "#E3B54A" },
  { name: "빨강", hex: "#B9472E" },
  { name: "파랑", hex: "#3B5BA9" },
  { name: "회색", hex: "#9CA3AF" },
] as const;
export const SKIN_TONES = [
  { name: "밝은", hex: "#FFE0C2" },
  { name: "중간", hex: "#F1C29A" },
  { name: "구릿빛", hex: "#C98E62" },
  { name: "짙은", hex: "#8D5A3B" },
] as const;
export const OUTFIT_NAMES = ["티셔츠", "셔츠·넥타이", "후드", "정장"] as const;
export const ACCESSORY_NAMES = ["없음", "안경", "헤드셋", "리본", "꽃"] as const;

/** 저장된 값(옛 3항목 포함)을 범위 안의 값으로 맞춘다 */
export function normalizeAvatar(raw: unknown): Required<Avatar> {
  const a = (raw ?? {}) as Partial<Record<keyof Avatar, unknown>>;
  const pick = (v: unknown, n: number) => {
    const x = Number(v);
    return Number.isInteger(x) && x >= 0 && x < n ? x : 0;
  };
  return {
    hair: pick(a.hair, HAIR_NAMES.length),
    face: pick(a.face, FACE_NAMES.length),
    color: pick(a.color, COLOR_NAMES.length),
    hairColor: pick(a.hairColor, HAIR_COLORS.length),
    skin: pick(a.skin, SKIN_TONES.length),
    outfit: pick(a.outfit, OUTFIT_NAMES.length),
    accessory: pick(a.accessory, ACCESSORY_NAMES.length),
  };
}

/** F202 레벨별 외형: 3 별 · 5 은메달 · 7 금메달 · 10 왕관 (레벨로 자동, 저장하지 않음) */
export function levelLook(level: number): { badge: string | null; ring: string | null; label: string | null } {
  if (level >= 10) return { badge: "👑", ring: "#F59E0B", label: "왕관" };
  if (level >= 7) return { badge: "🥇", ring: "#EAB308", label: "금메달" };
  if (level >= 5) return { badge: "🥈", ring: "#94A3B8", label: "은메달" };
  if (level >= 3) return { badge: "⭐", ring: null, label: "별" };
  return { badge: null, ring: null, label: null };
}

/** F202 사무실 테마 (조직 설정) */
export const OFFICE_THEMES = {
  DEFAULT: { label: "기본 (나무)", floor: "#E7CFA6", plank: "#D9BD8F", wall: "#6B5A4E", frame: "#4B3B33", meeting: "#E9EEF2", leader: "#F1E3C7", pantry: "#EDE7DD", rug: "#C7D2FE", text: "#6B5A4E" },
  MODERN: { label: "모던 (회색)", floor: "#E5E7EB", plank: "#D1D5DB", wall: "#4B5563", frame: "#1F2937", meeting: "#F3F4F6", leader: "#F9FAFB", pantry: "#E5E7EB", rug: "#BFDBFE", text: "#4B5563" },
  FOREST: { label: "숲 (초록)", floor: "#D9E8C4", plank: "#C5DAA9", wall: "#4D6B3C", frame: "#2F4426", meeting: "#E8F3E1", leader: "#EEF5E6", pantry: "#E3EDD8", rug: "#FDE68A", text: "#3F5A31" },
  NIGHT: { label: "밤 (어두운)", floor: "#3A3F58", plank: "#333850", wall: "#1E2235", frame: "#11131F", meeting: "#4A5070", leader: "#454B68", pantry: "#40465F", rug: "#4C3D7A", text: "#C7CBE0" },
} as const;
export type OfficeTheme = keyof typeof OFFICE_THEMES;
export function officeTheme(key: string | null | undefined) {
  return OFFICE_THEMES[(key && key in OFFICE_THEMES ? key : "DEFAULT") as OfficeTheme];
}

/** 도구 권한 (PRD F005: 기본 OFF). 웹 검색 · 문서 작성 · F107 품질 검토 담당(QA) */
export type ToolPermissions = {
  web_search?: boolean;
  document?: boolean;
  /** F107: 미션 Task 결과를 리더 대신 검토한다 */
  qa_review?: boolean;
  /** F110: Anthropic 샌드박스에서 파이썬 실행 (계산·표·데이터 정리) */
  code_exec?: boolean;
};
export const TOOL_NAMES: Record<keyof ToolPermissions, string> = {
  web_search: "웹 검색",
  document: "문서 작성 (산출물 저장)",
  qa_review: "품질 검토 담당 (QA) — 리더 대신 Task 결과 검토",
  code_exec: "코드 실행 (계산·표·데이터 정리)",
};

export interface AgentTemplate {
  key: string;
  title: string; // 템플릿 이름 (채용 화면)
  name: string;
  rank: "LEADER" | "MANAGER" | "MEMBER";
  personality: string;
  personalityType: PersonalityType;
  skills: string[];
  avatar: Avatar;
  toolPermissions: ToolPermissions;
}

/** 콘텐츠 제작팀 4명. 리더가 맨 앞 (나머지의 상사) */
export const CONTENT_TEAM: AgentTemplate[] = [
  { key: "leader", title: "리더", name: "하나", rank: "LEADER", personality: "차분하고 꼼꼼함", personalityType: "METICULOUS", skills: ["기획", "업무 분배", "최종 검토"], avatar: { hair: 0, face: 1, color: 4 }, toolPermissions: { document: true } },
  { key: "researcher", title: "리서처", name: "두리", rank: "MEMBER", personality: "호기심 많고 끈기 있음", personalityType: "ANALYTIC", skills: ["웹 검색", "자료 정리", "출처 확인"], avatar: { hair: 3, face: 2, color: 2 }, toolPermissions: { web_search: true, document: true } },
  { key: "writer", title: "작가", name: "세찬", rank: "MEMBER", personality: "밝고 표현력이 좋음", personalityType: "CREATIVE", skills: ["글쓰기", "요약", "구성"], avatar: { hair: 1, face: 0, color: 0 }, toolPermissions: { document: true } },
  { key: "reviewer", title: "검수 (QA)", name: "네모", rank: "MEMBER", personality: "깐깐하고 정확함", personalityType: "METICULOUS", skills: ["사실 확인", "맞춤법", "품질 점검"], avatar: { hair: 2, face: 3, color: 3 }, toolPermissions: { document: true, qa_review: true } },
];

/** 채용 화면의 역할 템플릿 (PRD F005: 리더/리서처/작가/검수/기획). 이름은 채용할 때 정한다 */
export const ROLE_TEMPLATES: AgentTemplate[] = [
  ...CONTENT_TEAM,
  { key: "planner", title: "기획", name: "", rank: "MEMBER", personality: "체계적이고 실용적임", personalityType: "DRIVEN", skills: ["기획안 작성", "일정 정리", "아이디어 정리"], avatar: { hair: 0, face: 0, color: 5 }, toolPermissions: { document: true } },
];

export const AGENT_DEFAULTS = {
  modelPrimary: DEFAULT_MODELS.primary,
  modelEconomy: DEFAULT_MODELS.economy,
  maxTurns: 20,
} as const;

/** 채용할 때의 기본 모델: 웹 검색·코드 실행 권한이 있으면 그 도구가 되는 Sonnet, 아니면 Haiku (2026-10-18·19 결정) */
export function defaultModelFor(perms: ToolPermissions): string {
  return perms.web_search || perms.code_exec ? DEFAULT_MODELS.search : DEFAULT_MODELS.primary;
}
