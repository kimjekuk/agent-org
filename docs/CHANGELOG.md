# CHANGELOG

## [Unreleased]

### 0단계 — 모노레포 뼈대 (PRD v1.1)
- pnpm 워크스페이스 + Turborepo 모노레포: `apps/web`, `apps/worker`, `packages/shared`
- `apps/web`: Next.js 15 (App Router) + Tailwind, 빈 페이지, `GET /api/health` (DB·Redis 연결 확인)
- `apps/worker`: BullMQ 워커 (큐 연결만, 에이전트 루프는 1-B~)
- Docker Compose: web, worker, postgres, redis (+ 로컬 전용 override). Caddy는 1-G에서 추가
- CI: lint, typecheck, test, build
- PRD v1.1 반영, CLAUDE.md·`.claude/settings.json` 갱신
