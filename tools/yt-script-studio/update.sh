#!/usr/bin/env bash
# VM에서 최신 코드 받아 다시 실행: tools/yt-script-studio/update.sh
set -euo pipefail
cd "$(dirname "$0")"
git pull --ff-only
mkdir -p output  # 컨테이너 사용자(node, uid 1000)와 VM의 ubuntu 사용자가 같은 uid라 쓰기 가능
docker compose up -d --build
docker compose ps
