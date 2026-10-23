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
- 운영자는 타이핑이 어렵다: 모든 응답 끝에 AskUserQuestion으로 다음 지시 후보 2~4개를 선택지로 제시한다 (추천안은 첫 번째 + "(추천)"). "직접 입력"은 도구의 기타(Other) 칸으로 항상 열려 있음

## 스택
TypeScript 단일. Next.js(App Router) + Auth.js + Drizzle / Node 워커 + BullMQ / PostgreSQL + Redis / Docker Compose (+ Tailscale serve)
실시간은 SSE(Redis pub/sub). 관리형 서비스 의존 금지 (어느 VM이든 compose로 배포). 포트는 127.0.0.1만, JStudio 포트(8000·5432·Tailscale 443) 사용 금지
Docker 이미지는 linux/arm64 + linux/amd64 모두 빌드

## Git
- 브랜치: feature/F0xx-설명 → dev → main
- 커밋: 종류(기능ID): 내용  (feat/fix/docs/refactor/test/chore)
- push·force push·reset --hard·compose down -v는 사용자 지시 없이 금지 (.claude/settings.json에서도 차단)
- 커밋 하나 = 목적 하나. 작업 단위마다 커밋
