# AgentOrg PRD + Claude Code 개발 가이드라인
> **Claude Code 전용 통합 문서** | 버전 1.2 | 2026-10-17
> AI 에이전트 조직 운영 웹사이트 — 캐릭터 에이전트들이 조직처럼 자율 협업하되, 사용자가 절대 통제권을 가진다.
> v1.1 변경: 기술 스택을 TypeScript 단일 스택 + Docker Compose 자체 호스팅(오라클 클라우드 등 어느 VM에나 배포)으로 확정. Claude Code 전달 가이드(PART 5) 추가.
> v1.2 변경: 서버 작업 자동화(비밀값 자동 생성·자동 마이그레이션·`/setup` 첫 계정). 배포를 기존 오라클 ARM VM(JStudio 동거) + Tailscale serve(도메인 없음)로 확정. 컨테이너 4개(caddy는 일반 공개 시 추가), 127.0.0.1 바인딩, VM pull 방식 자동 배포(systemd 타이머).

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
| 타겟 | 1차: 본인 전용 → 2차: 지인 공개 → 3차: 일반 공개(클라우드 웹서비스) |
| 디자인 방향 | 귀여운 캐릭터 + 깔끔한 관제 대시보드. 게임 같은 재미 + 업무 도구의 신뢰감 |
| 반응형 | 모바일(375px~) / 태블릿(768px~) / PC(1280px~). 모바일에서도 지시·결과 확인·긴급 정지 가능 |
| 차별점 | 실제 업무 결과물 + 귀여운 조직 운영 + 사용자 절대 통제 + 비용 제한의 결합 |
| 운영 전제 | 개발·운영자는 비개발자. 코드는 Claude Code가 작성. 따라서 **언어 1개, 운영 서버 최소, 어느 클라우드든 같은 방식으로 배포** |

### 2. 확정 사항 및 추천값

| 항목 | 값 | 비고 |
|------|----|------|
| 서비스 이름 | AgentOrg | 확정 |
| 1차 타깃 | 본인 전용 (단일 사용자) | 로그인은 넣되 회원가입 비공개 |
| 비용 방식 | 사용자 본인 API 키 등록 | 크레딧 판매는 4단계 |
| 기술 스택 | **TypeScript 단일** — Next.js + Node 워커 + PostgreSQL + Redis, Docker Compose | 확정, 6장 참고 |
| 배포 | **Docker Compose 자체 호스팅** — 기존 오라클 ARM VM(JStudio와 동거), 접속·HTTPS는 Tailscale serve, 도메인 없음 | 확정, 12장 참고 |
| 개발 방식 | **로컬 설치 없음** — Claude Code 웹/앱 + GitHub + 오라클 dev 스택 자동 배포(VM pull). 확인은 휴대폰 브라우저 | 확정, PART 5-7 참고 |
| 캐릭터 그래픽 | 2D 일러스트 SVG (파츠 조합식) | 추천값 |
| MVP 도구 범위 | 웹 검색 + 문서 작성/요약 | 코드 실행은 2단계 |
| 첫 조직 템플릿 | 콘텐츠 제작팀 4명 — 리더 **하나**(차분·꼼꼼 / 기획·업무 분배·최종 검토), 리서처 **두리**(호기심·끈기 / 웹 검색·자료 정리·출처 확인), 작가 **세찬**(밝음·표현력 / 글쓰기·요약·구성), 검수 **네모**(깐깐·정확 / 사실 확인·맞춤법·품질 점검) | 확정 (2026-10-18) |
| 캐릭터 파츠 | 머리 4종(단발·곱슬·묶음·모자) × 표정 4종(웃음·진지·놀람·윙크) × 색 6종, SVG | 확정 (2026-10-18) |
| 웹 검색 | Claude 내장 웹 검색 (1회 14원 = $10/1,000회, CostLog에 포함). 일반 모델에서만 사용, 절약 모드에서는 검색 없이 진행 | 확정 (2026-10-18) |
| LLM 제공사 | Claude 기본 + OpenAI·Gemini·DeepSeek (OpenAI 호환 어댑터, 2026-10-18 추가) | 모델로 제공사 선택. 추가 모델·요금은 설정에서 사용자가 공식 페이지 보고 입력·확인 후 켜기. 웹 검색은 Claude만 |
| 기본 모델 | 일반용 Claude Sonnet 5.5 (`claude-sonnet-5-5`) / 절약용 Claude Haiku 5.5 (`claude-haiku-5-5`) | 확정 (2026-10-17). 예산 80% 이상에서 절약용으로 자동 전환 |
| 원화 환산 | 1달러 = 1,400원 고정 (`USD_KRW` 환경변수로 변경 가능) | 확정 (2026-10-17) |

### 3. 기능 명세 (Feature ID 기준)

#### 3-1. MVP (1단계) — 반드시 포함

| 기능 ID | 기능명 | 설명 |
|---------|--------|------|
| F001 | 로그인 / 계정 | 이메일 로그인(Auth.js), API 키 등록·암호화 저장. 첫 계정은 **사용자가 0명일 때만 열리는 설정 화면**(`/setup`)에서 생성 |
| F002 | 조직 생성·선택 | 조직 CRUD, 조직 템플릿 1종으로 시작, 사용자당 조직 여러 개 |
| F003 | CEO 대시보드 (관제) | 조직 상태·진행 중 미션·예산 사용률·알림·**긴급 정지 버튼** 한 화면 |
| F004 | 조직도 | 상하관계 트리 편집(드래그), 직급 지정, 직접 지시 진입점 |
| F005 | 에이전트 채용·프로필 | 이름·캐릭터·성격·특기·직급·모델·도구 권한·예산 설정. 복제·해고·삭제 |
| F006 | 미션 생성 | 주제·목표·성공 기준·마감·예산·우선순위·산출물 형식·자율성 수준 |
| F007 | 자율 업무 분배 | 리더 에이전트가 미션을 Task로 분해 → 특기 기반 배분 → 메시지로 지시 |
| F008 | 에이전트 실행 루프 | 지시 수신 → 계획 → 도구 사용 → 산출물 작성 → 상위 보고. 매 턴 emergency_stop 체크 |
| F009 | 에이전트 간 메시지 | 지시/보고/질문/제안 4종 고정 형식. 사용자 메시지 최우선 |
| F010 | 미션 상세 (칸반 + 로그) | 할 일/진행/검토/완료 보드, 에이전트 대화 로그 실시간(SSE) |
| F011 | 산출물 보관함 | 산출물 목록·상세·버전·되돌리기·평가 점수(1~5) |
| F012 | 승인 대기함 | 에이전트의 질문·제안·외부 발송 요청을 모아 승인/거절/보류 |
| F013 | 비용 제한 | 조직/에이전트/미션 예산 한도, CostLog 실시간 기록, 70·80% 경고, 초과 시 자동 중단 |
| F014 | 긴급 정지 | 모든 화면 접근 가능. 켜지면 전 워커 즉시 중단. 재개는 사용자만 |
| F015 | 감사 로그 (AuditLog) | 모든 에이전트 행동·판단 근거 기록, 열람 UI |
| F016 | 출근 브리핑 | 미접속 동안의 진행·막힌 작업·승인 대기·예산 경고 요약 |
| F017 | 모바일 대응 (반응형 + PWA) | 모바일 우선 레이아웃 전 페이지 공통. PWA로 홈 화면 설치 가능, 오프라인 시 안내 화면. 상세는 5장 "모바일 규칙" |

#### 3-2. 2단계 — 학습·조직 심화

| 기능 ID | 기능명 | 설명 |
|---------|--------|------|
| F101 | 기억 3단계 | 단기(작업)·중기(미션)·장기(교훈·노하우). 사용자 열람·수정·초기화 |
| F102 | 성장 시스템 | 경험치·레벨·특기 강화·승진. 비용 효율 반영 |
| F103 | 성격·상태 | 성격 유형, 상태(작업/대기/휴식/학습/막힘), 하루 일지 |
| F104 | 회의 | 킥오프·회고 회의. 사용자 끼어들기 가능 (2026-10-19: 담당이 한 바퀴 의견 → 리더 결론, 킥오프 결론은 Task 지시에·회고 교훈은 장기 기억, 회의록 답글 → 리더가 결론 반영, 미션별 끄기) |
| F105 | 조직 지식 베이스 | 산출물·조사 자료 위키화, 검색·재활용 |
| F106 | 스케줄링 | 반복 미션·예약 지시·조건 트리거·근무 시간 설정 (BullMQ 반복 작업) |
| F107 | 품질 관리 | 체크리스트 자기검토, QA 에이전트, 반복 실패 에스컬레이션 (2026-10-19: 점검표는 프롬프트로·추가 호출 없음, QA 권한 에이전트가 리더 대신 검토, 반려 한도 초과 시 승인함 질문, 보드에 반려·실패 이력) |
| F108 | 역제안 | 에이전트 제안서 → 사용자 승인/거절/보류 (2026-10-19: 미션·지시 결과 끝에 제안, 승인하면 바로 미션 시작, 미션당 1개·대기 3개 제한) |
| F109 | 예외 처리 | 3회 실패→상위 보고→질문 카드, API 장애 대체 모델, 체크포인트 재개, 무한 토론 차단 |
| F110 | 코드 실행 도구 | 샌드박스 코드 실행, 도구 권한 에이전트별 ON/OFF (2026-10-19: Anthropic 코드 실행 도구, Sonnet·Opus만, 계산·표·데이터 정리) |

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

**F201 사무실 뷰 — 원하는 모습 (2026-10-18 사용자 결정)**
- 위에서 내려다본 픽셀아트 사무실 한 장: 개인 책상(모니터·의자) 여러 개, 회의 테이블, 리더 자리(유리 칸막이), 휴게 공간(소파·테이블), 탕비실(커피머신·정수기·복합기), 창문·화이트보드·책장·화분·시계·TV
- 캐릭터 머리 위에 이름표. 상태에 따라 위치·동작이 바뀜: 작업 중 = 자기 책상, 회의·검토 = 회의 테이블, 대기 = 휴게 공간, 막힘 = 자리에서 표시
- 캐릭터를 누르면 그 에이전트에게 바로 지시 (프로필·대화로 이동)
- 그림은 **직접 그린 픽셀아트 SVG** (외부 타일셋 미사용 → 라이선스 걱정 없음, 모바일에서 가벼움). 기존 아바타 파츠(머리·표정·색)를 도트 캐릭터로 재사용
- 375px에서는 사무실 전체가 화면에 맞게 축소되고, 확대·이동 가능
- 시점: 로드맵대로 3단계 (MVP 1-F에서는 만들지 않음)
- 구현 결정 (2026-10-20): 대시보드 맨 위 + /office 전체 화면(1~3배 확대), 상태가 바뀌면 걷듯 이동·타이핑·말풍선, 누르면 아래서 카드(바로 지시), 책상은 에이전트 수만큼 자동(최대 12)

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
| 인터랙션 | 실시간 갱신(SSE). 긴급 정지는 키보드 단축키 `Ctrl+Shift+S`도 지원 |

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
| 제출 | Mission 생성 → 리더에게 DIRECTIVE 메시지 → BullMQ 큐에 작업 등록 → F007 시작 |

#### F007 / F008 — 자율 분배 & 실행 루프 (워커 핵심)

```
[리더 루프]
  1. 미션 수신 → 성공 기준·예산 확인
  2. Task 분해 (3~8개) → 각 Task에 필요 특기 태깅
  3. 특기 일치도 + 현재 부하 기준으로 담당 배정
  4. 각 담당에게 DIRECTIVE 메시지 발송 (큐에 작업 등록)
  5. REPORT 수신 대기 → 검토 → 승인/반려
  6. 전 Task 완료 → 최종 산출물 통합 → 사용자에게 REPORT
     (체크포인트 모드면 단계마다 ApprovalRequest)

[팀원 루프 — 매 턴 시작 시 공통 체크 = guards.ts]
  ✔ org.emergency_stop ? → 즉시 종료
  ✔ 사용자 메시지 대기열 ? → 최우선 처리
  ✔ 예산 잔액 ? → 부족 시 절약 모델 전환 또는 중단 + 보고
  ✔ 턴 수 > max_turns ? → 중단 + 상위 보고
  1. DIRECTIVE 수신 → 계획 수립
  2. 도구 호출(권한 있는 것만)
  3. 산출물 작성 → Artifact 저장(버전+1)
  4. REPORT 발송 → Task 상태 REVIEW
  5. 3회 실패 → QUESTION 메시지를 상위에게 → 상위도 해결 못하면 사용자에게 ApprovalRequest(type=QUESTION)

[실시간 전달]
  워커가 Message/Task/CostLog를 DB에 쓸 때 Redis pub/sub으로 이벤트 발행
  → Next.js API(/api/events)가 SSE로 브라우저에 푸시
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

#### F017 — 모바일 규칙 (전 페이지 공통)

| 항목 | 규칙 |
|------|------|
| 설계 순서 | **모바일 화면을 먼저** 설계하고 PC로 넓힌다 (375px 기준) |
| 네비게이션 | 모바일: 하단 탭바 5개(대시보드·미션·승인함·에이전트·더보기). PC: 좌측 사이드바 |
| 긴급 정지 | 모바일에서도 상단에 항상 보이는 빨간 버튼. 엄지로 닿는 위치, 실수 방지 확인 모달 |
| 핵심 동작 | 지시 내리기 / 승인·거절 / 결과 읽기 / 긴급 정지 — 이 4가지는 모바일에서 **PC와 동일하게 완전 동작** |
| 칸반·조직도 | 모바일에서는 드래그 대신 탭 → 메뉴로 상태 변경·상사 변경 |
| 입력 | 지시 입력창은 하단 고정(채팅 앱 방식), 키보드 올라와도 가려지지 않게 |
| PWA | manifest + service worker. 홈 화면 "앱 설치" 지원, 앱 아이콘·스플래시, 오프라인 시 "연결 끊김" 안내 |
| 알림 | 승인 대기·예산 경고·미션 완료는 웹 푸시 알림(PWA)로 수신 (알림 채널 상세는 F207, 푸시 기반은 MVP에 포함) |
| 성능 | 모바일 데이터 고려: 로그는 페이지 단위 로딩, 이미지·SVG 경량화 |
| 터치 | 버튼 최소 44×44px, 호버 의존 UI 금지 |

### 6. 기술 스택 (확정)

```
언어        : TypeScript 단일 (프론트·API·워커 모두)
Frontend+API: Next.js 14+ (App Router) + Tailwind CSS + shadcn/ui
              모바일 우선. PWA(next-pwa 또는 Serwist) + Web Push(VAPID)
              상태: Zustand / 서버 상태: TanStack Query
              실시간: SSE (Route Handler + Redis pub/sub 구독)
인증        : Auth.js (이메일/비밀번호, 1차는 가입 비공개)
ORM         : Drizzle ORM + drizzle-kit 마이그레이션 (개발 중 Drizzle Studio로 데이터 조회)
워커        : Node 상시 프로세스 + BullMQ (큐·재시도·반복 작업·일시정지)
DB          : PostgreSQL 16 (JSONB로 에이전트 설정·메시지 본문 저장)
큐/실시간   : Redis 7 (BullMQ 큐 + pub/sub)
LLM         : @anthropic-ai/sdk 기본. packages/shared/llm/ 에 Provider 인터페이스 → OpenAI/Gemini 어댑터
              모든 호출은 gateway.ts 하나로만 (예산 체크 + CostLog 기록)
암호화      : API 키는 AES-256-GCM으로 암호화 저장 (키는 .env의 ENCRYPTION_KEY)
접속·HTTPS  : Tailscale serve (tailnet 전용, 운영 8443 / dev 10000). 일반 공개 시 Caddy + 도메인 추가 (12장)
패키지 관리 : pnpm 워크스페이스 모노레포
컨테이너    : Docker Compose — web / worker / postgres / redis (4개). 포트는 127.0.0.1에만 바인딩
```

**선정 이유**: 언어 1개라 비개발자가 에러를 따라가기 쉬움. 관리형 서비스(Supabase 등)에 묶이지 않아 오라클·AWS·GCP·네이버 어디든 `docker compose up` 한 번으로 동일하게 배포. 에이전트가 사용자 미접속 중에도 일하려면 상시 워커가 필수인데, BullMQ가 재시도·스케줄·일시정지를 기본 제공.

### 7. 핵심 데이터 모델 (Drizzle 스키마 기준)

```
users           id, email, password_hash, created_at
api_keys        id, user_id, provider, encrypted_key, created_at
organizations   id, owner_id, name, theme, emergency_stop(bool),
                autonomy_default(FULL|CHECKPOINT|MANUAL),
                budget_monthly, budget_daily, work_hours(jsonb), created_at
agents          id, org_id, name, avatar(jsonb), personality, rank(LEADER|MANAGER|MEMBER),
                supervisor_id(self, null), skills(jsonb[]), level, xp,
                model_primary, model_economy, max_turns, tool_permissions(jsonb),
                budget_limit, autonomy(null → org 기본값), status, is_active
missions        id, org_id, title, topic, goal, success_criteria(jsonb[]), deadline,
                budget_limit, priority, output_format, autonomy, leader_id,
                status(DRAFT|RUNNING|PAUSED|REVIEW|DONE|CANCELLED), created_at
tasks           id, mission_id, title, description, required_skills(jsonb[]),
                assignee_id, status(TODO|DOING|REVIEW|DONE), order, fail_count
messages        id, org_id, mission_id(null), task_id(null),
                sender_type(USER|AGENT|SYSTEM), sender_agent_id(null),
                receiver_agent_id(null), type(DIRECTIVE|REPORT|QUESTION|PROPOSAL),
                content(text), payload(jsonb), priority, read_at, created_at
artifacts       id, mission_id, task_id, agent_id, title, format, content(text), version,
                parent_version_id(self), rating(1~5, null), created_at
memories        id, agent_id, scope(SHORT|MID|LONG), mission_id(null), content, source, created_at
cost_logs       id, org_id, agent_id, mission_id, task_id, provider, model,
                input_tokens, output_tokens, cost, created_at
approval_requests id, org_id, agent_id, mission_id(null),
                type(QUESTION|PROPOSAL|EXTERNAL|CHECKPOINT|BUDGET),
                content, status(PENDING|APPROVED|REJECTED|HELD), decided_at, user_comment
audit_logs      id, org_id, actor_type(USER|AGENT|SYSTEM), actor_id, action, target_type,
                target_id, reasoning(text), payload(jsonb), created_at
```

### 8. 파일 구조

```
agent-org/                            ← pnpm 모노레포
├── CLAUDE.md                         ← Claude Code 규칙 (PART 3-7)
├── .claude/settings.json             ← 권한 거부 규칙 (PART 3-6)
├── docs/
│   ├── PRD.md                        ← 이 문서
│   ├── DEPLOY.md                     ← VM 설치 절차 (복붙용 명령)
│   ├── Caddyfile.example             ← 일반 공개 시 사용할 Caddy 초안 (12장 향후)
│   └── CHANGELOG.md
├── docker-compose.yml                ← dev·운영 공통 (서비스 정의)
├── docker-compose.dev.yml / docker-compose.prod.yml  ← dev·운영 스택별 포트·볼륨·DB 이름 (12장, 0-B)
├── deploy/                          ← deploy.sh + systemd 타이머 (VM pull 자동 배포)
├── .env.example
├── .gitignore
├── package.json / pnpm-workspace.yaml / turbo.json
│
├── packages/
│   └── shared/                       ← web·worker가 함께 쓰는 코드
│       ├── db/
│       │   ├── schema.ts             ← 7장 Drizzle 스키마
│       │   ├── client.ts
│       │   └── migrations/
│       ├── llm/
│       │   ├── provider.ts           ← Provider 인터페이스
│       │   ├── anthropic.ts / openai.ts
│       │   └── gateway.ts            ← 모든 LLM 호출의 단일 진입점 (예산 체크 + CostLog)
│       ├── crypto.ts                 ← API 키 암호화
│       ├── events.ts                 ← Redis pub/sub 발행·구독
│       └── types.ts
│
├── apps/
│   ├── web/                          ← Next.js
│   │   ├── app/
│   │   │   ├── (auth)/login/
│   │   │   ├── dashboard/            ← F003
│   │   │   ├── org/                  ← F004
│   │   │   ├── agents/[id]/          ← F005
│   │   │   ├── missions/[id]/        ← F006, F010
│   │   │   ├── artifacts/            ← F011
│   │   │   ├── approvals/            ← F012
│   │   │   ├── budget/               ← F013
│   │   │   ├── audit/                ← F015
│   │   │   ├── settings/
│   │   │   └── api/
│   │   │       ├── events/route.ts   ← SSE
│   │   │       └── .../route.ts      ← REST 엔드포인트
│   │   ├── components/
│   │   │   ├── EmergencyStopButton.tsx   ← F014 (레이아웃 상시 포함)
│   │   │   ├── AgentAvatar.tsx           ← SVG 파츠 조합
│   │   │   ├── AgentCard.tsx / KanbanBoard.tsx / ChatLog.tsx / OrgTree.tsx
│   │   ├── lib/
│   │   └── Dockerfile
│   │
│   └── worker/                       ← Node 상시 프로세스
│       ├── src/
│       │   ├── index.ts              ← BullMQ 워커 기동
│       │   ├── queues.ts
│       │   ├── guards.ts             ← emergency_stop·예산·턴 수·사용자 메시지 우선 체크
│       │   ├── loops/
│       │   │   ├── leader.ts
│       │   │   └── member.ts
│       │   ├── prompts/              ← 역할 프롬프트 조립 (대전제 문구 항상 포함)
│       │   └── tools/                ← webSearch.ts, document.ts (권한 체크 포함)
│       ├── test/
│       │   └── guards.test.ts        ← 대전제 검증 테스트 (최우선)
│       └── Dockerfile
```

### 9. 비기능 요구사항

| 항목 | 요구사항 |
|------|---------|
| 통제 | 긴급 정지 반영 지연 ≤ 1턴(수 초). 모든 외부 발송은 승인 필수 |
| 투명성 | 모든 에이전트 행동·판단 근거 AuditLog 기록. 숨겨진 상태 없음 |
| 비용 | 모든 LLM 호출은 gateway.ts 경유. 우회 호출 금지. 한도 초과 시 자동 중단 |
| 지속성 | 사용자 미접속 중에도 워커가 작업 지속. 컨테이너 재시작 시 BullMQ 작업 재개 |
| 이식성 | 관리형 서비스 의존 없음. `docker compose up`으로 어느 VM에서든 동일 동작. ARM64·AMD64 이미지 모두 빌드 |
| 보안 | API 키 암호화 저장, .env 미커밋, 업로드 자료 조직 외부 비공개, 포트는 127.0.0.1만 바인딩, 접속은 Tailscale(HTTPS) |
| 데이터 | 조직 데이터 JSON 전체 내보내기, 계정 삭제 시 완전 삭제, 매일 DB 덤프 백업 |
| 안전 | 유해·불법·개인정보 콘텐츠 필터, 결과물 "AI 생성" 표시 옵션 |
| 모바일 | 모바일 우선 설계. 375 / 768 / 1280px. 지시·승인·결과·긴급 정지 4가지는 모바일에서 PC와 동일 동작. PWA 설치·웹 푸시 지원 |
| 접근성 | 키보드 탐색, 다크 모드, 글자 크기 조절 |

### 10. 개발 로드맵

| 단계 | 범위 | 완료 기준 |
|------|------|-----------|
| 0-A | 모노레포·Docker Compose·CLAUDE.md·settings.json 뼈대 | 컨테이너 빌드 성공, 빈 페이지 표시 |
| 0-B | 기존 VM에 Docker 설치 + dev/운영 2스택 + 타이머 자동 배포 + Tailscale serve | `dev` 푸시 → `https://<서버>.ts.net:10000`에 빈 페이지 자동 반영. 휴대폰에서 접속 확인. JStudio 정상 동작 유지 |
| 1-A | F001, F002, 7장 스키마·마이그레이션 | 로그인 → 조직 생성 → API 키 암호화 저장 |
| 1-B | shared/llm: gateway, provider(anthropic) / worker: guards / F013 CostLog | 단일 호출이 예산 체크·비용 기록을 거침. guards.test 통과 |
| 1-C | F005, F009, F008 팀원 루프(에이전트 1명) | 에이전트 1명이 지시 받아 산출물 1개 생성·보고 |
| 1-D | F014 긴급 정지, F015 AuditLog, SSE 이벤트 | 실행 중 긴급 정지 → 1턴 내 중단, 화면에 실시간 반영 |
| 1-E | F006, F007 리더 루프, F010 칸반, F012 승인함 | 미션 1개를 4명 조직이 분배·완료 |
| 1-F | F003 대시보드, F004 조직도, F011, F016, F017(하단 탭바·PWA·푸시) | **MVP 완료** — 첫 조직 템플릿으로 PC·모바일 모두 엔드투엔드 |
| 1-G | 운영 스택 MVP 배포 (`dev → main` 머지) | `https://<서버>.ts.net:8443` 접속, 미션 1개 완주 |
| 2 | F101~F110 | 학습·회의·스케줄·품질·예외 처리 |
| 3 | F201~F209 | 사무실 뷰·커스터마이징·연동·Git 연동 |
| 4 | F301~F304 | 마켓·팀·요금제·업적 |

### 11. 비용 설계 참고치

- 에이전트 4~5명, 중간 난이도 미션 1개 ≈ LLM 호출 50~200회
- 절약 모델 위주: 미션당 수백 원~수천 원 / 고급 모델 위주: 수천 원~수만 원
- 미션 기본 예산 초기값: 5,000원 / 조직 일 한도 초기값: ~~20,000원~~ → **2,000원** (2026-10-18 결정: Max 5x 월 API 크레딧 $100 안에서 사용)
- 기본 모델 (2026-10-18 결정): Claude Haiku 5.5, 웹 검색 권한이 있는 에이전트만 Claude Sonnet 5.5 (Haiku는 웹 검색 미지원)
- 서버비: 오라클 Always Free 범위에서 MVP~2단계 **0원** 목표. 실비용은 LLM API뿐

### 12. 배포 — 기존 오라클 ARM VM + Tailscale (도메인 없음)

**전제 (2026-10-17 서버 확인)**
- 새 서버를 만들지 않고 **JStudio가 돌고 있는 기존 오라클 VM**에 함께 올린다: Ampere A1 (aarch64), 4코어 / 24GB, Ubuntu 24.04
- 접속·HTTPS는 **Tailscale serve**가 담당한다. 같은 Tailscale 네트워크(tailnet)의 기기에서만 열리고, 인터넷에는 공개하지 않는다
- 기존 점유 (건드리지 않음): JStudio `8000`, 서버 PostgreSQL `127.0.0.1:5432`, Tailscale HTTPS `443` → JStudio

**포트 배정**

| 스택 | 브랜치 | web 컨테이너 | Tailscale serve | 접속 주소 |
|------|--------|--------------|-----------------|-----------|
| 운영 | `main` | `127.0.0.1:3100` | HTTPS `8443` | `https://<서버>.ts.net:8443` |
| dev | `dev` | `127.0.0.1:3200` | HTTPS `10000` | `https://<서버>.ts.net:10000` |

- 모든 포트는 **127.0.0.1에만** 바인딩한다. 인터넷에 직접 노출 금지
- postgres·redis는 호스트 포트를 열지 않는다 (컨테이너 내부 네트워크에서만 통신)

**dev / 운영 2스택**
- 컨테이너 4개: web / worker / postgres / redis
- `docker-compose.yml`(공통) + `docker-compose.dev.yml` / `docker-compose.prod.yml`(스택별 프로젝트 이름·포트)
- 폴더 분리: `/opt/agentorg/dev`(`dev` 브랜치), `/opt/agentorg/prod`(`main` 브랜치). 각 폴더에 `.env`를 따로 둔다 (DB 이름 `agentorg_dev` / `agentorg_prod`)
- 볼륨은 compose 프로젝트 이름(`agentorg-dev` / `agentorg-prod`)으로 자동 분리된다

**자동 배포 — VM이 가져가는 방식 (pull)**
- systemd 타이머 `agentorg-deploy@dev.timer` / `agentorg-deploy@prod.timer`가 2분마다 `deploy/deploy.sh` 실행
- `deploy.sh`: `git fetch` → 새 커밋이 있으면 `git pull --ff-only` → `docker compose up -d --build`
- 저장소 읽기는 **읽기 전용 Deploy key**(VM에서 생성, GitHub 저장소 설정에 등록). GitHub에서 VM으로 들어오는 접속은 없다
- 배포 기록 확인: `journalctl -u agentorg-deploy@dev -n 50`

**설치 절차**: `docs/DEPLOY.md` (복붙용 명령)

**서버 자동화 — 서버 명령 최소화 (v1.2, 2026-10-17 결정)**
- Claude Code는 서버에 접속하지 않는다 (SSH 키를 클라우드에 두지 않음). 서버 작업은 자동 배포 과정이 스스로 처리한다
- 비밀값: `deploy.sh`가 `.env`에 없는 키(`AUTH_SECRET`, `ENCRYPTION_KEY`, 이후 웹 푸시 키 등)를 **자동 생성해 추가**한다. 값은 로그·화면에 출력하지 않는다
- DB 구조: 배포 때 Drizzle 마이그레이션을 자동 실행한다
- 첫 계정: 서버 명령 대신 `/setup` 화면 (사용자 0명일 때만 표시, tailnet 안에서만 접근 가능)
- 사용자가 서버에 직접 접속하는 경우: DB 백업 설정(1회), 장애 원인 확인

**백업**
- cron으로 매일 `pg_dump` → Oracle Object Storage(또는 다른 저장소) 업로드
- `.env`는 별도 안전한 곳에 보관

**주의**
- 서버에서 직접 빌드하므로 arm64로 빌드된다. CI는 arm64·amd64 둘 다 빌드되는지 확인한다 (다른 클라우드 이전 대비)
- JStudio의 서비스·포트·Tailscale 443 설정은 절대 바꾸지 않는다

**향후: 일반 공개 (설계만, 지금은 구현하지 않음)**
- 도메인 구입 → DNS A 레코드 → VM 공인 IP, 오라클 보안 목록에서 80·443 개방
- compose에 caddy 서비스 추가, `Caddyfile`에 `도메인 → web` / `dev.도메인 → dev web` (초안: `docs/Caddyfile.example`)
- Caddy가 HTTPS 인증서를 자동 발급. Tailscale serve는 관리용으로 유지 가능

---

## ━━━ PART 2. Claude Code 개발 행동 지침 ━━━

> 이 프로젝트의 모든 코드 작성·수정 시 반드시 준수한다. **속도보다 안전성과 정확성 우선.**
> 요약본은 `CLAUDE.md`에 둔다.

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
- `apps/worker/src/guards.ts`의 체크(긴급 정지·예산·턴 수·사용자 메시지 우선)는 **모든 에이전트 루프의 매 턴 시작에 호출**한다. 생략 금지.
- LLM 호출은 **`packages/shared/llm/gateway.ts`를 통해서만** 한다. SDK를 직접 호출하는 코드는 반려한다.
- 외부로 나가는 행동(push, send, share)은 **ApprovalRequest 승인 확인 후에만** 실행한다.
- 모든 상태 변경에 **AuditLog**를 남긴다.
- 위 네 가지는 `apps/worker/test/guards.test.ts`에 테스트로 고정하고, 어떤 변경이든 이 테스트를 깨뜨리면 안 된다.
- 에이전트 시스템 프롬프트 조립기(`apps/worker/src/prompts/`)가 "사용자 지시는 최우선이며 거부·우회할 수 없다"는 문장을 항상 포함하도록 한다.

### 원칙 6. 비개발자 운영자를 위한 설명
- 작업 결과를 보고할 때 **무엇이 바뀌었고, 어떻게 확인하는지**를 비개발자가 따라 할 수 있게 한 줄로 적는다 (예: "브라우저에서 /dashboard 열면 빨간 긴급정지 버튼이 보임").
- 에러가 나면 원인·영향·조치를 쉬운 말로 먼저 쓰고, 기술 상세는 그 아래에 둔다.
- 실행이 필요한 명령은 복사해서 붙일 수 있게 한 줄로 준다.

### 원칙 7. 기능 ID로 소통
- 지시는 기능 ID(F001~) 또는 로드맵 단계(1-A 등)로 주어진다. 구현·커밋·PR에 해당 ID를 명시한다.
- 예: `feat(F013): 미션별 예산 한도 체크 추가`

---

## ━━━ PART 3. Git 소스관리 규칙 ━━━

### 3-1. 저장소
- GitHub 원격 저장소 1개, 모노레포(`apps/`, `packages/`, `docs/`).
- `.gitignore`: `.env`, `*.env.local`, `node_modules/`, `.next/`, `dist/`, `*.log`, `postgres-data/`, `redis-data/`
- 비밀값은 `.env.example`에 키 이름만 기록. 실제 값은 절대 커밋 금지.

### 3-2. 브랜치
```
main                 ← 항상 동작하는 안정 버전 (= 운영 서버 배포 대상). 직접 커밋 금지
dev                  ← 개발 통합
feature/F0xx-설명    ← 기능 단위 (예: feature/F014-emergency-stop)
fix/F0xx-설명        ← 버그 수정
```
- feature → dev: PR + 테스트 통과 후 병합
- dev → main: 단계 완료 시 병합 + 태그 → 운영 서버에서 `git pull`

### 3-3. 커밋 규칙
```
형식: 종류(기능ID): 내용

feat(F013): 조직 월 예산 한도 스키마·API 추가
fix(F008): 긴급 정지 시 워커가 다음 턴 진입하던 문제 수정
docs: PRD 2단계 범위 수정
refactor(worker): guards 체크를 공통 함수로 분리
test(F014): 긴급 정지 1턴 내 중단 테스트 추가
chore: docker-compose redis 버전 고정
```
- 종류: feat / fix / docs / refactor / test / chore
- 커밋 하나 = 목적 하나. 작업 단위마다 커밋.

### 3-4. 태그·배포
- 단계 완료 태그: `v0.1-mvp`, `v0.2-learning`, `v0.3-visual`, `v0.4-expand`
- PR·`dev`·`main` 푸시 시 GitHub Actions로 테스트. 배포는 VM 타이머가 `dev`·`main`을 가져가 자동 반영 (12장)
- `docs/CHANGELOG.md`에 태그별 변경 기록

### 3-5. Claude Code 연동 규칙
- 기능 단위 작업은 `feature/F0xx-*` 브랜치에서 수행하고, 작업 단위마다 위 형식으로 커밋한다.
- **push는 사용자가 명시적으로 지시했을 때만** 수행한다.
- 기능 완료 시 PR 설명에 기능 ID·변경 요약·테스트 방법을 적는다.
- 되돌리기는 `git revert`를 우선 사용. `reset --hard`·force push는 사용자 지시 없이 금지.

### 3-6. 권한 거부 규칙 — `.claude/settings.json`

> 규칙을 Claude Code가 실수로라도 어기지 못하도록 설정으로 강제한다. `.claude/` 폴더는 Git에 커밋한다.

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
      "Bash(docker compose down -v*)",
      "Read(.env)",
      "Read(.env.*)",
      "Read(**/*.pem)",
      "Read(**/*.key)"
    ],
    "ask": [
      "Bash(git push*)",
      "Bash(git merge*)",
      "Bash(git rebase*)",
      "Bash(docker compose down*)"
    ]
  }
}
```
- `deny`: 절대 실행 불가. `ask`: 실행 전 사용자 확인.
- `docker compose down -v`는 DB 볼륨까지 지우므로 차단.

### 3-7. CLAUDE.md (프로젝트 루트에 그대로 생성)

```markdown
# AgentOrg — Claude Code 규칙

## 문서
- 기획·기능 명세: docs/PRD.md (기능 ID F001~, 로드맵 단계 1-A~ 기준으로 소통)
- 배포 절차: docs/DEPLOY.md
- 진행 상황·작업 권한: docs/TODO.md (작업 시작 전에 반드시 읽기)

## 절대 규칙 (대전제 보호)
1. 에이전트 루프 매 턴 시작에 apps/worker/src/guards.ts 체크 호출
2. LLM 호출은 packages/shared/llm/gateway.ts 경유만 허용
3. 외부 발송(push/send/share)은 ApprovalRequest 승인 후에만
4. 모든 상태 변경에 AuditLog 기록
5. apps/worker/test/guards.test.ts는 항상 통과해야 함

## 개발 원칙
- 추측 금지, 불명확하면 질문. 작업 전 계획 → 단계별 검증
- 요청 범위만 최소 수정, 로드맵 밖 기능 선구현 금지
- 모바일 우선: 모든 화면은 375px에서 먼저 확인. 지시·승인·결과·긴급정지는 모바일 완전 동작
- 운영자는 비개발자: 결과 보고는 "무엇이 바뀌었고 어떻게 확인하는지" 한 줄 + 복붙 가능한 명령

## 스택
TypeScript 단일. Next.js(App Router) + Auth.js + Drizzle / Node 워커 + BullMQ / PostgreSQL + Redis / Docker Compose (+ Tailscale serve)
실시간은 SSE(Redis pub/sub). 관리형 서비스 의존 금지 (어느 VM이든 compose로 배포). 포트는 127.0.0.1만, JStudio 포트(8000·5432·Tailscale 443) 사용 금지
Docker 이미지는 linux/arm64 + linux/amd64 모두 빌드

## Git
- 브랜치: feature/F0xx-설명 → dev → main
- 커밋: 종류(기능ID): 내용  (feat/fix/docs/refactor/test/chore)
- push·force push·reset --hard·compose down -v는 사용자 지시 없이 금지 (.claude/settings.json에서도 차단)
- 커밋 하나 = 목적 하나. 작업 단위마다 커밋
```

---

## ━━━ PART 4. 작업 시작 전 체크리스트 ━━━

```
[x] 서비스 이름: AgentOrg
[x] 기술 스택: TypeScript 단일 + Docker Compose
[x] 배포: 기존 오라클 ARM VM + Tailscale serve (도메인 없음)
[x] GitHub 저장소 agent-org 생성 (비공개)
[ ] Claude API 키 발급 (.env에만 저장)
[ ] 첫 조직 템플릿 4명의 이름·성격·특기 초안
[ ] 캐릭터 파츠(머리/얼굴/색) 최소 세트 결정
[x] 오라클 ARM VM (JStudio 서버 공용)
[ ] 휴대폰에 Tailscale 앱 설치·로그인 — 0-B 확인 전까지
[ ] 도메인 — 일반 공개할 때만 (지금은 불필요)
[ ] Claude Code 웹/앱에 GitHub 저장소 연결
```

---

## ━━━ PART 5. Claude Code에 전달하는 방법 ━━━

### 5-1. 원칙
- 문서를 통째로 던지지 않는다. **규칙은 CLAUDE.md로 항상 읽히게**, **명세는 PRD의 장 번호로 지목**해 필요한 부분만 읽게 한다.
- 한 지시 = 로드맵 한 칸 또는 기능 ID 1~2개. **완료 기준**을 같이 적는다.
- 큰 작업은 "계획 먼저 보여줘"로 시작한다. 코드 전에 방향을 잡으면 되돌리는 비용이 가장 적다.
- 기능 하나 끝나면 커밋 → 새 세션. 대화가 길어지면 컨텍스트가 흐려진다.
- 같은 실수가 반복되면 말로 고치지 말고 CLAUDE.md에 한 줄 추가한다.
- 기획이 바뀌면 PRD.md를 먼저 고치고(`docs:` 커밋) 그다음 코드 지시.

### 5-2. 처음 시작 (로컬 설치 없이)

1. GitHub에서 비공개 저장소 `agent-org` 생성 (README만 있는 빈 저장소)
2. GitHub 웹 화면에서 파일 3개 추가·커밋:
```
CLAUDE.md               ← PART 3-7 내용 그대로
.claude/settings.json   ← PART 3-6 내용 그대로
docs/PRD.md             ← 이 문서
```
3. Claude Code 웹/앱에서 이 저장소를 연결하고 첫 지시(5-3) 시작

### 5-3. 첫 지시 (복사해서 사용)

```
docs/PRD.md를 읽어줘. 아직 코드는 쓰지 말고,
PART 0 대전제, 6장 스택, 8장 파일 구조, 10장 로드맵을 이해한 뒤
0단계(모노레포 뼈대 + Docker Compose) 작업 계획만 먼저 보여줘.
```
계획이 맞으면 → `좋아, 0단계 진행해. 끝나면 docker compose up으로 기동되는지 확인하고 커밋해줘.`

### 5-4. 이후 지시 패턴

```
1-A 단계 진행해줘. F001, F002와 7장 스키마. 계획 먼저.
완료 기준: 로그인 → 조직 생성 → API 키 암호화 저장까지 브라우저에서 확인 가능.
```
```
1-B 단계: packages/shared/llm/gateway.ts, apps/worker/src/guards.ts, guards.test.ts.
PART 2 원칙 5 필수. 완료 기준: 테스트 통과.
```
```
F014 긴급 정지 구현해줘. 완료 기준: 실행 중 워커가 1턴 내 중단되는 테스트 통과,
/dashboard에 빨간 버튼 표시.
```

**피할 지시**: "PRD 전부 구현해줘"(너무 큼), "대시보드 예쁘게 해줘"(ID·완료 기준 없음)

### 5-5. 매 단계 마무리 문장
```
테스트 돌리고, 통과하면 feat(F0xx): … 형식으로 커밋하고 dev 브랜치로 PR 올려줘.
그리고 내가 휴대폰 브라우저에서 뭘 확인하면 되는지 한 줄로 알려줘.
```
PR을 머지하면 2분 안에 VM 타이머가 dev 스택에 자동 배포 → 휴대폰으로 `https://<서버>.ts.net:10000` 접속해 확인.
만족스러우면: `dev를 main에 머지해줘.` → 운영 스택(`:8443`) 자동 배포.

### 5-6. 권장 첫 7개 명령 (순서대로)
```
1. "docs/PRD.md 읽고 0-A 계획 보여줘" → 승인 → 실행
1-2. "0-B: 12장 보고 VM 세팅 명령을 순서대로 정리해줘 + 배포 스크립트·타이머 작성해줘" → VM에서 복붙 1회
2. "1-A: F001, F002, 7장 스키마. 계획 먼저"
3. "1-B: gateway/guards/guards.test. PART 2 원칙 5 필수"
4. "1-C: F005, F009, F008 팀원 루프. 에이전트 1명이 지시→산출물→보고까지"
5. "1-D: F014 긴급 정지 + F015 AuditLog + SSE. 1턴 내 중단 테스트 포함"
6. "1-E: F006, F007 리더 루프, F010 칸반, F012 승인함. 4명 조직이 미션 1개 완주"
7. "1-F: F003, F004, F011, F016, F017(하단 탭바·PWA·푸시). PC와 휴대폰 둘 다 확인. MVP 완료"
→ 이후 "1-G: dev를 main에 머지해줘" → 운영 자동 배포
```

### 5-7. 원격 개발 흐름 (로컬 PC 불필요)

```
[휴대폰/PC 브라우저]
   │ 지시
   ▼
Claude Code 웹/앱 ──PR──▶ GitHub (dev 브랜치) ◀──2분마다 pull── 오라클 VM dev 스택
   ▲                                                                       │
   └──────── 휴대폰 브라우저(Tailscale)로 <서버>.ts.net:10000 접속해 확인 ◀──────┘

만족하면 "dev → main 머지" 지시 → 운영 스택(:8443) 자동 배포
```

| 역할 | 어디서 |
|------|--------|
| 코드 작성·단위 테스트 | Claude Code 웹/앱의 클라우드 샌드박스 |
| 실제 동작 확인 | 오라클 VM dev 스택 (휴대폰 브라우저) |
| 운영 | 오라클 VM 운영 스택 (`main` 머지 때만 변경) |
| 비상 시 서버 직접 확인 | SSH로 VM 접속 (평소엔 불필요) |

- 비밀값(.env)은 GitHub에 올리지 않고 VM의 스택별 `.env`에만 둔다. VM은 읽기 전용 Deploy key로 저장소를 가져간다
- 샌드박스에서는 Docker 전체를 띄우기 어려우므로 **통합 동작 확인은 반드시 dev 서버에서** 한다
- ARM VM(4코어/24GB)이면 JStudio + dev·운영 2스택을 한 대에 올려도 충분하다
