// 유튜브 대본 스튜디오 — 로컬 웹 서버 (127.0.0.1 전용)

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { findVideos, YouTubeError, type Format } from "./youtube.ts";
import { analysisPrompt, scriptPrompt, type Brief } from "./prompts.ts";
import { Anthropic, explainError, MODEL, streamText } from "./claude.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  // .env가 없으면 환경변수만 사용
}

const PORT = Number(process.env.PORT || 7788);
const HOST = process.env.HOST || "127.0.0.1";

const STATIC: Record<string, [string, string]> = {
  "/": [path.join(ROOT, "public/index.html"), "text/html; charset=utf-8"],
  "/marked.js": [path.join(ROOT, "node_modules/marked/lib/marked.umd.js"), "text/javascript; charset=utf-8"],
};

async function readJson(req: IncomingMessage): Promise<any> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error("요청이 너무 큽니다.");
  }
  return JSON.parse(raw || "{}");
}

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

async function run(req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req);
  const brief: Brief = {
    topic: clean(body.topic, 200),
    format: (body.format === "long" ? "long" : "shorts") as Format,
    audience: clean(body.audience, 300),
    channel: clean(body.channel, 1000),
    extra: clean(body.extra, 1000),
  };
  const months = [3, 6, 12, 24].includes(Number(body.months)) ? Number(body.months) : 12;
  const count = Math.min(10, Math.max(3, Number(body.count) || 8));

  res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
  const send = (e: object) => res.write(JSON.stringify(e) + "\n");
  const ctl = new AbortController();
  res.on("close", () => ctl.abort());

  try {
    if (!brief.topic) throw new Error("주제를 입력하세요.");
    const ytKey = process.env.YOUTUBE_API_KEY;
    if (!ytKey) throw new Error(".env에 YOUTUBE_API_KEY가 없습니다. README의 '키 발급'을 따라 넣어 주세요.");
    if (!process.env.ANTHROPIC_API_KEY) throw new Error(".env에 ANTHROPIC_API_KEY가 없습니다. README의 '키 발급'을 따라 넣어 주세요.");

    // 1단계: 관련 영상 찾기
    send({ type: "step", step: "search", message: `"${brief.topic}" 관련 영상을 찾는 중…` });
    const { picked, candidates } = await findVideos({ topic: brief.topic, format: brief.format, months, count, key: ytKey });
    if (picked.length === 0) throw new Error("조건에 맞는 영상을 찾지 못했습니다. 주제를 더 넓게 쓰거나 기간을 늘려 보세요.");
    send({ type: "videos", candidates, videos: picked });

    // 2단계: 분석 (썸네일 이미지 포함. 이미지를 못 읽으면 글만으로 다시)
    send({ type: "step", step: "analysis", message: `상위 ${picked.length}개 영상을 분석하는 중…` });
    const thumbs = picked.slice(0, 6).map((v) => v.thumbnail).filter(Boolean);
    let analysis;
    try {
      analysis = await streamText(analysisPrompt(brief, picked, thumbs.length > 0), thumbs, (t) => send({ type: "analysis_delta", text: t }), ctl.signal);
    } catch (e) {
      if (!(e instanceof Anthropic.BadRequestError) || thumbs.length === 0) throw e;
      send({ type: "analysis_reset", message: "썸네일을 읽지 못해 글 정보만으로 분석합니다." });
      analysis = await streamText(analysisPrompt(brief, picked, false), [], (t) => send({ type: "analysis_delta", text: t }), ctl.signal);
    }
    send({ type: "usage", step: "analysis", usage: analysis.usage });

    // 3단계: 제작 패키지(대본 등) 작성
    send({ type: "step", step: "script", message: "대본과 제작 자료를 쓰는 중…" });
    const script = await streamText(scriptPrompt(brief, analysis.text), [], (t) => send({ type: "script_delta", text: t }), ctl.signal);
    send({ type: "usage", step: "script", usage: script.usage });

    // 결과를 output/ 폴더에 마크다운으로 저장
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const safe = brief.topic.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40);
    const file = `output/${stamp}_${safe}.md`;
    const refs = picked.map((v, i) => `${i + 1}. [${v.title}](${v.url}) — ${v.channelTitle}, 조회수 ${v.views.toLocaleString("ko-KR")}`).join("\n");
    await mkdir(path.join(ROOT, "output"), { recursive: true });
    await writeFile(
      path.join(ROOT, file),
      `# ${brief.topic} — 제작 패키지\n\n> 생성: ${new Date().toLocaleString("ko-KR")} · 모델 ${MODEL}\n\n# 참고한 영상\n\n${refs}\n\n# 경쟁 영상 분석\n\n${analysis.text}\n\n# 제작 패키지\n\n${script.text}\n`,
    );
    send({ type: "done", file, krw: analysis.usage.krw + script.usage.krw });
  } catch (e) {
    if (!ctl.signal.aborted) {
      const message = e instanceof YouTubeError ? e.message : explainError(e);
      console.error("[run]", message);
      send({ type: "error", message });
    }
  } finally {
    res.end();
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "POST" && url.pathname === "/api/run") return await run(req, res);
    if (req.method === "GET" && url.pathname === "/api/status") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ youtube: !!process.env.YOUTUBE_API_KEY, claude: !!process.env.ANTHROPIC_API_KEY, model: MODEL }));
    }
    const file = req.method === "GET" ? STATIC[url.pathname] : undefined;
    if (file) {
      res.writeHead(200, { "content-type": file[1] });
      return res.end(await readFile(file[0]));
    }
    res.writeHead(404).end("not found");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500).end("server error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  유튜브 대본 스튜디오 실행 중 → http://${HOST}:${PORT}\n  (끄려면 Ctrl+C)\n`);
});
