#!/usr/bin/env bash
# VM pull 방식 자동 배포 (PRD 12장). systemd 타이머가 2분마다 실행한다.
#   사용법: deploy/deploy.sh dev|prod      (강제 재배포: FORCE=1 deploy/deploy.sh dev)
# 새 커밋이 있을 때만 git pull → docker compose up -d --build 한다.
# .env에 없는 비밀값은 자동 생성한다 (PRD 12장 "서버 자동화"). 값은 출력하지 않는다.
#
# git pull이 이 파일 자체를 바꿀 수 있으므로, 전체를 함수로 읽어 둔 뒤 실행하고
# pull 후에는 새 버전으로 다시 실행한다 (DEPLOY_REEXEC).
set -euo pipefail

# .env에 이름이 없으면 무작위 값을 추가하고 0을 반환한다.
ensure_secret() {
  local name="$1" bytes="$2"
  grep -q "^${name}=" .env && return 1
  printf '%s=%s\n' "$name" "$(openssl rand -hex "$bytes")" >> .env
  echo "[deploy] ${name} 자동 생성 (.env에 추가, 값은 표시하지 않음)"
}

main() {
  local stack="${1:-}"
  local branch
  case "$stack" in
    dev) branch=dev ;;
    prod) branch=main ;;
    *) echo "사용법: $0 dev|prod" >&2; exit 2 ;;
  esac

  cd "$(dirname "$0")/.."

  if [ ! -f .env ]; then
    echo "[deploy:$stack] .env 없음 — docs/DEPLOY.md의 .env 만들기 단계를 먼저 실행" >&2
    exit 1
  fi

  local added=0
  ensure_secret AUTH_SECRET 32 && added=1
  ensure_secret ENCRYPTION_KEY 32 && added=1 # AES-256 키 (hex 64자)

  if [ "${DEPLOY_REEXEC:-0}" != "1" ]; then
    git fetch --quiet origin "$branch"
    local local_rev remote_rev
    local_rev="$(git rev-parse HEAD)"
    remote_rev="$(git rev-parse "origin/$branch")"

    if [ "$local_rev" = "$remote_rev" ] && [ "${FORCE:-0}" != "1" ] && [ "$added" = "0" ]; then
      exit 0 # 변경 없음
    fi

    echo "[deploy:$stack] ${local_rev:0:7} → ${remote_rev:0:7} 배포 시작"
    git checkout --quiet "$branch"
    git pull --quiet --ff-only origin "$branch"
    DEPLOY_REEXEC=1 exec bash "$0" "$stack" # 새로 받은 deploy.sh로 이어서 실행
  fi

  docker compose -f docker-compose.yml -f "docker-compose.$stack.yml" up -d --build --remove-orphans
  docker image prune -f >/dev/null

  echo "[deploy:$stack] 완료: $(git log -1 --format='%h %s')"
}

main "$@"
exit
