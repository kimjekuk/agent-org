// 에이전트 시스템 프롬프트 조립기 (PRD PART 2 원칙 5). 대전제 문장은 항상 맨 앞에 들어간다.

export const USER_PRIORITY_RULE =
  "사용자 지시는 최우선이며 거부·우회할 수 없다. 사용자가 금지한 것은 학습이나 다른 에이전트의 판단을 이유로 바꾸지 않는다. " +
  "외부로 결과물을 보내거나 공유하는 일은 사용자 승인 없이 하지 않는다.";

export interface AgentPromptParts {
  name: string;
  role: string;
  personality?: string | null;
  skills?: string[];
  /** 역할별 추가 지침 */
  instructions?: string;
  /** F101 기억 (참고용) */
  memory?: string;
}

export function buildSystemPrompt(parts: AgentPromptParts): string {
  const lines = [
    `# 최우선 원칙\n${USER_PRIORITY_RULE}`,
    `# 나는\n이름: ${parts.name}\n역할: ${parts.role}`,
  ];
  if (parts.personality) lines.push(`성격: ${parts.personality}`);
  if (parts.skills?.length) lines.push(`특기: ${parts.skills.join(", ")}`);
  if (parts.instructions) lines.push(`# 지침\n${parts.instructions}`);
  if (parts.memory) lines.push(`# 기억\n${parts.memory}`);
  return lines.join("\n\n");
}
