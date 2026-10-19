// 에이전트 템플릿 (PRD 5장 F005 채용, 2장 첫 조직 템플릿 — 2026-10-18 확정)
import { DEFAULT_MODELS } from "../llm/pricing";
import type { PersonalityType } from "./personality";

/** 캐릭터 파츠 (PRD 2장): 머리 4 × 표정 4 × 색 6 */
export interface Avatar {
  hair: number; // 0 단발 · 1 곱슬 · 2 묶음 · 3 모자
  face: number; // 0 웃음 · 1 진지 · 2 놀람 · 3 윙크
  color: number; // 0~5
}
export const HAIR_NAMES = ["단발", "곱슬", "묶음", "모자"] as const;
export const FACE_NAMES = ["웃음", "진지", "놀람", "윙크"] as const;
export const COLOR_NAMES = ["노랑", "분홍", "하늘", "연두", "보라", "주황"] as const;

/** 도구 권한 (PRD F005: 기본 OFF). MVP 도구: 웹 검색 + 문서 작성 */
export type ToolPermissions = {
  web_search?: boolean;
  document?: boolean;
};
export const TOOL_NAMES: Record<keyof ToolPermissions, string> = { web_search: "웹 검색", document: "문서 작성 (산출물 저장)" };

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
  { key: "reviewer", title: "검수", name: "네모", rank: "MEMBER", personality: "깐깐하고 정확함", personalityType: "METICULOUS", skills: ["사실 확인", "맞춤법", "품질 점검"], avatar: { hair: 2, face: 3, color: 3 }, toolPermissions: { document: true } },
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

/** 채용할 때의 기본 모델: 웹 검색 권한이 있으면 검색되는 Sonnet, 아니면 Haiku (2026-10-18 결정) */
export function defaultModelFor(perms: ToolPermissions): string {
  return perms.web_search ? DEFAULT_MODELS.search : DEFAULT_MODELS.primary;
}
