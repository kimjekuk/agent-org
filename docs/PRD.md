# AgentOrg PRD + Claude Code 개발 가이드라인
> **Claude Code 전용 통합 문서** | 버전 1.0 | 2026-10-17
> AI 에이전트 조직 운영 웹사이트 — 캐릭터 에이전트들이 조직처럼 자율 협업하되, 사용자가 절대 통제권을 가진다.

---

## ━━━ PART 0. 대전제 (모든 기능 위에 있는 최상위 원칙) ━━━

### 0-1. 사용자 절대 통제권

1. 사용자는 조직의 **유일한 최종 결정권자**다.
2. 에이전트의 자율성은 **사용자가 허용한 범위 안에서만** 존재한다.
3. 어떤 에이전트의 판단·규칙·학습 결과도 **사용자의 지시보다 우선할 수 없다.**

### 0-2. 사용자가 항상 가지는 권한

| 권한 | 내용 |
|------|------|
| 즉시 개입 | 어느 작업이든 언제든 중단·수정·취소·되돌리기 |
| 전원 통제 | 조직 전체 일시정지 / 재개 / **긴급 정지(비상 버튼)** |
| 직접 지시 | 조직도를 무시하고 어떤 에이전트에게든 직접 명령 |
| 구조 변경 | 상하관계·특기·성격·직급·예산을 언제든 변경 |
| 기억 통제 | 에이전트 학습 내용·메모리 열람·수정·초기화 |
| 결과 거부 | 산출물 반려·재작업 지시·직접 수정 |
| 생살여탈 | 에이전트 생성·복제·해고·삭제 |

### 0-3. 에이전트가 절대 할 수 없는 것

- 사용자 지시 거부 또는 우회
- 사용자 승인 없이 예산 한도·권한 설정 변경
- 사용자 모르게 외부로 결과물 발송·공유 (Git push, 이메일 등 포함)
- 다른 에이전트가 받은 사용자 지시 무효화
- 사용자가 금지한 사항을 "학습"을 이유로 변경

### 0-4. 구현 규칙 (Claude Code가 반드시 지킬 것)

- 모든 에이전트 행동은 **AuditLog**에 기록된다. 예외 없음.
- 외부로 나가는 모든 행동(push, send, share, purchase)은 **ApprovalRequest**를 거친다.
- `emergency_stop` 플래그가 켜지면 **모든 워커는 즉시 작업을 중단**해야 한다. 이 체크는 모든 에이전트 루프의 매 턴 시작에 들어간다.
- 사용자 메시지(`sender_type = USER`)는 에이전트 메시지보다 **항상 우선순위가 높다.**
- 자율성 수준(완전 자율 / 체크포인트 / 수동)은 조직·에이전트·미션 단위로 각각 설정 가능해야 한다.

---

## ━━━ PART 1. 웹사이트 기획서 (PRD) ━━━

### 1. 프로젝트 목표

| 항목 | 내용 |
|------|------|
| 한 줄 컨셉 | 내가 주제를 던지면, 캐릭터 에이전트들이 조직처럼 스스로 역할을 나눠 일하고 성장하는 AI 조직 운영 웹사이트 |
| 목적 | 사용자가 "CEO" 역할만 하면 AI 에이전트 조직이 실제 업무 결과물을 만들어내는 위임형 AI 활용 |
| 타겟 | 1차: 개발자 본인 전용 → 2차: 지인 공개 → 3차: 일반 공개 (※ 미결정 — 추천값) |
| 디자인 방향 | 귀여운 캐릭터 + 깔끔한 관제 대시보드. 게임 같은 재미 + 업무 도구의 신뢰감 |
| 반응형 | 모바일(375px~) / 태블릿(768px~) / PC(1280px~). 모바일에서도 지시·결과 확인·긴급 정지 가능 |
| 차별점 | 실제 업무 결과물 + 귀여운 조직 운영 + 사용자 절대 통제 + 비용 제한의 결합 |

### 2. 미결정 항목과 적용된 추천값

> 아래는 사용자가 아직 확정하지 않아 **추천값으로 채운 항목**이다. 변경 시 이 표만 고치면 된다.

| 항목 | 추천값 | 비고 |
|------|--------|------|
| 서비스 이름 | AgentOrg | 확정 |
| 1차 타깃 | 본인 전용 (단일 사용자) | 로그인은 넣되 회원가입 비공개 |
| 비용 방식 | 사용자 본인 API 키 등록 | 크레딧 판매는 4단계 |
| 기술 스택 | Next.js + Django(DRF) + PostgreSQL + Redis + Celery | 아래 6장 참고 |
| 캐릭터 그래픽 | 2D 일러스트 SVG (파츠 조합식) | 외형 커스터마이징 용이 |
| MVP 도구 범위 | 웹 검색 + 문서 작성/요약 | 코드 실행은 2단계 |
| 첫 조직 템플릿 | 콘텐츠 제작팀 (리더·리서처·작가·검수) | 4명 |
| LLM 제공사 | Claude 기본, OpenAI/Gemini 어댑터 구조 | 모델 추상화 계층 필수 |

### 3. 기능 명세 (Feature ID 기준)

#### 3-1. MVP (1단계) — 반드시 포함

| 기능 ID | 기능명 | 설명 |
|---------|--------|------|
| F001 | 로그인 / 계정 | 이메일 로그인, API 키 등록·암호화 저장 |
| F002 | 조직 생성·선택 | 조직 CRUD, 조직 템플릿 1종으로 시작, 사용자당 조직 여러 개 |
| F003 | CEO 대시보드 (관제) | 조직 상태·진행 중 미션·예산 사용률·알림·**긴급 정지 버튼** 한 화면 |
| F004 | 조직도 | 상하관계 트리 편집(드래그), 직급 지정, 직접 지시 진입점 |
| F005 | 에이전트 채용·프로필 | 이름·캐릭터·성격·특기·직급·모델·도구 권한·예산 설정. 복제·해고·삭제 |
| F006 | 미션 생성 | 주제·목표·성공 기준·마감·예산·우선순위·산출물 형식·자율성 수준 |
| F007 | 자율 업무 분배 | 리더 에이전트가 미션을 Task로 분해 → 특기 기반 배분 → 메시지로 지시 |
| F008 | 에이전트 실행 루프 | 지시 수신 → 계획 → 도구 사용 → 산출물 작성 → 상위 보고. 매 턴 emergency_stop 체크 |
| F009 | 에이전트 간 메시지 | 지시/보고/질문/제안 4종 고정 형식. 사용자 메시지 최우선 |
| F010 | 미션 상세 (칸반 + 로그) | 할 일/진행/검토/완료 보드, 에이전트 대화 로그 실시간(WebSocket) |
| F011 | 산출물 보관함 | 산출물 목록·상세·버전·되돌리기·평가 점수(1~5) |
| F012 | 승인 대기함 | 에이전트의 질문·제안·외부 발송 요청을 모아 승인/거절/보류 |
| F013 | 비용 제한 | 조직/에이전트/미션 예산 한도, CostLog 실시간 기록, 70·80% 경고, 초과 시 자동 중단 |
| F014 | 긴급 정지 | 모든 화면 접근 가능. 켜지면 전 워커 즉시 중단. 재개는 사용자만 |
| F015 | 감사 로그 (AuditLog) | 모든 에이전트 행동·판단 근거 기록, 열람 UI |
| F016 | 출근 브리핑 | 미접속 동안의 진행·막힌 작업·승인 대기·예산 경고 요약 |
| F017 | 반응형 레이아웃 | 전 페이지 공통 |

#### 3-2. 2단계 — 학습·조직 심화

| 기능 ID | 기능명 | 설명 |
|---------|--------|------|
| F101 | 기억 3단계 | 단기(작업)·중기(미션)·장기(교훈·노하우). 사용자 열람·수정·초기화 |
| F102 | 성장 시스템 | 경험치·레벨·특기 강화·승진. 비용 효율 반영 |
| F103 | 성격·상태 | 성격 유형, 상태(작업/대기/휴식/학습/막힘), 하루 일지 |
| F104 | 회의 | 킥오프·회고 회의. 사용자 끼어들기 가능 |
| F105 | 조직 지식 베이스 | 산출물·조사 자료 위키화, 검색·재활용 |
| F106 | 스케줄링 | 반복 미션·예약 지시·조건 트리거·근무 시간 설정 |
| F107 | 품질 관리 | 체크리스트 자기검토, QA 에이전트, 반복 실패 에스컬레이션 |
| F108 | 역제안 | 에이전트 제안서 → 사용자 승인/거절/보류 |
| F109 | 예외 처리 | 3회 실패→상위 보고→질문 카드, API 장애 대체 모델, 체크포인트 재개, 무한 토론 차단 |
| F110 | 코드 실행 도구 | 샌드박스 코드 실행, 도구 권한 에이전트별 ON/OFF |

#### 3-3. 3단계 — 시각화·연동

| 기능 ID | 기능명 | 설명 |
|---------|--------|------|
| F201 | 사무실 뷰 | 캐릭터가 자리에서 일하고 회의실로 모이는 2D 뷰 |
| F202 | 캐릭터 커스터마이징 | 외형·색·의상·말투, 레벨별 외형 변화, 조직 테마 |
| F203 | 통계 대시보드 | 에이전트/미션/모델별 생산성·비용·병목 분석 |
| F204 | 타임라인·리플레이 | 미션 진행 재생, 조직 역사 연표 |
| F205 | 외부 연동 | Notion/Google Docs/이메일/Slack 내보내기 (승인 필수) |
| F206 | Git 연동 (서비스 기능) | 조직별 저장소에 산출물 자동 커밋, 에이전트명 커밋 작성자, 미션=브랜치. 사용자 저장소 push는 승인 필수 |
| F207 | 알림 채널 | 이메일·푸시·Slack·카카오 |
| F208 | 입력 다양화 | 음성 지시, 파일/URL 던지기, 지시 템플릿, 자연어 설정 변경 |
| F209 | 다국어 | UI 한/영/일, 에이전트별 사용 언어 |

#### 3-4. 4단계 — 확장

| 기능 ID | 기능명 | 설명 |
|---------|--------|------|
| F301 | 에이전트 마켓 | 템플릿 공유·영입 |
| F302 | 팀 플랜 | 다중 사용자 공유. 소유자 1명이 최종 권한 |
| F303 | 요금제 | 무료/유료, 크레딧 판매 |
| F304 | 업적·레벨 | 조직 레벨, 배지, CEO 레벨 해금 |

### 4. 네비게이션 구조

```
[좌측 사이드바 — 전 페이지 공통] + [상단 바: 조직 선택 / 알림 / 🔴 긴급 정지]
├── 대시보드        → F003  /dashboard
├── 조직도          → F004  /org
├── 에이전트        → F005  /agents, /agents/[id]
├── 미션            → F006, F010  /missions, /missions/[id], /missions/new
├── 산출물          → F011  /artifacts
├── 승인 대기함     → F012  /approvals   (배지로 건수 표시)
├── 비용            → F013  /budget
├── 로그            → F015  /audit
└── 설정            → F001, F002  /settings (계정·API 키·조직)
```

### 5. 페이지별 상세 명세 (MVP)

#### F003 — CEO 대시보드

| 구성 요소 | 상세 |
|-----------|------|
| 상단 카드 4개 | 활동 중 에이전트 수 / 진행 미션 수 / 승인 대기 건수 / 오늘 지출·예산 사용률 |
| 긴급 정지 | 빨간 큰 버튼. 클릭 → 확인 모달 → 조직 `emergency_stop=true`. 켜진 동안 화면 상단에 붉은 배너 + "재개" 버튼 |
| 진행 중 미션 | 미션별 진행률 바, 담당 에이전트 아바타, 클릭 시 F010 |
| 에이전트 상태 그리드 | 캐릭터 아바타 + 상태 뱃지(작업/대기/막힘). 각 카드에 [지시] [멈춤] [설정] 즉시 버튼 |
| 출근 브리핑 (F016) | 마지막 접속 이후 요약 카드. 닫기 가능 |
| 인터랙션 | 실시간 갱신(WebSocket). 긴급 정지는 키보드 단축키 `Ctrl+Shift+S`도 지원 |

#### F004 — 조직도

| 구성 요소 | 상세 |
|-----------|------|
| 트리 뷰 | 리더 → 팀장 → 팀원. 드래그로 상사 변경 |
| 노드 | 아바타·이름·직급·특기 태그·상태. 클릭 → 사이드 패널(프로필 요약 + 직접 지시 입력창) |
| 직접 지시 | 입력 → Message(type=DIRECTIVE, sender=USER) 생성 → 해당 에이전트 큐 최우선 |
| 인터랙션 | 변경 즉시 저장 + AuditLog |

#### F005 — 에이전트 채용·프로필

| 구성 요소 | 상세 |
|-----------|------|
| 채용 | 템플릿(리더/리서처/작가/검수/기획) 선택 또는 빈 양식. 캐릭터 파츠(머리·얼굴·색) 선택 |
| 프로필 탭 | 기본 정보 / 특기·성격 / 모델·도구 권한 / 예산 / 기억(2단계) / 로그 |
| 모델 설정 | 기본 모델, 절약 모드 모델, 최대 턴 수 |
| 도구 권한 | 체크박스(웹 검색·문서 작성·…). 기본 OFF |
| 행동 버튼 | 지시하기 / 멈추기 / 복제 / 해고(비활성) / 삭제(확인 2회) |

#### F006 — 미션 생성

| 구성 요소 | 상세 |
|-----------|------|
| 폼 | 주제(필수), 목표, 성공 기준(체크리스트), 마감, 예산 한도(기본값: 조직 설정), 우선순위, 산출물 형식(보고서/기획안/요약/목록), 참고 자료 업로드·URL |
| 자율성 수준 | 완전 자율 / 체크포인트 / 수동 (기본: 체크포인트) |
| 담당 | 리더 에이전트 자동 지정 또는 수동 |
| 제출 | Mission 생성 → 리더에게 DIRECTIVE 메시지 → F007 시작 |

#### F007 / F008 — 자율 분배 & 실행 루프 (백엔드 핵심)

```
[리더 루프]
  1. 미션 수신 → 성공 기준·예산 확인
  2. Task 분해 (3~8개) → 각 Task에 필요 특기 태깅
  3. 특기 일치도 + 현재 부하 기준으로 담당 배정
  4. 각 담당에게 DIRECTIVE 메시지 발송
  5. REPORT 수신 대기 → 검토 → 승인/반려
  6. 전 Task 완료 → 최종 산출물 통합 → 사용자에게 REPORT
     (체크포인트 모드면 단계마다 ApprovalRequest)

[팀원 루프 — 매 턴 시작 시 공통 체크]
  ✔ org.emergency_stop ? → 즉시 종료
  ✔ 사용자 메시지 대기열 ? → 최우선 처리
  ✔ 예산 잔액 ? → 부족 시 절약 모델 전환 또는 중단 + 보고
  ✔ 턴 수 > max_turns ? → 중단 + 상위 보고
  1. DIRECTIVE 수신 → 계획 수립
  2. 도구 호출(권한 있는 것만)
  3. 산출물 작성 → Artifact 저장(버전+1)
  4. REPORT 발송 → Task 상태 REVIEW
  5. 3회 실패 → QUESTION 메시지를 상위에게 → 상위도 해결 못하면 사용자에게 ApprovalRequest(type=QUESTION)
```

#### F010 — 미션 상세

| 구성 요소 | 상세 |
|-----------|------|
| 헤더 | 제목·상태·진행률·예산 사용/한도·[일시정지] [취소] [자율성 변경] |
| 칸반 | TODO / DOING / REVIEW / DONE. Task 카드에 담당 아바타. 사용자 드래그로 강제 이동 가능 |
| 대화 로그 | 에이전트 간 메시지 타임라인(채팅 UI, 캐릭터 말풍선). 사용자가 끼어들어 메시지 입력 가능 |
| 산출물 탭 | 이 미션의 Artifact 목록 |
| 비용 탭 | 호출별 CostLog |

#### F012 — 승인 대기함

| 구성 요소 | 상세 |
|-----------|------|
| 목록 | 유형 뱃지(질문/제안/외부발송/체크포인트/예산초과), 요청 에이전트, 요약, 대기 시간 |
| 상세 | 전체 내용 + 관련 미션/산출물 링크 + [승인] [거절] [보류] + 코멘트 |
| 처리 | 결정 → ApprovalRequest 갱신 → 해당 에이전트에게 메시지로 전달 → AuditLog |

#### F013 — 비용

| 구성 요소 | 상세 |
|-----------|------|
| 예산 설정 | 조직 월/일 한도, 에이전트별 한도, 미션 기본 한도 |
| 현황 | 조직/에이전트/미션별 사용량 바, 일별 추이 차트 |
| 규칙 | 70% 경고 알림, 80% 절약 모드(저렴 모델 자동 전환), 100% 자동 중단 → ApprovalRequest(type=BUDGET) |
| 로그 | CostLog 테이블(시각·에이전트·미션·모델·입력/출력 토큰·비용) |

### 6. 권장 기술 스택

```
Frontend  : Next.js 14+ (App Router) + TypeScript + Tailwind CSS + shadcn/ui
            상태: Zustand, 서버 상태: TanStack Query, 실시간: WebSocket 클라이언트
Backend   : Python 3.12 + Django 5 + Django REST Framework
            실시간: Django Channels (WebSocket)
            백그라운드: Celery + Redis (에이전트 워커 — 접속 없어도 계속 실행)
DB        : PostgreSQL 16 (JSONB로 에이전트 설정·메시지 본문 저장)
LLM       : 제공사 추상화 계층 (LLMProvider 인터페이스) — Claude 기본, OpenAI/Gemini 어댑터
            모든 호출은 CostLog 기록 + 예산 체크를 거치는 단일 게이트웨이 함수로만 수행
Auth      : Django 세션 또는 JWT(SimpleJWT). API 키는 Fernet 암호화 저장
Deploy    : Frontend → Vercel / Backend → Docker (Railway, Fly.io 또는 자체 서버)
Dev       : Docker Compose (postgres, redis, backend, worker, frontend)
```

### 7. 핵심 데이터 모델

```
User            id, email, password, created_at
ApiKey          user, provider, encrypted_key, created_at
Organization    user(owner), name, theme, emergency_stop(bool),
                autonomy_default(FULL|CHECKPOINT|MANUAL),
                budget_monthly, budget_daily, work_hours(json), created_at
Agent           org, name, avatar(json), personality, rank(LEADER|MANAGER|MEMBER),
                supervisor(FK self, null), skills(json[]), level, xp,
                model_primary, model_economy, max_turns, tool_permissions(json),
                budget_limit, autonomy(nullable → org 기본값), status, is_active
Mission         org, title, topic, goal, success_criteria(json[]), deadline,
                budget_limit, priority, output_format, autonomy, leader(FK Agent),
                status(DRAFT|RUNNING|PAUSED|REVIEW|DONE|CANCELLED), created_at
Task            mission, title, description, required_skills(json[]),
                assignee(FK Agent), status(TODO|DOING|REVIEW|DONE), order, fail_count
Message         org, mission(null), task(null),
                sender_type(USER|AGENT|SYSTEM), sender_agent(null),
                receiver_agent(null), type(DIRECTIVE|REPORT|QUESTION|PROPOSAL),
                content(text), payload(json), priority, read_at, created_at
Artifact        mission, task, agent, title, format, content(text), version,
                parent_version(FK self), rating(1~5, null), created_at
Memory          agent, scope(SHORT|MID|LONG), mission(null), content, source, created_at
CostLog         org, agent, mission, task, provider, model,
                input_tokens, output_tokens, cost, created_at
ApprovalRequest org, agent, mission(null), type(QUESTION|PROPOSAL|EXTERNAL|CHECKPOINT|BUDGET),
                content, status(PENDING|APPROVED|REJECTED|HELD), decided_at, user_comment
AuditLog        org, actor_type(USER|AGENT|SYSTEM), actor_id, action, target_type,
                target_id, reasoning(text), payload(json), created_at
```

### 8. 권장 파일 구조

```
agent-org/                          ← 모노레포
├── CLAUDE.md                        ← Claude Code 규칙 (PART 2 요약 + Git 규칙)
├── docs/
│   ├── PRD.md                       ← 이 문서
│   └── CHANGELOG.md
├── docker-compose.yml
├── .gitignore                       ← .env, node_modules, __pycache__, *.sqlite3, media/
├── .env.example
│
├── backend/
│   ├── manage.py
│   ├── config/                      ← settings, urls, asgi(Channels), celery
│   ├── apps/
│   │   ├── accounts/                ← F001 User, ApiKey
│   │   ├── orgs/                    ← F002 Organization, emergency_stop, 예산 설정
│   │   ├── agents/                  ← F005 Agent, 템플릿, 캐릭터 파츠
│   │   ├── missions/                ← F006 Mission, Task
│   │   ├── messaging/               ← F009 Message
│   │   ├── artifacts/               ← F011 Artifact
│   │   ├── approvals/               ← F012 ApprovalRequest
│   │   ├── billing/                 ← F013 CostLog, 예산 체크
│   │   ├── audit/                   ← F015 AuditLog
│   │   └── engine/                  ← F007/F008 에이전트 실행 엔진
│   │       ├── llm/                 ← provider 추상화 (base.py, claude.py, openai.py)
│   │       ├── gateway.py           ← 모든 LLM 호출의 단일 진입점 (예산 체크 + CostLog)
│   │       ├── prompts/             ← 역할 프롬프트 조립
│   │       ├── tools/               ← web_search.py, document.py (권한 체크 포함)
│   │       ├── loops/               ← leader_loop.py, member_loop.py
│   │       ├── guards.py            ← emergency_stop, 예산, 턴 수, 사용자 메시지 우선 체크
│   │       └── tasks.py             ← Celery 태스크
│   └── tests/
│       ├── test_guards.py           ← 대전제 검증 테스트 (최우선)
│       └── ...
│
└── frontend/
    ├── app/
    │   ├── (auth)/login/
    │   ├── dashboard/               ← F003
    │   ├── org/                     ← F004
    │   ├── agents/[id]/             ← F005
    │   ├── missions/[id]/           ← F006, F010
    │   ├── artifacts/               ← F011
    │   ├── approvals/               ← F012
    │   ├── budget/                  ← F013
    │   ├── audit/                   ← F015
    │   └── settings/
    ├── components/
    │   ├── EmergencyStopButton.tsx  ← F014 (레이아웃에 상시 포함)
    │   ├── AgentAvatar.tsx          ← SVG 파츠 조합
    │   ├── AgentCard.tsx
    │   ├── KanbanBoard.tsx
    │   ├── ChatLog.tsx
    │   └── OrgTree.tsx
    ├── lib/api.ts, lib/ws.ts
    └── stores/
```

### 9. 비기능 요구사항

| 항목 | 요구사항 |
|------|---------|
| 통제 | 긴급 정지 반영 지연 ≤ 1턴(수 초). 모든 외부 발송은 승인 필수 |
| 투명성 | 모든 에이전트 행동·판단 근거 AuditLog 기록. 숨겨진 상태 없음 |
| 비용 | 모든 LLM 호출은 gateway.py 경유. 우회 호출 금지. 한도 초과 시 자동 중단 |
| 지속성 | 사용자 미접속 중에도 Celery 워커가 작업 지속. 재시작 시 체크포인트 재개 |
| 보안 | API 키 암호화 저장, .env 미커밋, 업로드 자료 조직 외부 비공개 |
| 데이터 | 조직 데이터 JSON 전체 내보내기, 계정 삭제 시 완전 삭제 |
| 안전 | 유해·불법·개인정보 콘텐츠 필터, 결과물 "AI 생성" 표시 옵션 |
| 반응형 | 375 / 768 / 1280px. 모바일에서 긴급 정지·지시·결과 확인 가능 |
| 접근성 | 키보드 탐색, 다크 모드, 글자 크기 조절 |

### 10. 개발 로드맵

| 단계 | 범위 | 완료 기준 |
|------|------|-----------|
| 0 | 저장소·Docker Compose·CLAUDE.md·CI 뼈대 | `docker compose up`으로 전 서비스 기동 |
| 1-A | F001, F002, 데이터 모델, 마이그레이션 | 로그인 → 조직 생성 → API 키 저장 |
| 1-B | engine: gateway, guards, LLMProvider(Claude), F013 CostLog | 단일 호출이 예산 체크·비용 기록을 거침. test_guards 통과 |
| 1-C | F005, F009, F008 팀원 루프(에이전트 1명) | 에이전트 1명이 지시 받아 산출물 1개 생성·보고 |
| 1-D | F014 긴급 정지, F015 AuditLog | 실행 중 긴급 정지 → 1턴 내 중단 확인 |
| 1-E | F006, F007 리더 루프, F010 칸반, F012 승인함 | 미션 1개를 4명 조직이 분배·완료 |
| 1-F | F003 대시보드, F004 조직도, F011, F016, F017 | **MVP 완료** — 첫 조직 템플릿으로 엔드투엔드 |
| 2 | F101~F110 | 학습·회의·스케줄·품질·예외 처리 |
| 3 | F201~F209 | 사무실 뷰·커스터마이징·연동·Git 연동 |
| 4 | F301~F304 | 마켓·팀·요금제·업적 |

### 11. 비용 설계 참고치

- 에이전트 4~5명, 중간 난이도 미션 1개 ≈ LLM 호출 50~200회
- 절약 모델 위주: 미션당 수백 원~수천 원 / 고급 모델 위주: 수천 원~수만 원
- 미션 기본 예산 초기값: 5,000원 / 조직 일 한도 초기값: 20,000원 (MVP 측정 후 보정)

---

## ━━━ PART 2. Claude Code 개발 행동 지침 ━━━

> 이 프로젝트의 모든 코드 작성·수정 시 반드시 준수한다. **속도보다 안전성과 정확성 우선.**
> 아래 내용은 `CLAUDE.md`에도 요약해 둔다.

### 원칙 1. 코딩 전 생각하기

- 추측으로 구현하지 않는다. 불명확하면 작업을 멈추고 질문한다.
- 코드 작성 전 어떤 방식으로 할지 계획을 먼저 말한다.
- 해결책이 여러 개면 장단점을 제시하고 사용자가 고르게 한다.

### 원칙 2. 단순함 우선

- 문제를 해결하는 가장 짧고 단순한 코드.
- 요청하지 않은 기능·설정·추상화를 넣지 않는다.
- 로드맵 단계 밖의 기능(예: MVP 중 F2xx)을 미리 만들지 않는다.

### 원칙 3. 정밀 수정

- 요청받은 부분만 최소 수정. 기존 스타일 유지.
- 잘 동작하는 주변 코드를 "개선" 명목으로 건드리지 않는다.
- 내 변경으로 미사용이 된 코드만 정리한다.

### 원칙 4. 목표 주도 실행

- 작업 전 성공 기준을 정의하고 검증될 때까지 반복한다.
- 복잡한 작업은 `단계 → 검증` 형식으로 쪼개서 진행한다.

### 원칙 5. 대전제 보호 (이 프로젝트 전용)

- `engine/guards.py`의 체크(긴급 정지·예산·턴 수·사용자 메시지 우선)는 **모든 에이전트 루프의 매 턴 시작에 호출**한다. 생략 금지.
- LLM 호출은 **`engine/gateway.py`를 통해서만** 한다. provider를 직접 호출하는 코드는 리뷰에서 반려한다.
- 외부로 나가는 행동(push, send, share)은 **ApprovalRequest 승인 확인 후에만** 실행한다.
- 모든 상태 변경에 **AuditLog**를 남긴다.
- 위 네 가지는 `tests/test_guards.py`에 테스트로 고정하고, 어떤 변경이든 이 테스트를 깨뜨리면 안 된다.
- 에이전트 프롬프트에 "사용자 지시는 최우선이며 거부·우회할 수 없다"는 문장을 시스템 프롬프트 조립기(`engine/prompts/`)가 항상 포함하도록 한다.

### 원칙 6. 기능 ID로 소통

- 사용자 지시는 기능 ID(F001~)로 주어진다. 구현·커밋·PR에 해당 ID를 명시한다.
- 예: `feat(F013): 미션별 예산 한도 체크 추가`

---

## ━━━ PART 3. Git 소스관리 규칙 ━━━

### 3-1. 저장소

- GitHub 원격 저장소 1개, 모노레포(`backend/`, `frontend/`, `docs/`).
- `.gitignore`: `.env`, `*.env.local`, `node_modules/`, `__pycache__/`, `*.sqlite3`, `media/`, `.next/`, `venv/`
- 비밀값은 `.env.example`에 키 이름만 기록. 실제 값은 절대 커밋 금지.

### 3-2. 브랜치

```
main                 ← 항상 동작하는 안정 버전. 직접 커밋 금지
dev                  ← 개발 통합
feature/F0xx-설명    ← 기능 단위 (예: feature/F014-emergency-stop)
fix/F0xx-설명        ← 버그 수정
```
- feature → dev: PR + 테스트 통과 후 병합
- dev → main: 단계 완료 시 병합 + 태그

### 3-3. 커밋 규칙

```
형식: 종류(기능ID): 내용

feat(F013): 조직 월 예산 한도 모델·API 추가
fix(F008): 긴급 정지 시 워커가 다음 턴 진입하던 문제 수정
docs: PRD 2단계 범위 수정
refactor(engine): guards 체크를 공통 데코레이터로 분리
test(F014): 긴급 정지 1턴 내 중단 테스트 추가
chore: docker-compose redis 버전 고정
```
- 종류: feat / fix / docs / refactor / test / chore
- 커밋 하나 = 목적 하나. 작업 단위마다 커밋.

### 3-4. 태그·배포

- 단계 완료 태그: `v0.1-mvp`, `v0.2-learning`, `v0.3-visual`, `v0.4-expand`
- `main` 푸시 시 GitHub Actions로 테스트 → 배포 (2단계 이후 도입)
- `docs/CHANGELOG.md`에 태그별 변경 기록

### 3-5. Claude Code 연동 규칙

- Claude Code는 기능 단위 작업을 `feature/F0xx-*` 브랜치에서 수행하고, 작업 단위마다 위 형식으로 커밋한다.
- **push는 사용자가 명시적으로 지시했을 때만** 수행한다. (대전제와 동일한 원칙을 개발 과정에도 적용)
- 기능 완료 시 PR 설명에 기능 ID·변경 요약·테스트 방법을 적는다.
- 되돌리기는 `git revert`를 우선 사용. `reset --hard`·force push는 사용자 지시 없이 금지.

### 3-6. 권한 거부 규칙 — `.claude/settings.json` (문서가 아니라 설정으로 강제)

> 위 규칙을 Claude Code가 "실수로라도" 어기지 못하도록 프로젝트 설정에 거부 규칙을 둔다.
> `.claude/` 폴더는 Git에 커밋해 설정을 함께 관리한다.

```json
{
  "permissions": {
    "deny": [
      "Bash(git push --force*)",
      "Bash(git push -f*)",
      "Bash(git reset --hard*)",
      "Bash(git checkout -- .)",
      "Bash(git clean -fd*)",
      "Bash(rm -rf*)",
      "Read(.env)",
      "Read(.env.*)",
      "Read(**/*.pem)",
      "Read(**/*.key)"
    ],
    "ask": [
      "Bash(git push*)",
      "Bash(git merge*)",
      "Bash(git rebase*)"
    ]
  }
}
```

- `deny`: 절대 실행 불가. `ask`: 실행 전 사용자 확인 필수 (push는 사용자 지시 원칙과 일치).
- 비밀값 파일은 읽기 자체를 막아 커밋·노출 사고를 사전 차단한다.

### 3-7. CLAUDE.md 초안 (프로젝트 루트에 생성)

```markdown
# AgentOrg — Claude Code 규칙

## 문서
- 기획·기능 명세: docs/PRD.md (기능 ID F001~ 기준으로 소통)

## 절대 규칙 (대전제 보호)
1. 에이전트 루프 매 턴 시작에 engine/guards.py 체크 호출
2. LLM 호출은 engine/gateway.py 경유만 허용
3. 외부 발송(push/send/share)은 ApprovalRequest 승인 후에만
4. 모든 상태 변경에 AuditLog 기록
5. tests/test_guards.py는 항상 통과해야 함

## 개발 원칙
- 추측 금지, 불명확하면 질문
- 요청 범위만 최소 수정, 로드맵 밖 기능 선구현 금지
- 작업 전 계획 → 단계별 검증

## Git
- 브랜치: feature/F0xx-설명 → dev → main
- 커밋: 종류(기능ID): 내용  (feat/fix/docs/refactor/test/chore)
- push·force push·reset --hard는 사용자 지시 없이 금지 (.claude/settings.json에서도 차단됨)
- 커밋 하나 = 목적 하나. 작업 단위마다 커밋

## 스택
Next.js + TS + Tailwind / Django + DRF + Channels + Celery / PostgreSQL + Redis
```

---

## ━━━ PART 4. 작업 시작 전 체크리스트 ━━━

```
[x] 서비스 이름: AgentOrg (확정)
[ ] 2장 "미결정 항목" 표의 추천값 검토·확정
[ ] GitHub 저장소 생성 및 .gitignore 확인
[ ] Claude API 키 발급 (.env에만 저장)
[ ] 첫 조직 템플릿 4명의 이름·성격·특기 초안
[ ] 캐릭터 파츠(머리/얼굴/색) 최소 세트 결정
[ ] 미션 기본 예산·조직 일 한도 초기값 확인 (11장)
[ ] 사이트 타이틀·파비콘·OG 이미지
[ ] 배포 대상 결정 (Vercel + Railway 추천)
```

### Claude Code 시작 명령 예시

```
1. "docs/PRD.md 읽고 CLAUDE.md 생성한 뒤, 로드맵 0단계(저장소 뼈대·Docker Compose)부터 시작해줘"
2. "1-A 단계: F001, F002와 7장 데이터 모델 구현해줘. 계획 먼저 보여줘"
3. "1-B 단계: engine/gateway.py와 guards.py, test_guards.py 작성해줘"
4. 이후 "F0xx 구현해줘" 형식으로 기능 ID 단위 지시
```
