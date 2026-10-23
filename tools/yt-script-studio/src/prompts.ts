// Claude에게 보낼 분석·대본 프롬프트

import type { Format, Video } from "./youtube.ts";

export interface Brief {
  topic: string;
  format: Format;
  audience: string; // 타깃 시청자 (선택)
  channel: string; // 내 채널 소개·말투 (선택)
  extra: string; // 추가 요청 (선택)
}

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

function formatName(f: Format) {
  return f === "shorts" ? "유튜브 쇼츠(세로, 60초 이내 권장)" : "유튜브 롱폼(가로, 8~15분 권장)";
}

export function videoTable(videos: Video[]): string {
  return videos
    .map((v, i) => {
      const lines = [
        `### 영상 ${i + 1}: ${v.title}`,
        `- 채널: ${v.channelTitle} (구독자 ${fmt(v.subscribers)})`,
        `- 조회수 ${fmt(v.views)} · 하루 평균 ${fmt(v.viewsPerDay)} · 구독자 대비 ${v.outlier.toFixed(1)}배 · 참여율 ${(v.engagement * 100).toFixed(2)}%`,
        `- 길이 ${v.durationSec}초 · 업로드 ${v.publishedAt.slice(0, 10)}`,
        v.tags.length ? `- 태그: ${v.tags.slice(0, 15).join(", ")}` : "",
        v.description ? `- 설명란 앞부분: ${v.description.slice(0, 400).replace(/\s+/g, " ")}` : "",
        v.topComments.length ? `- 인기 댓글:\n${v.topComments.slice(0, 12).map((c) => `  - ${c.replace(/\s+/g, " ")}`).join("\n")}` : "",
      ];
      return lines.filter(Boolean).join("\n");
    })
    .join("\n\n");
}

function briefText(b: Brief): string {
  return [
    `- 주제: ${b.topic}`,
    `- 형식: ${formatName(b.format)}`,
    `- 타깃 시청자: ${b.audience || "(지정 안 함 — 데이터에서 추론)"}`,
    `- 내 채널 소개·말투: ${b.channel || "(지정 안 함)"}`,
    b.extra ? `- 추가 요청: ${b.extra}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function analysisPrompt(b: Brief, videos: Video[], withThumbnails: boolean): string {
  return `너는 한국 유튜브 성장 전략가다. 아래는 "${b.topic}" 주제로 최근 성과가 좋은 영상들의 실제 데이터다.
${withThumbnails ? "함께 첨부한 이미지는 위에서부터 영상 1, 2, 3… 순서의 썸네일이다.\n" : ""}
## 기획 조건
${briefText(b)}

## 성과 좋은 영상 데이터
${videoTable(videos)}

## 할 일
데이터에 근거해서 "왜 이 영상들이 조회수·구독자를 모았는지" 분석하라. 숫자와 영상 번호를 근거로 들고, 데이터에 없는 것은 추측이라고 표시하라.
마크다운으로, 아래 제목을 그대로 써라.

## 1. 한눈에 보는 결론
(3줄 요약)

## 2. 제목 패턴
(자주 쓰인 단어·구조·길이·숫자/질문/반전 사용. 표 1개 포함)

## 3. 썸네일 패턴
(문구 길이, 색, 얼굴/사물, 구도. 썸네일 이미지가 없으면 제목으로 추론했다고 표시)

## 4. 도입부(훅)와 구성
(제목·설명·댓글로 추론한 첫 3초 전략과 전개 방식)

## 5. 시청자 반응
(댓글에서 드러난 욕구·궁금증·불만. 실제 댓글을 짧게 인용)

## 6. 빈틈과 차별화 기회
(기존 영상들이 놓친 것, 우리가 이길 수 있는 각도)

## 7. 추천 기획 3안
(각 안: 한 줄 콘셉트 / 왜 될지 / 위험 요소. 마지막에 가장 추천하는 1안과 이유)`;
}

export function scriptPrompt(b: Brief, analysis: string): string {
  const isShorts = b.format === "shorts";
  return `너는 한국 유튜브 전문 기획자·대본 작가다. 아래 분석을 바탕으로 "${b.topic}" 영상을 바로 제작할 수 있는 제작 패키지 전체를 써라.

## 기획 조건
${briefText(b)}

## 경쟁 영상 분석 (앞 단계 결과)
${analysis}

## 원칙
- 분석의 "가장 추천하는 1안"으로 만든다. 경쟁 영상의 문장·구성을 베끼지 말고 패턴만 참고해 독창적으로 쓴다.
- 대본은 소리 내 읽기 좋은 구어체 한국어. 짧은 문장. "여러분 안녕하세요", "오늘은 ~에 대해 알아볼게요" 같은 진부한 시작 금지.
- 첫 ${isShorts ? "1~2초" : "15초"} 안에 시청자가 끝까지 볼 이유를 준다. 중간중간 다음 내용을 궁금하게 만든다.
- 사실·수치는 확인이 필요하면 [확인 필요] 표시를 붙인다.
- 유튜브 정책상 사람의 기획이 드러나는 진정성 있는 콘텐츠여야 한다. 실제 사람·브랜드를 사칭하거나 허위 사실을 만들지 않는다.

## 출력 형식 (마크다운, 아래 제목을 그대로)

## 1. 기획 요약
(콘셉트 한 줄 / 타깃 / 시청자가 얻는 것 / 예상 길이)

## 2. 제목 후보 10개
(표: 번호 | 제목 | 쓴 전략. 마지막에 1순위 추천과 이유)

## 3. 썸네일
- 썸네일 문구 3안 (각 10자 안팎)
- 화면 구성 설명 (배경·인물/사물·색·글자 위치)
- AI 이미지 생성 프롬프트 (영어, 그대로 복사해 쓸 수 있게 코드 블록)

## 4. 첫 ${isShorts ? "3초" : "15초"} 훅 3안
(각 안: 대사 / 화면 / 왜 멈추게 되는지)

## 5. 전체 대본
${
  isShorts
    ? "장면별 표: 시간(초) | 나레이션 | 화면·자막 강조 | 효과음/BGM. 총 40~60초. 표 아래에 나레이션만 이어 붙인 '읽기용 대본'도 코드 블록으로."
    : "구간별(인트로/본론 1·2·3/아웃트로)로 나누고, 각 구간에 시간·나레이션 전문·화면 설명·B-roll·자막 강조를 적는다. 총 8~12분 분량. 마지막에 나레이션만 이어 붙인 '읽기용 대본'을 코드 블록으로."
}

## 6. 장면별 이미지·영상 생성 프롬프트
(장면 번호 | 영어 프롬프트. Midjourney·Kling·Runway 등에 그대로 쓸 수 있게)

## 7. 음성·편집 가이드
(TTS/녹음 톤, 말 속도, 자막 스타일, 컷 템포, BGM 분위기)

## 8. 업로드 정보
- 설명란 전문 (첫 2줄에 핵심, 타임스탬프${isShorts ? " 생략" : " 포함"})
- 해시태그 3~5개
- 태그 15개 (쉼표 구분, 코드 블록)
- 고정 댓글 (참여 유도 질문)

## 9. 구독 전환 장치
(영상 안 구독 유도 문장 위치·대사, 다음 영상 연결 아이디어 3개)

## 10. ${isShorts ? "롱폼 확장 아이디어" : "쇼츠로 자를 구간 3개"}

## 11. 업로드 전 체크리스트
(체크박스 목록: 사실 확인, 저작권, AI 생성 표시 여부, 첫 3초 등)`;
}
