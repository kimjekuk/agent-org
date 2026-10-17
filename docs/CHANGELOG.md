# CHANGELOG

## [Unreleased]

### 1-A — F001 로그인 · F002 조직 · 7장 스키마
- Drizzle 스키마(7장 전체 13개 테이블) + 첫 마이그레이션. 워커 컨테이너 시작 시 자동 적용
- F001: Auth.js v5(beta.32 고정) 이메일/비밀번호 로그인, `/setup` 첫 관리자 계정(사용자 0명일 때만), 비밀번호 scrypt
- F001: Claude API 키 AES-256-GCM 암호화 저장·교체·삭제 (다시 표시하지 않음)
- F002: 조직 만들기·선택·이름 변경·삭제 (`/settings`)
- 모든 변경을 AuditLog에 기록 (키 값은 기록하지 않음)
- `deploy.sh`: `AUTH_SECRET`·`ENCRYPTION_KEY` 자동 생성, pull 후 새 스크립트로 재실행

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
