// F208 지시 템플릿: 기본 템플릿 + 저장한 것, 같은 내용은 한 번만, 30개 한도, 삭제는 내 조직 것만, 기록 남김
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import { DEFAULT_DIRECTIVE_TEMPLATES, deleteDirectiveTemplate, listDirectiveTemplates, saveDirectiveTemplate, splitForMission, templateTitle } from "@agentorg/shared/directiveTemplates";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed } from "./testDb";

describe("지시 템플릿", () => {
  let db: AnyDb;
  let ctx: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => {
    db = await createTestDb();
    ctx = await seed(db);
  });
  const base = () => ({ orgId: ctx.org.id, userId: ctx.user.id });

  it("이름은 비우면 첫 줄(20자까지), 새 미션에서는 첫 줄 = 주제·나머지 = 목표", () => {
    expect(templateTitle("경쟁사 가격 조사해 줘\n표로")).toBe("경쟁사 가격 조사해 줘");
    expect(templateTitle("가".repeat(30))).toHaveLength(20);
    expect(splitForMission("주제 한 줄\n목표 1\n목표 2")).toEqual({ topic: "주제 한 줄", goal: "목표 1\n목표 2" });
  });

  it("저장한 것이 기본 템플릿 앞에 오고, 같은 내용은 한 번만 저장한다", async () => {
    const a = await saveDirectiveTemplate(db, { ...base(), content: "경쟁사 가격 조사해 줘" });
    const b = await saveDirectiveTemplate(db, { ...base(), content: "  경쟁사 가격 조사해 줘 " });
    expect(b).toEqual(a);
    const list = await listDirectiveTemplates(db, ctx.org.id);
    expect(list.map((x) => x.builtin)).toEqual([false, ...DEFAULT_DIRECTIVE_TEMPLATES.map(() => true)]);
    expect(list[0].title).toBe("경쟁사 가격 조사해 줘");
    expect(await saveDirectiveTemplate(db, { ...base(), content: " " })).toEqual({ error: "내용을 입력해 주세요" });
  });

  it("30개까지만, 삭제는 내 조직 것만, 저장·삭제를 기록한다", async () => {
    for (let i = 0; i < 30; i++) await saveDirectiveTemplate(db, { ...base(), content: `지시 ${i}` });
    expect(await saveDirectiveTemplate(db, { ...base(), content: "하나 더" })).toHaveProperty("error");
    const [row] = await db.select().from(schema.directiveTemplates).limit(1);
    await deleteDirectiveTemplate(db, { orgId: "00000000-0000-0000-0000-000000000000", userId: ctx.user.id, id: row.id });
    expect(await db.select().from(schema.directiveTemplates)).toHaveLength(30);
    await deleteDirectiveTemplate(db, { ...base(), id: row.id });
    expect(await db.select().from(schema.directiveTemplates)).toHaveLength(29);
    const logs = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.orgId, ctx.org.id));
    expect(logs.filter((l) => l.action === "template.create")).toHaveLength(30);
    expect(logs.filter((l) => l.action === "template.delete")).toHaveLength(1);
  });
});
