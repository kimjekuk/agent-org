// F207 알림 채널: 설정에서 켠 종류·채널로만, 제목 한 줄 + 앱 링크만 보낸다 (결과물 내용 없음). 실패해도 작업을 막지 않는다
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import { saveExportChannel } from "@agentorg/shared/export";
import { noticeKind, notifyChannels, type NotifySenders, toggleNotify } from "@agentorg/shared/notify";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed } from "./testDb";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "ab".repeat(32);
});

describe("알림 채널", () => {
  let db: AnyDb;
  let ctx: Awaited<ReturnType<typeof seed>>;
  let sent: { channel: string; text: string; subject?: string }[];
  let fail: boolean;
  const senders: NotifySenders = {
    async slack(_c, text) {
      if (fail) throw new Error("슬랙 응답 404");
      sent.push({ channel: "SLACK", text });
    },
    async email(_c, subject, text) {
      sent.push({ channel: "EMAIL", subject, text });
    },
  };
  const notice = { title: "✋ 계획 승인", body: "트렌드 미션 계획을 확인해 주세요", url: "/approvals/abc" };

  beforeEach(async () => {
    db = await createTestDb();
    ctx = await seed(db);
    sent = [];
    fail = false;
    await saveExportChannel(db, { orgId: ctx.org.id, userId: ctx.user.id, kind: "SLACK", raw: { webhookUrl: "https://hooks.slack.com/services/T/B/x" } });
    await saveExportChannel(db, { orgId: ctx.org.id, userId: ctx.user.id, kind: "EMAIL", raw: { host: "smtp.gmail.com", port: "587", user: "me@example.com", pass: "pw", to: "me@example.com" } });
  });

  const toggle = (channel: "SLACK" | "EMAIL", on: boolean) =>
    toggleNotify(db, { orgId: ctx.org.id, userId: ctx.user.id, kind: "APPROVAL", channel, on, baseUrl: "https://srv.ts.net:10000" });

  it("켜지 않으면 보내지 않는다 (연결만 있어도)", async () => {
    expect(await notifyChannels(db, ctx.org.id, notice, senders)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("켠 채널로 제목 한 줄 + 링크만 보내고, 켜고 끈 것·보낸 것을 기록한다", async () => {
    await toggle("SLACK", true);
    await toggle("EMAIL", true);
    expect(await notifyChannels(db, ctx.org.id, notice, senders)).toBe(2);
    expect(sent[0]).toEqual({ channel: "SLACK", text: "✋ 계획 승인 — 트렌드 미션 계획을 확인해 주세요\n<https://srv.ts.net:10000/approvals/abc|AgentOrg에서 열기>" });
    expect(sent[1].subject).toBe("[AgentOrg] ✋ 계획 승인 — 트렌드 미션 계획을 확인해 주세요");
    expect(sent[1].text).toContain("https://srv.ts.net:10000/approvals/abc");

    await toggle("EMAIL", false);
    sent = [];
    await notifyChannels(db, ctx.org.id, notice, senders);
    expect(sent.map((s) => s.channel)).toEqual(["SLACK"]);
    const actions = (await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.orgId, ctx.org.id))).map((l) => l.action);
    expect(actions.filter((a) => a === "notify.toggle")).toHaveLength(3);
    expect(actions.filter((a) => a === "notify.send")).toHaveLength(3);
  });

  it("승인함이 아닌 알림(예산 경고·레벨업)은 보내지 않는다", async () => {
    await toggle("SLACK", true);
    expect(noticeKind({ title: "⚠️ 예산 경고", url: "/dashboard" })).toBeNull();
    expect(await notifyChannels(db, ctx.org.id, { title: "🎉 레벨업", url: "/agents/1" }, senders)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("보내기에 실패해도 예외를 던지지 않고 실패를 기록한다", async () => {
    await toggle("SLACK", true);
    fail = true;
    await expect(notifyChannels(db, ctx.org.id, notice, senders)).resolves.toBe(0);
    const [log] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "notify.fail"));
    expect(log.reasoning).toContain("404");
  });
});
