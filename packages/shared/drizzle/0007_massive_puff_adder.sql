ALTER TABLE "organizations" ALTER COLUMN "budget_daily" SET DEFAULT 2000;--> statement-breakpoint
-- 기존 데이터: 초기값(20,000원) 그대로인 조직의 하루 예산 → 2,000원, 웹 검색 권한 없는 Sonnet 에이전트 → Haiku (2026-10-18 사용자 결정). 바꾼 것은 감사 로그에 남긴다
INSERT INTO "audit_logs" ("org_id", "actor_type", "action", "target_type", "target_id", "reasoning")
SELECT "id", 'SYSTEM', 'org.budget_daily', 'organization', "id"::text, '하루 예산 20,000원 → 2,000원 (Max 5x 월 API 크레딧에 맞춤, 사용자 결정)'
FROM "organizations" WHERE "budget_daily" = 20000;--> statement-breakpoint
UPDATE "organizations" SET "budget_daily" = 2000 WHERE "budget_daily" = 20000;--> statement-breakpoint
INSERT INTO "audit_logs" ("org_id", "actor_type", "action", "target_type", "target_id", "reasoning")
SELECT "org_id", 'SYSTEM', 'agent.update', 'agent', "id"::text, '기본 모델 claude-sonnet-5-5 → claude-haiku-5-5 (웹 검색 권한 없음, 비용 절감, 사용자 결정)'
FROM "agents" WHERE "model_primary" = 'claude-sonnet-5-5' AND coalesce(("tool_permissions"->>'web_search')::boolean, false) = false;--> statement-breakpoint
UPDATE "agents" SET "model_primary" = 'claude-haiku-5-5' WHERE "model_primary" = 'claude-sonnet-5-5' AND coalesce(("tool_permissions"->>'web_search')::boolean, false) = false;
