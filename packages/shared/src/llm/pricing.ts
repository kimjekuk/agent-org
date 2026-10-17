// 모델 요금 (달러, 100만 토큰당) → 원화 환산. PRD 11장 · 2026-10-17 결정: 1달러 = 1,400원 고정 (USD_KRW로 변경 가능)
import type { LLMUsageIteration } from "./provider";

export const DEFAULT_MODELS = {
  primary: "claude-sonnet-5-5", // 일반용 (2026-10-17 결정)
  economy: "claude-haiku-5-5", // 절약용: 예산 80% 이상에서 자동 전환
} as const;

interface Price {
  input: number;
  output: number;
  cacheRead: number;
  /** 입력이 이 토큰 수를 넘으면 longInput/longOutput 요금 */
  longThreshold?: number;
  longInput?: number;
  longOutput?: number;
}

const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, longThreshold: 100_000, longInput: 0.5, longOutput: 2.5 },
};

export function usdToKrwRate(): number {
  const rate = Number(process.env.USD_KRW ?? 1400);
  return Number.isFinite(rate) && rate > 0 ? rate : 1400;
}

/** 모르는 모델이면 오류. 요금표에 없는 모델은 비용을 기록할 수 없으므로 호출 자체를 막는다. */
export function assertKnownModel(model: string) {
  if (!PRICES[model]) throw new Error(`요금표에 없는 모델입니다: ${model}`);
}

/** 웹 검색 1회 요금 ($10 / 1,000회) */
export const WEB_SEARCH_USD = 0.01;

/** 시도별 사용량 + 웹 검색 횟수의 원화 비용 합계. 캐시 쓰기는 입력 요금의 1.25배. */
export function costKrw(usage: LLMUsageIteration[], rate = usdToKrwRate(), webSearchRequests = 0): number {
  let usd = webSearchRequests * WEB_SEARCH_USD;
  for (const u of usage) {
    const p = PRICES[u.model];
    if (!p) throw new Error(`요금표에 없는 모델입니다: ${u.model}`);
    const totalInput = u.inputTokens + u.cacheWriteTokens + u.cacheReadTokens;
    const long = p.longThreshold !== undefined && totalInput > p.longThreshold;
    const input = long ? p.longInput! : p.input;
    const output = long ? p.longOutput! : p.output;
    usd +=
      (u.inputTokens * input + u.cacheWriteTokens * input * 1.25 + u.cacheReadTokens * p.cacheRead + u.outputTokens * output) /
      1_000_000;
  }
  return usd * rate;
}
