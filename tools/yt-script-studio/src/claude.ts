// Claude 호출 — 스트리밍으로 받아서 글자 단위로 화면에 흘려보낸다

import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

// 1M 토큰당 달러 (입력, 출력). 비용 표시용
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};
const USD_KRW = Number(process.env.USD_KRW || 1400);

let client: Anthropic | null = null;
function getClient() {
  client ??= new Anthropic();
  return client;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  krw: number;
}

export async function streamText(
  prompt: string,
  imageUrls: string[],
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<{ text: string; usage: Usage }> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...imageUrls.map((url): Anthropic.Beta.BetaImageBlockParam => ({ type: "image", source: { type: "url", url } })),
    { type: "text", text: prompt },
  ];
  const stream = getClient().beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      // 안전 분류기가 거절하면 서버가 다른 모델로 이어서 처리
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content }],
    },
    { signal },
  );
  let text = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      text += event.delta.text;
      onDelta(event.delta.text);
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    throw new Error("Claude가 이 요청을 처리하지 않았습니다. 주제나 추가 요청을 바꿔 보세요.");
  }
  const [inPrice, outPrice] = PRICES[MODEL] ?? PRICES["claude-opus-5-5"];
  const u = final.usage;
  const inputTokens = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const usd = (inputTokens * inPrice + u.output_tokens * outPrice) / 1_000_000;
  return { text, usage: { inputTokens, outputTokens: u.output_tokens, krw: Math.round(usd * USD_KRW) } };
}

export function explainError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Claude API 키가 올바르지 않습니다. .env의 ANTHROPIC_API_KEY를 확인하세요.";
  if (e instanceof Anthropic.PermissionDeniedError) return "Claude API 키에 권한이 없습니다. 콘솔에서 키·결제 상태를 확인하세요.";
  if (e instanceof Anthropic.RateLimitError) return "Claude API 호출이 너무 많습니다. 1분 뒤 다시 시도하세요.";
  if (e instanceof Anthropic.BadRequestError) return `Claude API 요청 오류: ${e.message}`;
  if (e instanceof Anthropic.APIError) return `Claude API 오류(${e.status}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

export { Anthropic };
