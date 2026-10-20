// F202 캐릭터: 옛 3항목 아바타도 그대로 읽고 범위 밖 값은 기본값, 레벨별 외형, 말투 프롬프트, 사무실 테마
import { describe, expect, it } from "vitest";
import { stylePrompt } from "../src/agents/personality";
import { levelLook, normalizeAvatar, officeTheme } from "../src/agents/templates";

describe("캐릭터 꾸미기", () => {
  it("옛 아바타(머리·표정·색)는 그대로, 새 항목은 기본값, 범위 밖·이상한 값은 0", () => {
    expect(normalizeAvatar({ hair: 2, face: 3, color: 5 })).toEqual({ hair: 2, face: 3, color: 5, hairColor: 0, skin: 0, outfit: 0, accessory: 0 });
    expect(normalizeAvatar({ hair: 9, face: -1, color: "x", outfit: 3, accessory: 4, skin: 2, hairColor: 5 })).toEqual({ hair: 0, face: 0, color: 0, hairColor: 5, skin: 2, outfit: 3, accessory: 4 });
    expect(normalizeAvatar(null).hair).toBe(0);
  });

  it("레벨 3 별 · 5 은메달 · 7 금메달 · 10 왕관", () => {
    expect([1, 3, 5, 7, 10].map((l) => levelLook(l).badge)).toEqual([null, "⭐", "🥈", "🥇", "👑"]);
  });

  it("말투를 고르면 성격 유형 뒤에 붙고, 없으면 성격 유형만", () => {
    expect(stylePrompt({ personalityType: "ANALYTIC", speechTone: "BRIEF" })).toMatch(/^분석형: .*\n말투: 보고와 대화는 짧은 보고체/);
    expect(stylePrompt({ personalityType: "ANALYTIC", speechTone: null })).not.toContain("말투:");
    expect(stylePrompt({ personalityType: null, speechTone: "CASUAL" })).toContain("편한 반말");
  });

  it("모르는 테마는 기본 테마", () => {
    expect(officeTheme("NIGHT").label).toBe("밤 (어두운)");
    expect(officeTheme("없음").label).toBe("기본 (나무)");
  });
});
