// Claude(Anthropic) 구현체. @anthropic-ai/sdk는 이 파일에서만 import한다 (guards.test가 검사).
import Anthropic from "@anthropic-ai/sdk";
import { supportsCodeExecution, supportsWebSearch } from "./pricing";
import type { LLMProvider, LLMRequest, LLMResult, LLMUsageIteration } from "./provider";

// 서버측 대체 모델(fallbacks: "default")을 지원하는 모델. Haiku 5.5는 지원하지 않는다.
const SERVER_FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);
const MAX_PAUSE_RESUMES = 5; // 서버 도구 루프가 pause_turn으로 멈추면 이어서 실행하는 최대 횟수

export const anthropicProvider: LLMProvider = {
  name: "anthropic",

  async complete(apiKey: string, req: LLMRequest): Promise<LLMResult> {
    const client = new Anthropic({ apiKey });
    const fallback = SERVER_FALLBACK_MODELS.has(req.model);
    const webSearch = Boolean(req.webSearchMaxUses) && supportsWebSearch(req.model);
    const codeExecution = Boolean(req.codeExecution) && supportsCodeExecution(req.model);
    // F110: 코드 실행과 함께면 기본 웹 검색을 쓴다 (web_search_20260209는 자체 실행 환경이 있어 둘을 같이 두면 모델이 헷갈린다)
    const tools: Anthropic.Beta.BetaToolUnion[] = [
      ...(webSearch
        ? codeExecution
          ? [{ type: "web_search_20250305" as const, name: "web_search" as const, max_uses: req.webSearchMaxUses }]
          : [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: req.webSearchMaxUses }]
        : []),
      ...(codeExecution ? [{ type: "code_execution_20260521" as const, name: "code_execution" as const }] : []),
    ];

    const messages: Anthropic.Beta.BetaMessageParam[] = req.messages.map((m) => ({ role: m.role, content: m.content }));
    const usage: LLMUsageIteration[] = [];
    let webSearchRequests = 0;
    let codeExecutions = 0;
    let response: Anthropic.Beta.BetaMessage | undefined;

    for (let i = 0; i <= MAX_PAUSE_RESUMES; i++) {
      response = await client.beta.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        ...(req.system ? { system: req.system } : {}),
        messages,
        ...(tools.length ? { tools } : {}),
        // 안전 분류기가 거절하면 Anthropic 권장 모델로 서버에서 다시 시도한다
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      usage.push(...usageOf(response, req.model));
      webSearchRequests += response.usage.server_tool_use?.web_search_requests ?? 0;
      codeExecutions += response.content.filter((b) => b.type === "bash_code_execution_tool_result").length;
      if (response.stop_reason !== "pause_turn") break;
      // 서버 도구 루프가 잠시 멈춤 → 지금까지의 응답을 그대로 붙여 이어서 실행 (추가 user 메시지 없이)
      messages.push({ role: "assistant", content: response.content });
    }

    const text = response!.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    return { text, model: response!.model, stopReason: response!.stop_reason, usage, webSearchRequests, webSearchEnabled: webSearch, codeExecutions };
  },
};

/** usage.iterations가 시도별 실제 사용량 (거절된 시도 포함). 없으면 최상위 usage 하나. */
function usageOf(response: Anthropic.Beta.BetaMessage, requestedModel: string): LLMUsageIteration[] {
  const iterations = (response.usage.iterations ?? []).filter((it) => it.type === "message" || it.type === "fallback_message");
  if (iterations.length > 0) {
    return iterations.map((it) => ({
      model: it.model ?? requestedModel,
      inputTokens: it.input_tokens,
      outputTokens: it.output_tokens,
      cacheWriteTokens: it.cache_creation_input_tokens,
      cacheReadTokens: it.cache_read_input_tokens,
    }));
  }
  return [
    {
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  ];
}
