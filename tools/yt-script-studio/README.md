# 🎬 유튜브 대본 스튜디오

주제를 넣으면 다음을 자동으로 합니다.

1. **관련 영상 찾기**: YouTube에서 최근에 잘 된 영상을 검색합니다(조회수순 + 관련도순).
2. **선정**: 조회수, 하루 조회 속도, **구독자 대비 조회수**(작은 채널에서 터진 영상), 참여율로 점수를 매겨 상위 영상을 고릅니다. 한 채널에서는 최대 2개까지 고릅니다.
3. **분석**: Claude가 제목·썸네일·훅·구성·인기 댓글을 보고 잘 된 이유, 빈틈, 기획안 3개를 정리합니다.
4. **제작 패키지**: 영상 제작에 필요한 자료를 한 번에 씁니다.
   - 제목 후보 10개, 썸네일 문구와 이미지 프롬프트, 첫 3초 훅 3안
   - 장면별 전체 대본(시간·나레이션·화면·효과음)과 읽기용 대본
   - 장면별 이미지·영상 생성 프롬프트, 음성·편집 가이드
   - 설명란, 해시태그, 태그, 고정 댓글
   - 구독 전환 장치, 쇼츠↔롱폼 확장안, 업로드 전 체크리스트

결과는 화면에서 보고 복사할 수 있습니다. `output/` 폴더에 마크다운 파일로도 자동 저장됩니다.

> AgentOrg 앱과는 별개인 독립 도구입니다. AgentOrg 코드와 배포에는 영향이 없습니다.

---

## 1. 준비물 (처음 한 번)

- **Node.js 22 이상**: https://nodejs.org 에서 LTS 버전을 설치합니다.
- **YouTube Data API 키** (무료)
- **Claude API 키** (사용한 만큼 과금)

### YouTube API 키 발급 (5분)

1. https://console.cloud.google.com 에 접속해 Google 계정으로 로그인합니다.
2. 위쪽 프로젝트 선택에서 **새 프로젝트**를 만듭니다. 이름은 아무거나 괜찮습니다.
3. 메뉴에서 **API 및 서비스 → 라이브러리**로 가서 `YouTube Data API v3`를 검색하고 **사용**을 누릅니다.
4. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → API 키**를 누릅니다.
5. 만들어진 키를 복사합니다. 키 제한에서 "YouTube Data API v3"만 허용해 두면 더 안전합니다.

### Claude API 키

AgentOrg에 넣은 키를 그대로 써도 됩니다. 새로 만들려면 https://console.anthropic.com → **API Keys → Create Key**를 누릅니다.

---

## 2. 설치·실행

터미널에서 아래를 복사해 실행합니다.

```bash
cd tools/yt-script-studio
npm install
cp .env.example .env
```

`.env` 파일을 메모장으로 열어 두 키를 붙여 넣고 저장합니다.

```
YOUTUBE_API_KEY=여기에_유튜브_키
ANTHROPIC_API_KEY=여기에_클로드_키
```

실행:

```bash
npm start
```

브라우저에서 **http://127.0.0.1:7788** 을 엽니다. 위쪽에 `✓ YouTube 키`, `✓ Claude 키`가 초록색이면 준비된 것입니다. 끌 때는 터미널에서 `Ctrl+C`를 누릅니다.

---

## 3. 사용법

1. **주제**를 넣습니다. 예: `50대 영어 회화 독학`
2. **쇼츠 / 롱폼**, 검색 기간, 분석할 영상 수를 고릅니다.
3. (선택) **더 자세히**를 열어 타깃 시청자, 내 채널 말투, 추가 요청을 적습니다. 적을수록 결과가 좋아집니다.
4. **분석하고 대본 만들기**를 누릅니다. 1~3분 걸리고, 쓰는 동안 글이 실시간으로 나옵니다.
5. 탭(제작 패키지 / 분석 / 참고 영상)을 오가며 확인합니다. **복사**하거나 **전체 저장(.md)**을 누릅니다.

---

## 4. 비용과 한도

| 항목 | 1회 실행당 | 비고 |
|---|---|---|
| YouTube API | 약 210 유닛 | 무료 한도는 하루 10,000 유닛이라 **하루 약 45회** 실행 가능 |
| Claude API | 약 500~1,500원 | 기본 모델 `claude-opus-5-5`. 실행이 끝나면 화면에 예상 비용이 표시됨 |

비용을 줄이려면 `.env`에 `CLAUDE_MODEL=claude-sonnet-5-5`를 추가합니다. 비용은 약 절반이 됩니다.

---

## 5. 문제 해결

| 증상 | 해결 |
|---|---|
| `✕ YouTube 키` / `✕ Claude 키` | `.env` 파일 이름과 내용을 확인한 뒤 `npm start`를 다시 실행 |
| "YouTube API 키를 확인하세요" | 3단계에서 YouTube Data API v3를 **사용**으로 켰는지 확인 |
| "하루 사용량을 다 썼습니다" | 한국 시간 오후 4~5시쯤(태평양 자정) 초기화됨 |
| "조건에 맞는 영상을 찾지 못했습니다" | 주제를 더 넓게 쓰거나 기간을 2년으로 늘리기 |
| 포트 충돌 | `.env`에 `PORT=7790`처럼 다른 번호 지정 |

---

## 6. 알아 둘 점

- 경쟁 영상의 **자막(대본 원문)은 가져오지 않습니다.** YouTube 공식 API는 남의 영상 자막을 제공하지 않습니다. 대신 제목, 설명, 태그, 썸네일 이미지, 인기 댓글로 분석합니다.
- 결과는 초안입니다. 사실·수치에 `[확인 필요]`가 붙은 부분은 직접 확인하세요. 업로드 전에 대본을 한 번 읽어 보면 품질이 크게 올라갑니다.
- YouTube는 대량 생산·반복형 콘텐츠의 수익화를 제한합니다. 사람이 기획하고 다듬는 과정을 거치세요.
- 서버는 그 컴퓨터(127.0.0.1)에서만 열립니다. 휴대폰에서 쓰려면 아래 7번처럼 VM에 올립니다.

---

## 7. 휴대폰에서 쓰기 (오라클 VM + Tailscale)

AgentOrg를 올린 그 VM에 함께 올립니다. Docker와 저장소 읽기 키는 `docs/DEPLOY.md` A·B에서 이미 설정했으므로 그대로 씁니다.
JStudio(8000·5432·443)와 AgentOrg(3100·3200·8443·10000)는 건드리지 않습니다. 이 도구는 **7788**(내부)과 **7443**(Tailscale HTTPS) 포트를 씁니다.

VM에 SSH로 접속한 뒤, 아래 명령을 **위에서부터 한 줄씩** 붙여 넣습니다.

**① 코드 받기**
```bash
git clone -b ccr-9f8a8ba1-ba5tvb git@github-agentorg:kimjekuk/agent-org.git /opt/agentorg/yt-studio
```

**② 키 넣기.** YouTube 키와 Claude 키를 차례로 붙여 넣으면, 접속 비밀번호가 자동으로 만들어져 화면에 한 번 나옵니다. 메모해 두세요.
```bash
/opt/agentorg/yt-studio/tools/yt-script-studio/setup-env.sh
```

**③ 실행.** 처음에는 이미지 빌드로 2~5분 걸립니다.
```bash
/opt/agentorg/yt-studio/tools/yt-script-studio/update.sh
```
확인:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7788/
```
→ `401`이 나오면 정상입니다(비밀번호를 요구한다는 뜻).

**④ 휴대폰으로 내보내기**
```bash
sudo tailscale serve --bg --https=7443 http://127.0.0.1:7788
```
```bash
sudo tailscale serve status; systemctl is-active jstudio
```
→ JStudio 줄, AgentOrg 줄, `:7443` 줄이 모두 보이고 마지막 줄이 `active`이면 성공입니다.

**⑤ 휴대폰에서 열기**: Tailscale을 켠 상태로 `https://<서버>.ts.net:7443`을 엽니다. 아이디는 아무거나, 비밀번호는 ②에서 나온 것을 넣습니다.
홈 화면에 추가해 두면 앱처럼 열 수 있습니다.

| 하고 싶은 것 | 명령 |
|---|---|
| 최신 코드로 업데이트 | `/opt/agentorg/yt-studio/tools/yt-script-studio/update.sh` |
| 비밀번호 다시 보기 | `grep APP_PASSWORD /opt/agentorg/yt-studio/tools/yt-script-studio/.env` |
| 오류 로그 보기 | `cd /opt/agentorg/yt-studio/tools/yt-script-studio && docker compose logs --tail 50` |
| 만든 대본 파일 목록 | `ls /opt/agentorg/yt-studio/tools/yt-script-studio/output` |
| 잠시 끄기 / 다시 켜기 | `cd /opt/agentorg/yt-studio/tools/yt-script-studio && docker compose stop` / `docker compose start` |

> 이 도구는 데이터베이스를 쓰지 않습니다. 결과 파일은 `output/` 폴더에만 저장됩니다.

## 개발자용

```bash
npm test          # 점수 계산·선정·프롬프트 단위 테스트
npm run typecheck # 타입 검사
```

구조: `src/youtube.ts`(검색·점수·선정) · `src/prompts.ts`(분석·대본 프롬프트) · `src/claude.ts`(Claude 스트리밍 호출) · `src/server.ts`(웹 서버, NDJSON 스트림) · `public/index.html`(화면)
