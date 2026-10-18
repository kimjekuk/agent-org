// OpenAI 호환 Chat Completions 구현체 — OpenAI · Gemini(OpenAI 호환 엔드포인트) · DeepSeek (PRD 6장 어댑터 구조).
// SDK 없이 fetch로 부른다. 웹 검색은 지원하지 않는다 (2026-10-18 결정: 웹 검색은 Claude만).
import type { LLMProvider, LLMRequest, LLMResult } from "./provider";

interface Endpoint {
  name: string;
  url: string;
  /** OpenAI 최신 모델은 max_tokens 대신 max_completion_tokens를 받는다 */
  tokenParam: "max_tokens" | "max_completion_tokens";
}

export const OPENAI_COMPATIBLE: Record<string, Endpoint> = {
  openai: { name: "openai", url: "https://api.openai.com/v1/chat/completions", tokenParam: "max_completion_tokens" },
  gemini: { name: "gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", tokenParam: "max_tokens" },
  deepseek: { name: "deepseek", url: "https://api.deepseek.com/chat/completions", tokenParam: "max_tokens" },
};

/** 제공사 오류 — status는 설정 화면 연결 테스트가 401·429를 알아보는 데 쓴다 (Claude SDK 오류와 같은 모양) */
export class ProviderHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

interface ChatResponse {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

const TIMEOUT_MS = 10 * 60 * 1000;

export function createOpenAICompatibleProvider(endpoint: Endpoint, fetchImpl: typeof fetch = fetch): LLMProvider {
  return {
    name: endpoint.name,
    async complete(apiKey: string, req: LLMRequest): Promise<LLMResult> {
      const messages = [...(req.system ? [{ role: "system", content: req.system }] : []), ...req.messages.map((m) => ({ role: m.role, content: m.content }))];
      const res = await fetchImpl(endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: req.model, messages, [endpoint.tokenParam]: req.maxTokens }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        throw new ProviderHttpError(res.status, `${endpoint.name} 호출 실패 (${res.status})${detail ? `: ${detail}` : ""}`);
      }
      const data = (await res.json()) as ChatResponse;
      const choice = data.choices?.[0];
      const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      return {
        text: choice?.message?.content ?? "",
        model: data.model ?? req.model,
        stopReason: choice?.finish_reason ?? null,
        // 응답의 model은 날짜가 붙은 이름일 수 있어, 요금 계산은 요청한 모델 이름으로 한다
        usage: [
          {
            model: req.model,
            inputTokens: Math.max(0, (data.usage?.prompt_tokens ?? 0) - cached),
            outputTokens: data.usage?.completion_tokens ?? 0,
            cacheWriteTokens: 0,
            cacheReadTokens: cached,
          },
        ],
        webSearchRequests: 0,
        webSearchEnabled: false,
      };
    },
  };
}
