# CHANGELOG

## [Unreleased]

### 0-B — 기존 VM 배포 (PRD v1.2)
- PRD v1.2: 기존 오라클 ARM VM(JStudio 동거) + Tailscale serve, 도메인 없음, VM pull 자동 배포
- Docker Compose 4개 (caddy 제거, 초안은 `docs/Caddyfile.example`). `docker-compose.dev.yml`(127.0.0.1:3200) / `docker-compose.prod.yml`(127.0.0.1:3100)
- `deploy/deploy.sh` + systemd 타이머 `agentorg-deploy@{dev,prod}` (2분마다 새 커밋 확인 → 배포)
- `docs/DEPLOY.md`: VM 설치 절차 (Docker, Deploy key, dev/운영 스택, Tailscale serve)
- CI compose 확인을 dev 스택 구성으로 변경

### 0-A — 모노레포·Compose 뼈대 (PRD v1.1)
- pnpm 워크스페이스 + Turborepo 모노레포: `apps/web`, `apps/worker`, `packages/shared`
- `apps/web`: Next.js 15 (App Router) + Tailwind, 빈 페이지, `GET /api/health` (DB·Redis 연결 확인)
- `apps/worker`: BullMQ 워커 (큐 연결만, 에이전트 루프는 1-B~)
- CI: lint·typecheck·test·build, web·worker 이미지 arm64+amd64 빌드, compose 기동 후 빈 페이지·health 확인
