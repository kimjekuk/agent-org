// F110 Claude 제공사: 도구 권한에 따라 웹 검색·코드 실행 도구를 붙인다 (SDK는 가짜로 바꿔 요청만 확인)
import { beforeEach, describe, expect, it, vi } from "vitest";

const created: Record<string, unknown>[] = [];
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          created.push(params);
          return {
            model: params.model,
            stop_reason: "end_turn",
            content: [
              { type: "server_tool_use", id: "s1", name: "bash_code_execution", input: { command: "python -c 'print(1+1)'" } },
              { type: "bash_code_execution_tool_result", tool_use_id: "s1", content: { type: "bash_code_execution_result", stdout: "2", stderr: "", return_code: 0 } },
              { type: "text", text: "# 결과\n\n| 합 |\n|---|\n| 2 |" },
            ],
            usage: { input_tokens: 10, output_tokens: 10, server_tool_use: { web_search_requests: 0 } },
          };
        },
      },
    };
  },
}));

const { anthropicProvider } = await import("../src/llm/anthropic");
const toolTypes = () => ((created.at(-1)?.tools ?? []) as { type: string }[]).map((t) => t.type);
const base = { system: "s", messages: [{ role: "user" as const, content: "계산" }], maxTokens: 1000 };

describe("Claude 제공사 도구", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("코드 실행 권한이면 code_execution 도구를 붙이고 실행 횟수를 센다", async () => {
    const r = await anthropicProvider.complete("k", { ...base, model: "claude-sonnet-5-5", codeExecution: true });
    expect(toolTypes()).toEqual(["code_execution_20260521"]);
    expect(r.codeExecutions).toBe(1);
    expect(r.text).toContain("| 2 |");
  });

  it("웹 검색과 같이 켜면 기본 웹 검색 + 코드 실행 (실행 환경이 둘이 되지 않게)", async () => {
    await anthropicProvider.complete("k", { ...base, model: "claude-sonnet-5-5", codeExecution: true, webSearchMaxUses: 5 });
    expect(toolTypes()).toEqual(["web_search_20250305", "code_execution_20260521"]);
    await anthropicProvider.complete("k", { ...base, model: "claude-sonnet-5-5", webSearchMaxUses: 5 });
    expect(toolTypes()).toEqual(["web_search_20260209"]);
  });

  it("코드 실행을 못 쓰는 모델(Haiku)이면 도구 없이 부른다", async () => {
    await anthropicProvider.complete("k", { ...base, model: "claude-haiku-5-5", codeExecution: true, webSearchMaxUses: 5 });
    expect(created.at(-1)?.tools).toBeUndefined();
  });
});
