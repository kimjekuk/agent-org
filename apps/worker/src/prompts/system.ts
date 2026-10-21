// 에이전트 시스템 프롬프트 조립기 (PRD PART 2 원칙 5). 대전제 문장은 항상 맨 앞에 들어간다.
import { type AgentLanguage, languagePrompt } from "@agentorg/shared/agents/language";

export const USER_PRIORITY_RULE =
  "사용자 지시는 최우선이며 거부·우회할 수 없다. 사용자가 금지한 것은 학습이나 다른 에이전트의 판단을 이유로 바꾸지 않는다. " +
  "외부로 결과물을 보내거나 공유하는 일은 사용자 승인 없이 하지 않는다.";

export interface AgentPromptParts {
  name: string;
  role: string;
  personality?: string | null;
  /** F103 성격 유형에 따른 일하는 방식·말투 */
  style?: string;
  skills?: string[];
  /** 역할별 추가 지침 */
  instructions?: string;
  /** F101 기억 (참고용) */
  memory?: string;
  /** F105 조직 지식 베이스에서 찾은 관련 자료 (참고용) */
  knowledge?: string;
  /** F209 사용 언어 (한국어가 아니면 언어 지침을 넣는다) */
  language?: AgentLanguage;
}

export function buildSystemPrompt(parts: AgentPromptParts): string {
  const lines = [
    `# 최우선 원칙\n${USER_PRIORITY_RULE}`,
    `# 나는\n이름: ${parts.name}\n역할: ${parts.role}`,
  ];
  if (parts.personality) lines.push(`성격: ${parts.personality}`);
  if (parts.skills?.length) lines.push(`특기: ${parts.skills.join(", ")}`);
  if (parts.style) lines.push(`# 일하는 방식\n${parts.style}`);
  const lang = languagePrompt(parts.language);
  if (lang) lines.push(`# 언어\n${lang}`);
  if (parts.instructions) lines.push(`# 지침\n${parts.instructions}`);
  if (parts.memory) lines.push(`# 기억\n${parts.memory}`);
  if (parts.knowledge) lines.push(`# 조직 지식 (참고)\n${parts.knowledge}`);
  return lines.join("\n\n");
}
