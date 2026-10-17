// Claude(Anthropic) 구현체. @anthropic-ai/sdk는 이 파일에서만 import한다 (guards.test가 검사).
import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, LLMRequest, LLMResult, LLMUsageIteration } from "./provider";

// 서버측 대체 모델(fallbacks: "default")을 지원하는 모델. Haiku 5.5는 지원하지 않는다.
const SERVER_FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);

export const anthropicProvider: LLMProvider = {
  name: "anthropic",

  async complete(apiKey: string, req: LLMRequest): Promise<LLMResult> {
    const client = new Anthropic({ apiKey });
    const fallback = SERVER_FALLBACK_MODELS.has(req.model);

    const response = await client.beta.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      ...(req.system ? { system: req.system } : {}),
      messages: req.messages,
      // 안전 분류기가 거절하면 Anthropic 권장 모델로 서버에서 다시 시도한다
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // usage.iterations가 시도별 실제 사용량 (거절된 시도 포함). 없으면 최상위 usage 하나.
    const iterations = response.usage.iterations ?? [];
    const usage: LLMUsageIteration[] =
      iterations.length > 0
        ? iterations
            .filter((it) => it.type === "message" || it.type === "fallback_message")
            .map((it) => ({
              model: it.model ?? req.model,
              inputTokens: it.input_tokens,
              outputTokens: it.output_tokens,
              cacheWriteTokens: it.cache_creation_input_tokens,
              cacheReadTokens: it.cache_read_input_tokens,
            }))
        : [
            {
              model: response.model,
              inputTokens: response.usage.input_tokens,
              outputTokens: response.usage.output_tokens,
              cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
              cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
            },
          ];

    return { text, model: response.model, stopReason: response.stop_reason, usage };
  },
};
