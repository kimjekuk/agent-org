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
