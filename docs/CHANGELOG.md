# CHANGELOG

## [Unreleased]

### 2단계 F106 — 반복 미션 · 예약 지시 · 근무 시간
- `/schedules` (더보기 → 예약): 반복 미션(주제·목표·성공 기준·형식·회차 예산·자율성) 또는 예약 지시(에이전트·내용), 한 번/매일/매주(요일)/매월(1~28일) + 시각(KST)
- 워커가 1분마다 실행: 이전 회차 진행 중이면 건너뛰고 푸시 알림, 긴급 정지 중 건너뜀, 근무 시간 밖이면 다음 근무 시작으로 미룸, '지금 실행'
- 근무 시간(조직 단위): 밖에서는 예약으로 생긴 일·에이전트끼리의 일만 대기, 사용자 직접 지시·미션은 언제든
- 마이그레이션 0005: `schedules`, `missions.schedule_id` / 테스트 13개 추가

### 여러 LLM 제공사 — GPT · Gemini · DeepSeek
- OpenAI 호환 어댑터 하나로 OpenAI·Gemini(OpenAI 호환 엔드포인트)·DeepSeek 호출 (SDK 없이 fetch)
- `llm_models` 표 (마이그레이션 0004): 모델 이름·제공사·입력/출력/캐시 요금(100만 토큰당 달러)·켜짐. 후보 6개는 꺼진 채로 추가
- gateway: 모델로 제공사 선택, 꺼졌거나 요금표에 없는 모델은 호출 전에 차단, DB 요금으로 CostLog
- 설정: 제공사별 API 키·연결 테스트(가장 싼 켜진 모델), 모델·요금 관리 / 에이전트 프로필에서 추가 모델 선택
- 웹 검색은 Claude 모델만 (다른 회사 모델은 검색 없이 진행)
- 테스트 6개 추가 (워커 51개)

### 1-F — 대시보드 · 조직도 · 산출물 · 출근 브리핑 · 모바일(PWA·푸시) — MVP
- F017 네비게이션: 모바일 하단 탭바 5개(대시보드·미션·승인함·에이전트·더보기, 승인 대기 배지), PC 좌측 사이드바, 첫 화면 = 대시보드
- F003 `/dashboard`: 활동 에이전트·진행 미션·승인 대기·오늘 지출 카드, 진행 중 미션(진행률·담당 아바타), 에이전트 그리드([지시][멈춤][설정])
- F016 출근 브리핑: 마지막으로 닫은 뒤 완료 미션·끝난 Task·보고·막힌 에이전트·새 승인 요청·예산 경고
- F004 `/org`: 리더→팀장→팀원 트리, 탭 → 상사·직급 변경(순환 방지)·지시하기 (PC도 탭 → 메뉴, 2026-10-18 결정)
- F011 `/artifacts`: 목록(전체·미션 최종·직접 지시, 50개씩), 상세, 평가 1~5, 버전 목록·되돌리기
- F017 PWA: manifest·앱 아이콘·서비스 워커·오프라인 안내 / 웹 푸시: 승인 대기·예산 경고(하루 1번)·예산 초과·미션 완료, 더보기에서 켜기·끄기·시험. VAPID 키 자동 생성·암호화 저장
- 마이그레이션 0003: `users.briefing_seen_at`, `push_subscriptions`, `app_secrets`

### 1-E — 미션 · 리더 루프 · 칸반 · 승인함
- F006 `/missions/new`: 주제(필수)·목표·성공 기준·마감·예산·우선순위·산출물 형식·자율성·담당 리더·참고 자료(URL·텍스트) → 리더에게 지시 → 큐
- F007 리더 루프: Task 3~8개 분해 → 특기 일치·부하로 배정 → 순서대로 지시(앞 Task 결과·사용자 추가 지시 포함) → LLM 검토(반려 Task당 1회) → 최종 통합 → 사용자 보고
- 자율성: 완전 자율(승인 없음) / 체크포인트(계획·최종) / 수동(계획·Task마다·최종). 실패 3회·리더 처리 실패는 승인함에 질문
- F010 `/missions/[id]`: 진행률·예산, 일시정지·재개·취소, 자율성·예산 변경, 칸반(탭 → 다시 하기/완료 처리), 대화 로그(리더에게 메시지), 산출물(버전), 비용
- F012 `/approvals`: 유형 뱃지·대기 시간, 승인·거절·보류 + 코멘트 → 리더에게 메시지로 전달 → AuditLog, 메뉴에 대기 건수
- 마이그레이션 0002: `missions.reference_notes`, `tasks.reject_count`, `approval_requests.task_id·payload`
- 테스트: 리더 루프 13개 추가 (워커 41개)

### 1-C·1-D — 에이전트 · 메시지 · 팀원 루프 · 긴급 정지 · 감사 로그 · 실시간
- F005 `/agents`: 콘텐츠 제작팀 4명 한 번에 채용(하나·두리·세찬·네모), 역할 템플릿 채용, 프로필(직급·상사·성격·특기·도구 권한·모델·턴 수·예산·캐릭터), 멈추기/재개, 복제, 해고/재고용, 삭제(2단계)
- 캐릭터 아바타 SVG (머리 4 × 표정 4 × 색 6)
- F009 직접 지시 → BullMQ 큐 → 워커. 대화 화면에 지시·보고·산출물(펼쳐 보기)·비용 표시
- F008 팀원 루프: 매 턴 runTurn → 지시 1개 → 산출물(마크다운) 저장 → 보고. 사용자 지시 우선, 예산·턴 수·API 키 없음·실패 보고
- 웹 검색 도구 (Sonnet 5.5 등, 회당 14원 CostLog 포함, `pause_turn` 이어서 실행)
- F014 긴급 정지: 모든 화면 상단 버튼 + 확인 창(엄지 위치) + Ctrl+Shift+S + 붉은 배너·재개(남은 지시 재개)
- F015 `/audit` 감사 로그 화면 / SSE `/api/events` (Redis pub/sub) 화면 자동 갱신
- 작업 유실 방지 주기 점검, 산출물은 미션 없이도 저장(`artifacts.org_id` 추가, 마이그레이션 0001)
- 세션 사용자를 DB로 재확인 (삭제된 계정의 남은 로그인 차단)
- 테스트: 팀원 루프·긴급 정지 1턴 내 중단·재개·최대 턴·주기 점검 10개 추가 (워커 28개)

### 1-B — gateway · guards · F013 CostLog
- `packages/shared/llm`: Provider 인터페이스, Claude 구현(서버측 대체 모델 `fallbacks: "default"`), 요금표·원화 환산(1달러=1,400원)
- `gateway.ts`: 유일한 LLM 진입점 — 긴급 정지 확인 → 예산(80% 절약 모델, 100% 중단 + BUDGET 승인 요청) → 키 복호화 → 호출 → CostLog·AuditLog
- `apps/worker/src/guards.ts`: 매 턴 체크(긴급 정지 → 비활성 → 예산 → 사용자 메시지 우선 → 턴 수), `runTurn`으로만 턴 실행
- 외부 발송 승인 확인(`requireExternalApproval`), 시스템 프롬프트에 사용자 최우선 문장 고정
- `guards.test.ts` 18개 (PART 2 원칙 5 네 가지), 요금 계산 테스트 6개
- 설정 화면 "연결 테스트" 버튼 (Haiku 5.5, gateway 경유)

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
