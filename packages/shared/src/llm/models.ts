// 쓸 수 있는 모델 목록과 제공사 찾기. Claude는 코드 요금표, 그 외(OpenAI·Gemini·DeepSeek)는 DB llm_models (켜진 것만)
import { and, asc, eq } from "drizzle-orm";
import type { AnyDb } from "../db/client";
import { llmModels } from "../db/schema";
import { isBuiltinModel, MODEL_CHOICES, type Price } from "./pricing";

export const PROVIDERS = ["anthropic", "openai", "gemini", "deepseek"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export const PROVIDER_LABEL: Record<ProviderName, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "GPT (OpenAI)",
  gemini: "Gemini (Google)",
  deepseek: "DeepSeek",
};

/** 요금 확인용 공식 페이지 (설정 화면 안내) */
export const PRICING_PAGES: Record<ProviderName, string> = {
  anthropic: "https://www.anthropic.com/pricing",
  openai: "https://openai.com/api/pricing",
  gemini: "https://ai.google.dev/gemini-api/docs/pricing",
  deepseek: "https://api-docs.deepseek.com/quick_start/pricing",
};

export class UnknownModelError extends Error {
  constructor(model: string) {
    super(`쓸 수 없는 모델입니다: ${model} (설정 → 모델·요금에서 요금을 확인하고 켜 주세요)`);
    this.name = "UnknownModelError";
  }
}

export interface ResolvedModel {
  provider: ProviderName;
  /** DB 모델의 요금 (Claude는 코드 요금표를 쓰므로 없음) */
  price?: Price;
}

/** 모델의 제공사와 요금. 요금표에 없거나 꺼진 모델이면 오류 — 비용을 기록할 수 없으므로 호출 자체를 막는다 */
export async function resolveModel(db: AnyDb, model: string): Promise<ResolvedModel> {
  if (isBuiltinModel(model)) return { provider: "anthropic" };
  const [row] = await db.select().from(llmModels).where(and(eq(llmModels.id, model), eq(llmModels.enabled, true)));
  if (!row || !(PROVIDERS as readonly string[]).includes(row.provider)) throw new UnknownModelError(model);
  const input = Number(row.inputUsd);
  return {
    provider: row.provider as ProviderName,
    price: { input, output: Number(row.outputUsd), cacheRead: row.cachedInputUsd != null ? Number(row.cachedInputUsd) : input },
  };
}

/** 에이전트 프로필에서 고를 수 있는 모델: Claude + 켜진 추가 모델 */
export async function listModelChoices(db: AnyDb): Promise<{ id: string; label: string }[]> {
  const rows = await db.select().from(llmModels).where(eq(llmModels.enabled, true)).orderBy(asc(llmModels.provider), asc(llmModels.label));
  const usd = (n: string) => `$${Number(n)}`;
  return [
    ...MODEL_CHOICES.map((m) => ({ id: m.id, label: m.label })),
    ...rows.map((r) => ({ id: r.id, label: `${r.label} (${usd(r.inputUsd)} / ${usd(r.outputUsd)})` })),
  ];
}
