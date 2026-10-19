-- F107: 템플릿 그대로인 '검수' 에이전트(특기에 품질 점검)를 품질 검토 담당(QA)으로 지정한다 (2026-10-19)
INSERT INTO "audit_logs" ("org_id", "actor_type", "action", "target_type", "target_id", "reasoning")
SELECT "org_id", 'SYSTEM', 'agent.update', 'agent', "id"::text, '품질 검토 담당(QA) 지정 — 검수 템플릿 (F107)'
FROM "agents" WHERE "skills" ? '품질 점검' AND NOT coalesce(("tool_permissions"->>'qa_review')::boolean, false);--> statement-breakpoint
UPDATE "agents" SET "tool_permissions" = "tool_permissions" || '{"qa_review": true}'::jsonb
WHERE "skills" ? '품질 점검' AND NOT coalesce(("tool_permissions"->>'qa_review')::boolean, false);
