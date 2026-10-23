import { test } from "node:test";
import assert from "node:assert/strict";
import { fitsFormat, parseDuration, pickTop, scoreVideos, type Video } from "../src/youtube.ts";
import { analysisPrompt, scriptPrompt } from "../src/prompts.ts";

function v(id: string, channelId: string, views: number, subscribers: number, daysAgo: number): Video {
  const now = Date.parse("2026-10-01T00:00:00Z");
  return {
    id, url: "", title: `t${id}`, description: "", tags: [], channelId, channelTitle: channelId,
    publishedAt: new Date(now - daysAgo * 86_400_000).toISOString(), durationSec: 40, thumbnail: "",
    views, likes: views / 50, comments: views / 500, subscribers,
    ageDays: 0, viewsPerDay: 0, outlier: 0, engagement: 0, score: 0, topComments: [],
  };
}

test("parseDuration", () => {
  assert.equal(parseDuration("PT45S"), 45);
  assert.equal(parseDuration("PT1M5S"), 65);
  assert.equal(parseDuration("PT1H2M3S"), 3723);
  assert.equal(parseDuration("P1DT1S"), 86401);
  assert.equal(parseDuration("bad"), 0);
});

test("fitsFormat: 쇼츠는 3분 이하, 롱폼은 4분 이상", () => {
  assert.ok(fitsFormat(59, "shorts"));
  assert.ok(fitsFormat(180, "shorts"));
  assert.ok(!fitsFormat(181, "shorts"));
  assert.ok(!fitsFormat(0, "shorts"));
  assert.ok(fitsFormat(600, "long"));
  assert.ok(!fitsFormat(200, "long"));
});

test("scoreVideos: 작은 채널에서 빠르게 터진 영상이 큰 채널의 오래된 영상보다 위", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  const sorted = scoreVideos([v("big-old", "A", 1_000_000, 5_000_000, 700), v("small-fast", "B", 800_000, 5_000, 10)], now);
  assert.equal(sorted[0].id, "small-fast");
  assert.ok(sorted[0].outlier > 100);
});

test("pickTop: 한 채널에서 최대 2개", () => {
  const list = [v("1", "A", 9, 1, 1), v("2", "A", 8, 1, 1), v("3", "A", 7, 1, 1), v("4", "B", 6, 1, 1)];
  assert.deepEqual(pickTop(list, 3).map((x) => x.id), ["1", "2", "4"]);
});

test("프롬프트에 주제·영상 데이터·형식별 지시가 들어간다", () => {
  const brief = { topic: "자취 요리", format: "shorts" as const, audience: "", channel: "", extra: "" };
  const vids = scoreVideos([v("1", "A", 1000, 100, 5)]);
  vids[0].topComments = ["이거 진짜 쉬워요"];
  const a = analysisPrompt(brief, vids, true);
  assert.match(a, /자취 요리/);
  assert.match(a, /이거 진짜 쉬워요/);
  assert.match(a, /썸네일이다/);
  assert.match(scriptPrompt(brief, "분석 결과"), /40~60초/);
  assert.match(scriptPrompt({ ...brief, format: "long" }, "분석 결과"), /8~12분/);
});
