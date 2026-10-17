#!/usr/bin/env bash
# VM pull 방식 자동 배포 (PRD 12장). systemd 타이머가 2분마다 실행한다.
#   사용법: deploy/deploy.sh dev|prod      (강제 재배포: FORCE=1 deploy/deploy.sh dev)
# 새 커밋이 있을 때만 git pull → docker compose up -d --build 한다.
#
# git pull이 이 파일 자체를 바꿀 수 있으므로, 전체를 함수로 읽어 둔 뒤 실행한다.
set -euo pipefail

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

  git fetch --quiet origin "$branch"
  local local_rev remote_rev
  local_rev="$(git rev-parse HEAD)"
  remote_rev="$(git rev-parse "origin/$branch")"

  if [ "$local_rev" = "$remote_rev" ] && [ "${FORCE:-0}" != "1" ]; then
    exit 0 # 변경 없음
  fi

  echo "[deploy:$stack] ${local_rev:0:7} → ${remote_rev:0:7} 배포 시작"
  git checkout --quiet "$branch"
  git pull --quiet --ff-only origin "$branch"

  docker compose -f docker-compose.yml -f "docker-compose.$stack.yml" up -d --build --remove-orphans
  docker image prune -f >/dev/null

  echo "[deploy:$stack] 완료: $(git log -1 --format='%h %s')"
}

main "$@"
exit
