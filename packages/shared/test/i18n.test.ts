// F209: 화면에서 t("…")로 쓴 한국어 키가 영어 사전에 모두 있는지, 사전의 {자리}가 원문과 같은지
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../src/agents/language";
import { PERSONALITY_TYPES, SPEECH_TONES } from "../src/agents/personality";
import { ACCESSORY_NAMES, COLOR_NAMES, FACE_NAMES, HAIR_COLORS, HAIR_NAMES, levelLook, OFFICE_THEMES, OUTFIT_NAMES, SKIN_TONES, TOOL_NAMES } from "../src/agents/templates";
import { CHANNEL_LABEL } from "../src/export";
import { levelTitle } from "../src/growth";
import { en, makeT, translate } from "../src/i18n";

const WEB = join(__dirname, "../../../apps/web");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === "node_modules" || f.startsWith(".")) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

/** 화면 코드의 t("…")·tr("…") 키 */
function usedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const f of ["app", "components", "lib"].flatMap((d) => walk(join(WEB, d)))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\b(?:t|tr)\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.set(JSON.parse(`"${m[1]}"`), f.replace(WEB, ""));
  }
  return keys;
}

/** 값으로 넘겨 t(label)처럼 번역하는 공통 이름표들 */
async function dynamicKeys(): Promise<string[]> {
  const nav = await import("../../../apps/web/lib/nav");
  const missions = await import("../../../apps/web/lib/missions");
  const agents = await import("../../../apps/web/lib/agents");
  const knowledge = await import("../../../apps/web/lib/knowledge");
  const levels = Array.from({ length: 30 }, (_, i) => i + 1);
  return [
    ...Object.values(missions.MISSION_STATUS).map((s) => s.label),
    ...missions.TASK_COLUMNS.map((c) => c.label),
    ...Object.values(missions.PRIORITY_LABEL),
    ...Object.values(agents.RANK_LABEL),
    ...Object.values(knowledge.SOURCE_LABEL),
    ...Object.values(PERSONALITY_TYPES).flatMap((p) => [p.label, p.desc]),
    ...Object.values(SPEECH_TONES).map((t) => t.example),
    ...HAIR_NAMES,
    ...FACE_NAMES,
    ...COLOR_NAMES,
    ...OUTFIT_NAMES,
    ...ACCESSORY_NAMES,
    ...HAIR_COLORS.map((c) => c.name),
    ...SKIN_TONES.map((c) => c.name),
    ...Object.values(TOOL_NAMES),
    ...Object.values(CHANNEL_LABEL),
    ...levels.map(levelTitle),
    ...levels.map((l) => levelLook(l).label).filter((l): l is string => Boolean(l)),
    ...nav.SIDEBAR.map((s) => s.label),
    ...nav.TABS.map((s) => s.label),
    ...Object.values(OFFICE_THEMES).map((t) => t.label),
    ...Object.values(SPEECH_TONES).map((t) => t.label),
    ...Object.values(LANGUAGES).map((l) => l.label),
  ];
}

const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("화면 언어", () => {
  it("바꾸는 값 넣기, 사전에 없으면 한국어 그대로", () => {
    expect(translate("en", "대기 {n}건", { n: 3 })).toBe("3 waiting");
    expect(translate("ko", "대기 {n}건", { n: 3 })).toBe("대기 3건");
    expect(makeT("en")("사전에 없는 말")).toBe("사전에 없는 말");
  });

  it("화면에서 쓰는 키가 모두 영어 사전에 있다", async () => {
    const used = usedKeys();
    const missing = [...used].filter(([k]) => !(k in en)).map(([k, f]) => `${f}: ${k}`);
    const dyn = (await dynamicKeys()).filter((k) => !/^[\x20-\x7e]*$/.test(k) && !(k in en));
    expect(missing).toEqual([]);
    expect([...new Set(dyn)]).toEqual([]);
  });

  it("영어 문장의 {자리}가 원문과 같고 한국어가 섞이지 않는다", () => {
    const bad = Object.entries(en).filter(([k, v]) => slots(k).join() !== slots(v).join() || /[가-힣]/.test(v));
    expect(bad).toEqual([]);
  });
});
