#!/usr/bin/env bash
# .env 만들기 (VM용): 키 두 개를 물어보고, 접속 비밀번호는 자동 생성해서 한 번 보여준다
set -euo pipefail
cd "$(dirname "$0")"
if [ -f .env ]; then
  echo ".env가 이미 있습니다. 비밀번호 확인: grep APP_PASSWORD $(pwd)/.env" >&2
  exit 1
fi
read -rsp "YouTube API 키 붙여넣기 (화면에 안 보임) 후 Enter: " yt; echo
read -rsp "Claude API 키 붙여넣기 (화면에 안 보임) 후 Enter: " cl; echo
pw="$(openssl rand -hex 6)"
umask 077
printf 'YOUTUBE_API_KEY=%s\nANTHROPIC_API_KEY=%s\nAPP_PASSWORD=%s\n' "$yt" "$cl" "$pw" > .env
echo
echo "완료. 휴대폰에서 접속할 때 쓸 비밀번호 (아이디는 아무거나):"
echo
echo "    $pw"
echo
echo "잊어버리면: grep APP_PASSWORD $(pwd)/.env"
