# 배포 — VM 설치 절차 (복붙용)

PRD 12장의 실행 절차. 기존 오라클 ARM VM(JStudio 서버)에 SSH로 접속한 뒤, 아래 명령을 **위에서부터 한 줄씩** 붙여 넣는다.
`<서버>.ts.net`은 이 VM의 Tailscale 이름이다 (`sudo tailscale serve status` 첫 줄에 보임).

> JStudio(포트 8000, 서버 PostgreSQL 5432, Tailscale HTTPS 443)는 건드리지 않는다.
> 아래 명령은 모두 새 것을 **추가**만 한다.

---

## A. Docker 설치 (VM에 한 번)

```bash
curl -fsSL https://get.docker.com | sudo sh
```
```bash
sudo usermod -aG docker ubuntu
```
**여기서 `exit`로 접속을 끊고 다시 SSH 접속한다** (docker 권한 적용). 그다음 확인:
```bash
docker compose version
```
→ `Docker Compose version v2.…`가 나오면 성공.

## B. 저장소 읽기 키 (Deploy key, 한 번)

```bash
ssh-keygen -t ed25519 -N "" -C agentorg-deploy -f ~/.ssh/agentorg_deploy
```
```bash
printf 'Host github-agentorg\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/agentorg_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config && chmod 600 ~/.ssh/config
```
```bash
cat ~/.ssh/agentorg_deploy.pub
```
→ 출력된 한 줄(`ssh-ed25519 …`)을 복사해서 GitHub에 등록:
저장소 `agent-org` → **Settings → Deploy keys → Add deploy key** → Title `jstudio VM`, Key에 붙여넣기, **Allow write access는 체크하지 않음** → Add key.

등록 후 확인:
```bash
ssh -T -o StrictHostKeyChecking=accept-new github-agentorg
```
→ `successfully authenticated`가 보이면 성공 (`does not provide shell access`는 정상).

---

## C. dev 스택 (dev 브랜치 → `https://<서버>.ts.net:10000`)

```bash
sudo mkdir -p /opt/agentorg && sudo chown ubuntu:ubuntu /opt/agentorg
```
```bash
git clone -b dev git@github-agentorg:kimjekuk/agent-org.git /opt/agentorg/dev
```
`.env` 만들기 (DB 비밀번호는 자동 생성, 화면에 나오지 않음):
```bash
printf 'POSTGRES_DB=agentorg_dev\nPOSTGRES_USER=agentorg\nPOSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)" > /opt/agentorg/dev/.env && chmod 600 /opt/agentorg/dev/.env
```
첫 배포 (이미지 빌드로 5~10분 걸림):
```bash
FORCE=1 /opt/agentorg/dev/deploy/deploy.sh dev
```
확인:
```bash
curl -s http://127.0.0.1:3200/api/health; echo
```
→ `{"db":"ok","redis":"ok"}`

자동 배포 타이머 켜기 (2분마다 dev 브랜치 확인):
```bash
sudo cp /opt/agentorg/dev/deploy/agentorg-deploy@.service /opt/agentorg/dev/deploy/agentorg-deploy@.timer /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now agentorg-deploy@dev.timer
```
Tailscale로 내보내기 (HTTPS 10000 → dev web):
```bash
sudo tailscale serve --bg --https=10000 http://127.0.0.1:3200
```
최종 확인:
```bash
sudo tailscale serve status; systemctl list-timers 'agentorg-*' --no-pager; systemctl is-active jstudio
```
→ JStudio 줄(`/ proxy http://127.0.0.1:8000`)과 `:10000` 줄이 **둘 다** 보이고, 타이머가 있고, 마지막 줄이 `active`면 성공.
→ 휴대폰(Tailscale 연결 상태) 브라우저에서 `https://<서버>.ts.net:10000` 열면 "AgentOrg" 빈 페이지.

---

## D. 운영 스택 (main 브랜치 → `https://<서버>.ts.net:8443`)

`dev → main` 머지 후에 실행한다 (그 전의 main에는 앱 코드가 없다).

```bash
git clone -b main git@github-agentorg:kimjekuk/agent-org.git /opt/agentorg/prod
```
```bash
printf 'POSTGRES_DB=agentorg_prod\nPOSTGRES_USER=agentorg\nPOSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)" > /opt/agentorg/prod/.env && chmod 600 /opt/agentorg/prod/.env
```
```bash
FORCE=1 /opt/agentorg/prod/deploy/deploy.sh prod
```
```bash
sudo systemctl enable --now agentorg-deploy@prod.timer && sudo tailscale serve --bg --https=8443 http://127.0.0.1:3100
```
→ 휴대폰에서 `https://<서버>.ts.net:8443`

---

## 문제가 생기면

| 증상 | 명령 |
|------|------|
| 자동 배포가 안 됨 (최근 기록 보기) | `journalctl -u agentorg-deploy@dev -n 50 --no-pager` |
| 컨테이너 상태 | `docker compose -p agentorg-dev ps` |
| web 오류 로그 | `docker compose -p agentorg-dev logs web --tail 50` |
| 지금 바로 다시 배포 | `FORCE=1 /opt/agentorg/dev/deploy/deploy.sh dev` |

운영은 `dev` 자리에 `prod`를 넣는다.
**`docker compose down -v`는 DB 데이터를 지우므로 절대 쓰지 않는다.**
