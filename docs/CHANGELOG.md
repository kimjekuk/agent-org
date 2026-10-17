# CHANGELOG

## [Unreleased]

### 0-A — 모노레포·Compose 뼈대 (PRD v1.1)
- pnpm 워크스페이스 + Turborepo 모노레포: `apps/web`, `apps/worker`, `packages/shared`
- `apps/web`: Next.js 15 (App Router) + Tailwind, 빈 페이지, `GET /api/health` (DB·Redis 연결 확인)
- `apps/worker`: BullMQ 워커 (큐 연결만, 에이전트 루프는 1-B~)
- Docker Compose: web, worker, postgres, redis, caddy (80번 → web). 도메인·HTTPS·dev/운영 분리는 0-B
- CI: lint·typecheck·test·build, web·worker 이미지 arm64+amd64 빌드, compose 기동 후 빈 페이지·health 확인
- PRD v1.1 반영 (8장 compose 파일 구성을 12장과 일치), CLAUDE.md·`.claude/settings.json` 갱신
