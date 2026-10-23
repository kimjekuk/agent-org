// YouTube Data API v3 — 주제로 영상 검색 → 통계 수집 → 점수화 → 선정

const API = "https://www.googleapis.com/youtube/v3";

export type Format = "shorts" | "long";

export interface Video {
  id: string;
  url: string;
  title: string;
  description: string;
  tags: string[];
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  durationSec: number;
  thumbnail: string;
  views: number;
  likes: number;
  comments: number;
  subscribers: number;
  // 계산값
  ageDays: number;
  viewsPerDay: number;
  outlier: number; // 조회수 ÷ 구독자수: 채널 크기 대비 얼마나 터졌는지
  engagement: number; // (좋아요 + 댓글×2) ÷ 조회수
  score: number;
  topComments: string[];
}

export class YouTubeError extends Error {}

async function get(path: string, params: Record<string, string>, key: string): Promise<any> {
  const qs = new URLSearchParams({ ...params, key });
  const res = await fetch(`${API}/${path}?${qs}`);
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason ?? "";
    const msg = body?.error?.message ?? res.statusText;
    if (reason === "quotaExceeded") throw new YouTubeError("YouTube API 하루 사용량을 다 썼습니다. 내일 다시 시도하세요.");
    if (res.status === 400 || res.status === 403) throw new YouTubeError(`YouTube API 키를 확인하세요: ${msg}`);
    throw new YouTubeError(`YouTube API 오류(${res.status}): ${msg}`);
  }
  return body;
}

// ISO 8601 기간(PT1H2M3S) → 초
export function parseDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? "");
  if (!m) return 0;
  const [, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

export function fitsFormat(durationSec: number, format: Format): boolean {
  return format === "shorts" ? durationSec > 0 && durationSec <= 180 : durationSec >= 240;
}

// 지표를 0~1로 정규화(로그)해서 합산. 조회 속도·채널 대비 성과·참여율을 함께 본다.
export function scoreVideos(videos: Video[], now = Date.now()): Video[] {
  for (const v of videos) {
    v.ageDays = Math.max(1, (now - Date.parse(v.publishedAt)) / 86_400_000);
    v.viewsPerDay = v.views / v.ageDays;
    v.outlier = v.views / Math.max(v.subscribers, 1000);
    v.engagement = v.views > 0 ? (v.likes + v.comments * 2) / v.views : 0;
  }
  const norm = (pick: (v: Video) => number) => {
    const vals = videos.map((v) => Math.log10(1 + pick(v)));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return (v: Video) => (max === min ? 0.5 : (Math.log10(1 + pick(v)) - min) / (max - min));
  };
  const nViews = norm((v) => v.views);
  const nSpeed = norm((v) => v.viewsPerDay);
  const nOutlier = norm((v) => v.outlier);
  const nEng = norm((v) => v.engagement * 1000);
  for (const v of videos) {
    v.score = 0.25 * nViews(v) + 0.3 * nSpeed(v) + 0.3 * nOutlier(v) + 0.15 * nEng(v);
  }
  return videos.sort((a, b) => b.score - a.score);
}

// 점수 순으로 고르되 한 채널에서 최대 2개 (다양한 성공 패턴을 보기 위해)
export function pickTop(sorted: Video[], count: number): Video[] {
  const perChannel = new Map<string, number>();
  const out: Video[] = [];
  for (const v of sorted) {
    const n = perChannel.get(v.channelId) ?? 0;
    if (n >= 2) continue;
    perChannel.set(v.channelId, n + 1);
    out.push(v);
    if (out.length >= count) break;
  }
  return out;
}

export interface SearchOptions {
  topic: string;
  format: Format;
  months: number;
  count: number;
  key: string;
}

export async function findVideos(o: SearchOptions): Promise<{ picked: Video[]; candidates: number }> {
  const publishedAfter = new Date(Date.now() - o.months * 30 * 86_400_000).toISOString();
  const base = {
    part: "snippet",
    q: o.topic,
    type: "video",
    maxResults: "50",
    regionCode: "KR",
    relevanceLanguage: "ko",
    publishedAfter,
    videoDuration: o.format === "shorts" ? "short" : "any",
  };
  // 조회수순 + 관련도순 두 번 검색해서 합친다 (검색 1회 = 100 유닛)
  const [byViews, byRelevance] = await Promise.all([
    get("search", { ...base, order: "viewCount" }, o.key),
    get("search", { ...base, order: "relevance" }, o.key),
  ]);
  const ids = [...new Set([...byViews.items, ...byRelevance.items].map((i: any) => i.id?.videoId).filter(Boolean))] as string[];
  if (ids.length === 0) return { picked: [], candidates: 0 };

  const videos: Video[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await get("videos", { part: "snippet,statistics,contentDetails", id: ids.slice(i, i + 50).join(",") }, o.key);
    for (const it of r.items) {
      const durationSec = parseDuration(it.contentDetails?.duration);
      if (!fitsFormat(durationSec, o.format)) continue;
      const th = it.snippet.thumbnails ?? {};
      videos.push({
        id: it.id,
        url: o.format === "shorts" ? `https://www.youtube.com/shorts/${it.id}` : `https://www.youtube.com/watch?v=${it.id}`,
        title: it.snippet.title,
        description: it.snippet.description ?? "",
        tags: it.snippet.tags ?? [],
        channelId: it.snippet.channelId,
        channelTitle: it.snippet.channelTitle,
        publishedAt: it.snippet.publishedAt,
        durationSec,
        thumbnail: (th.high ?? th.medium ?? th.default)?.url ?? "",
        views: Number(it.statistics?.viewCount ?? 0),
        likes: Number(it.statistics?.likeCount ?? 0),
        comments: Number(it.statistics?.commentCount ?? 0),
        subscribers: 0,
        ageDays: 0,
        viewsPerDay: 0,
        outlier: 0,
        engagement: 0,
        score: 0,
        topComments: [],
      });
    }
  }

  const channelIds = [...new Set(videos.map((v) => v.channelId))];
  const subs = new Map<string, number>();
  for (let i = 0; i < channelIds.length; i += 50) {
    const r = await get("channels", { part: "statistics", id: channelIds.slice(i, i + 50).join(",") }, o.key);
    for (const c of r.items) subs.set(c.id, Number(c.statistics?.subscriberCount ?? 0));
  }
  for (const v of videos) v.subscribers = subs.get(v.channelId) ?? 0;

  const picked = pickTop(scoreVideos(videos), o.count);

  // 상위 영상의 인기 댓글: 시청자가 무엇에 반응했는지 (댓글 막힌 영상은 건너뜀)
  await Promise.all(
    picked.slice(0, 5).map(async (v) => {
      try {
        const r = await get("commentThreads", { part: "snippet", videoId: v.id, order: "relevance", maxResults: "20", textFormat: "plainText" }, o.key);
        v.topComments = r.items
          .map((c: any) => c.snippet?.topLevelComment?.snippet?.textOriginal ?? "")
          .filter((t: string) => t.length > 0)
          .map((t: string) => t.slice(0, 200));
      } catch {
        v.topComments = [];
      }
    }),
  );

  return { picked, candidates: videos.length };
}
