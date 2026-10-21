// F209 에이전트 사용 언어: 에이전트 → 조직 기본값 → 한국어 순으로 정하고, 한국어가 아니면 시스템 프롬프트에 언어 지침을 넣는다
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { agentLanguage } from "../src/loops/common";
import { buildSystemPrompt } from "../src/prompts/system";
import { createTestDb, seed } from "./testDb";

describe("에이전트 사용 언어", () => {
  let db: AnyDb;
  let ctx: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => {
    db = await createTestDb();
    ctx = await seed(db);
  });

  it("에이전트에 정한 언어 → 없으면 조직 기본값 → 기본은 한국어", async () => {
    expect(await agentLanguage(db, { orgId: ctx.org.id, language: null })).toBe("ko");
    await db.update(schema.organizations).set({ language: "ja" }).where(eq(schema.organizations.id, ctx.org.id));
    expect(await agentLanguage(db, { orgId: ctx.org.id, language: null })).toBe("ja");
    expect(await agentLanguage(db, { orgId: ctx.org.id, language: "en" })).toBe("en");
    expect(await agentLanguage(db, { orgId: ctx.org.id, language: "xx" })).toBe("ja");
  });

  it("영어면 언어 지침을 넣고, 정해진 제목·JSON 키는 그대로 두게 한다. 한국어면 넣지 않는다", () => {
    const en = buildSystemPrompt({ name: "하나", role: "팀원", language: "en" });
    expect(en).toContain("# 언어");
    expect(en).toContain("영어(English)");
    expect(en).toContain("JSON 키");
    expect(en.indexOf("# 최우선 원칙")).toBe(0); // 대전제는 항상 맨 앞
    expect(buildSystemPrompt({ name: "하나", role: "팀원", language: "ko" })).not.toContain("# 언어");
  });
});
