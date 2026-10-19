ALTER TABLE "agents" ADD COLUMN "personality_type" text;--> statement-breakpoint
-- 기존 에이전트: 템플릿 성격 그대로면 그 템플릿의 성격 유형을 채운다 (2026-10-18 F103)
INSERT INTO "audit_logs" ("org_id", "actor_type", "action", "target_type", "target_id", "reasoning")
SELECT "org_id", 'SYSTEM', 'agent.update', 'agent', "id"::text, '성격 유형 채움 (템플릿 성격 "' || "personality" || '")'
FROM "agents" WHERE "personality" IN ('차분하고 꼼꼼함', '호기심 많고 끈기 있음', '밝고 표현력이 좋음', '깐깐하고 정확함', '체계적이고 실용적임');--> statement-breakpoint
UPDATE "agents" SET "personality_type" = CASE "personality"
  WHEN '차분하고 꼼꼼함' THEN 'METICULOUS'
  WHEN '호기심 많고 끈기 있음' THEN 'ANALYTIC'
  WHEN '밝고 표현력이 좋음' THEN 'CREATIVE'
  WHEN '깐깐하고 정확함' THEN 'METICULOUS'
  WHEN '체계적이고 실용적임' THEN 'DRIVEN'
END
WHERE "personality" IN ('차분하고 꼼꼼함', '호기심 많고 끈기 있음', '밝고 표현력이 좋음', '깐깐하고 정확함', '체계적이고 실용적임');
