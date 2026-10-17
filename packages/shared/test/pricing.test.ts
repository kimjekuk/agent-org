import { describe, expect, it } from "vitest";
import { costKrw } from "../src/llm/pricing";

const u = (model: string, input: number, output: number, cacheWrite = 0, cacheRead = 0) => ({
  model,
  inputTokens: input,
  outputTokens: output,
  cacheWriteTokens: cacheWrite,
  cacheReadTokens: cacheRead,
});

describe("비용 계산 (원화, 1달러 = 1,400원)", () => {
  it("Sonnet 5.5: 입력 100만·출력 100만 토큰 = $12 = 16,800원", () => {
    expect(costKrw([u("claude-sonnet-5-5", 1_000_000, 1_000_000)], 1400)).toBeCloseTo(16800, 6);
  });

  it("Haiku 5.5: 입력 1만·출력 1만 토큰 = $0.006 = 8.4원", () => {
    expect(costKrw([u("claude-haiku-5-5", 10_000, 10_000)], 1400)).toBeCloseTo(8.4, 6);
  });

  it("Haiku 5.5: 입력이 10만 토큰을 넘으면 높은 요금", () => {
    expect(costKrw([u("claude-haiku-5-5", 200_000, 0)], 1400)).toBeCloseTo(0.1 * 1400, 6); // 200K × $0.5/M = $0.1
  });

  it("캐시 쓰기는 입력의 1.25배, 캐시 읽기는 캐시 요금", () => {
    expect(costKrw([u("claude-sonnet-5-5", 0, 0, 1_000_000, 1_000_000)], 1)).toBeCloseTo(2 * 1.25 + 0.2, 6);
  });

  it("대체 모델이 쓰이면 시도별로 각 모델 요금을 더한다", () => {
    const usage = [u("claude-sonnet-5-5", 1_000_000, 0), u("claude-sonnet-5", 1_000_000, 0)];
    expect(costKrw(usage, 1)).toBeCloseTo(4, 6);
  });

  it("요금표에 없는 모델은 비용을 기록할 수 없으므로 오류", () => {
    expect(() => costKrw([u("unknown-model", 1, 1)], 1)).toThrow(/요금표/);
  });
});
