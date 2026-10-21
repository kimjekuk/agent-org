// F209 번역 점검: 화면 파일에서 t("…")로 감싸지 않은 한국어가 남은 줄을 찾는다 (주석·console 메시지 제외)
// 사용: node apps/web/scripts/i18n-scan.mjs [파일…]   (파일을 안 주면 apps/web 전체)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === "node_modules" || f.startsWith(".")) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
const files = process.argv.length > 2 ? process.argv.slice(2) : ["app", "components", "lib"].flatMap((d) => walk(join(root, d)));
const KEY = /\b(?:t|tr)\(\s*"(?:[^"\\]|\\.)*"/g;
let left = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")) // 블록 주석
    .split("\n");
  src.forEach((line, i) => {
    const code = line
      .replace(/(^|[^:"'`])\/\/.*$/, "$1") // 줄 주석
      .replace(KEY, "")
      .replace(/console\.\w+\(.*$/, "")
      .replace(/i18n-ignore.*$/, "");
    if (/[가-힣]/.test(code)) {
      left++;
      console.log(`${f.replace(root, "")}:${i + 1}: ${line.trim().slice(0, 140)}`);
    }
  });
}
console.log(`\n남은 줄: ${left}`);
