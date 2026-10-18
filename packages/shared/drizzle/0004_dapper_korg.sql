CREATE TABLE "llm_models" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"input_usd" numeric(10, 4) NOT NULL,
	"output_usd" numeric(10, 4) NOT NULL,
	"cached_input_usd" numeric(10, 4),
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- 후보 모델 (2026-10 웹 검색으로 찾은 값, 공식 페이지 확인 전이라 꺼 둔다). 설정 → 모델·요금에서 확인 후 켠다
INSERT INTO "llm_models" ("id", "provider", "label", "input_usd", "output_usd", "cached_input_usd", "enabled") VALUES
  ('gpt-6.1-sol', 'openai', 'GPT-6.1 Sol — 균형', 2, 10, NULL, false),
  ('gpt-6-luna', 'openai', 'GPT-6 Luna — 절약', 0.1, 0.5, NULL, false),
  ('gpt-6-astra', 'openai', 'GPT-6 Astra — 고급', 10, 50, NULL, false),
  ('gemini-3.1-pro', 'gemini', 'Gemini 3.1 Pro — 고급', 2, 12, NULL, false),
  ('gemini-2.5-flash-lite', 'gemini', 'Gemini 2.5 Flash-Lite — 절약', 0.1, 0.4, NULL, false),
  ('deepseek-v4-pro', 'deepseek', 'DeepSeek V4 Pro (피크 요금 기준)', 1.32, 3.96, NULL, false)
ON CONFLICT ("id") DO NOTHING;
