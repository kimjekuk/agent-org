// LLM 제공사 추상화 (PRD 6장). 제공사 SDK는 이 인터페이스 구현체 안에서만 쓴다.
// 호출은 반드시 gateway.ts를 거친다 (CLAUDE.md 절대 규칙 2).

export type LLMMessage = { role: "user" | "assistant"; content: string };

export interface LLMRequest {
  model: string;
  system?: string;
  messages: LLMMessage[];
  maxTokens: number;
}

/** 한 번의 시도(대체 모델 포함)에서 쓴 토큰. 비용은 시도별 모델 요금으로 계산한다. */
export interface LLMUsageIteration {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export interface LLMResult {
  text: string;
  model: string; // 실제로 답한 모델 (대체 모델일 수 있음)
  stopReason: string | null;
  usage: LLMUsageIteration[];
}

export interface LLMProvider {
  readonly name: string; // "anthropic"
  complete(apiKey: string, request: LLMRequest): Promise<LLMResult>;
}
