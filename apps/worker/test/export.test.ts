// F205 외부 연동: 보내기 → 승인함(EXTERNAL) → 승인해야만 발송 (절대 규칙 3). 비밀값은 암호화, 실패하면 다시 보내기
import { ApprovalRequiredError, decideApproval } from "@agentorg/shared/approval";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import { type ExportSenders, isExportPayload, parseRecipients, requestExport, runExport, saveExportChannel, toSlackText, validateChannel } from "@agentorg/shared/export";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed } from "./testDb";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "ab".repeat(32);
});

const HOOK = "https://hooks.slack.com/services/T000/B000/secretXYZ9";
const EMAIL = { host: "smtp.gmail.com", port: "587", user: "me@example.com", pass: "abcd efgh ijkl mnop", from: "", to: "a@example.com, b@example.com" };

describe("입력 확인", () => {
  it("슬랙 웹훅·SMTP 형식을 확인하고, 화면용 요약에는 비밀값을 넣지 않는다", () => {
    expect(validateChannel("SLACK", { webhookUrl: "https://evil.example.com/x" })).toHaveProperty("error");
    const s = validateChannel("SLACK", { webhookUrl: HOOK });
    expect("label" in s && s.label).toBe("hooks.slack.com/…XYZ9");
    const e = validateChannel("EMAIL", EMAIL);
    expect("config" in e && e.config).toMatchObject({ pass: "abcdefghijklmnop", from: "me@example.com", to: ["a@example.com", "b@example.com"] });
    expect("label" in e && e.label).not.toContain("abcd");
    expect(validateChannel("EMAIL", { ...EMAIL, to: "아무개" })).toHaveProperty("error");
    expect(parseRecipients("x@y.com;x@y.com\nz@y.com")).toEqual(["x@y.com", "z@y.com"]);
  });

  it("슬랙 글: 제목 굵게, 특수문자 이스케이프, 너무 길면 자른다", () => {
    const t = toSlackText({ title: "보고서", missionTitle: "트렌드", body: `# 요약\n**핵심** <b> [링크](https://a.com)\n${"가".repeat(5000)}` });
    expect(t).toContain("*보고서*\n미션: 트렌드");
    expect(t).toContain("*요약*");
    expect(t).toContain("*핵심* &lt;b&gt; <https://a.com|링크>");
    expect(t.length).toBeLessThan(4000);
    expect(t).toContain("이하 생략");
  });
});

describe("보내기 → 승인 → 발송", () => {
  let db: AnyDb;
  let ctx: Awaited<ReturnType<typeof seed>>;
  let finalId: string;
  let taskArtId: string;
  let sent: { channel: string; to?: string[]; title: string }[];
  let fail: boolean;
  const senders: ExportSenders = {
    async slack(_c, msg) {
      if (fail) throw new Error("슬랙 응답 404: no_service");
      sent.push({ channel: "SLACK", title: msg.title });
    },
    async email(_c, to, msg) {
      sent.push({ channel: "EMAIL", to, title: msg.title });
    },
  };

  beforeEach(async () => {
    db = await createTestDb();
    ctx = await seed(db);
    sent = [];
    fail = false;
    const [mission] = await db.insert(schema.missions).values({ orgId: ctx.org.id, title: "트렌드", topic: "트렌드", status: "DONE" }).returning();
    const [task] = await db.insert(schema.tasks).values({ missionId: mission.id, title: "조사" }).returning();
    const [final] = await db.insert(schema.artifacts).values({ orgId: ctx.org.id, missionId: mission.id, title: "최종 보고서", content: "# 결과\n본문" }).returning();
    const [taskArt] = await db.insert(schema.artifacts).values({ orgId: ctx.org.id, missionId: mission.id, taskId: task.id, title: "조사 결과", content: "내용" }).returning();
    finalId = final.id;
    taskArtId = taskArt.id;
  });

  const base = () => ({ orgId: ctx.org.id, userId: ctx.user.id });

  it("연결 정보는 암호화해 저장하고 감사 로그에 비밀값이 없다", async () => {
    expect(await saveExportChannel(db, { ...base(), kind: "SLACK", raw: { webhookUrl: HOOK } })).toEqual({ ok: true });
    const [row] = await db.select().from(schema.exportChannels);
    expect(row.encryptedConfig).not.toContain("secretXYZ9");
    const logs = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "export.channel_save"));
    expect(JSON.stringify(logs)).not.toContain("secretXYZ9");
  });

  it("연결이 없거나 최종 결과가 아니면 요청을 올리지 않는다", async () => {
    expect(await requestExport(db, { ...base(), artifactId: finalId, channel: "SLACK" })).toHaveProperty("error");
    await saveExportChannel(db, { ...base(), kind: "SLACK", raw: { webhookUrl: HOOK } });
    expect(await requestExport(db, { ...base(), artifactId: taskArtId, channel: "SLACK" })).toEqual({ error: "미션 최종 결과만 보낼 수 있습니다" });
    expect(await db.select().from(schema.approvalRequests)).toHaveLength(0);
  });

  it("승인 전에는 보내지 않고, 승인하면 보내며, 두 번 보내지 않는다", async () => {
    await saveExportChannel(db, { ...base(), kind: "SLACK", raw: { webhookUrl: HOOK } });
    const r = await requestExport(db, { ...base(), artifactId: finalId, channel: "SLACK" });
    if (!("approvalId" in r)) throw new Error(r.error);
    expect(r.existing).toBe(false);
    // 같은 요청을 또 누르면 기존 것을 돌려준다
    expect(await requestExport(db, { ...base(), artifactId: finalId, channel: "SLACK" })).toEqual({ approvalId: r.approvalId, existing: true });

    const [req] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, r.approvalId));
    expect(req.type).toBe("EXTERNAL");
    await expect(runExport(db, { ...base(), approvalId: r.approvalId }, senders)).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(sent).toHaveLength(0);

    const d = await decideApproval(db, { ...base(), approvalId: r.approvalId, decision: "APPROVED" });
    expect(d).toEqual({ notify: null, exportApproved: true });
    expect(await runExport(db, { ...base(), approvalId: r.approvalId }, senders)).toEqual({ ok: true });
    expect(sent).toEqual([{ channel: "SLACK", title: "최종 보고서" }]);
    expect(await runExport(db, { ...base(), approvalId: r.approvalId }, senders)).toEqual({ error: "이미 보냈습니다" });
    expect(sent).toHaveLength(1);

    const [after] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, r.approvalId));
    expect(isExportPayload(after.payload) && after.payload.sentAt).toBeTruthy();
    const actions = (await db.select().from(schema.auditLogs)).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["export.request", "approval.decide", "export.send"]));
  });

  it("거절하면 보내지 않는다", async () => {
    await saveExportChannel(db, { ...base(), kind: "SLACK", raw: { webhookUrl: HOOK } });
    const r = await requestExport(db, { ...base(), artifactId: finalId, channel: "SLACK" });
    if (!("approvalId" in r)) throw new Error(r.error);
    expect(await decideApproval(db, { ...base(), approvalId: r.approvalId, decision: "REJECTED" })).toEqual({ notify: null, exportApproved: false });
    await expect(runExport(db, { ...base(), approvalId: r.approvalId }, senders)).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(sent).toHaveLength(0);
  });

  it("이메일은 고른 받는 사람에게 보내고, 실패하면 이유를 남겨 다시 보낼 수 있다", async () => {
    await saveExportChannel(db, { ...base(), kind: "EMAIL", raw: EMAIL });
    await saveExportChannel(db, { ...base(), kind: "SLACK", raw: { webhookUrl: HOOK } });
    expect(await requestExport(db, { ...base(), artifactId: finalId, channel: "EMAIL", to: "잘못된 주소" })).toHaveProperty("error");
    const e = await requestExport(db, { ...base(), artifactId: finalId, channel: "EMAIL", to: "boss@example.com" });
    if (!("approvalId" in e)) throw new Error(e.error);
    await decideApproval(db, { ...base(), approvalId: e.approvalId, decision: "APPROVED" });
    await runExport(db, { ...base(), approvalId: e.approvalId }, senders);
    expect(sent).toEqual([{ channel: "EMAIL", to: ["boss@example.com"], title: "최종 보고서" }]);

    const s = await requestExport(db, { ...base(), artifactId: finalId, channel: "SLACK" });
    if (!("approvalId" in s)) throw new Error(s.error);
    await decideApproval(db, { ...base(), approvalId: s.approvalId, decision: "APPROVED" });
    fail = true;
    expect(await runExport(db, { ...base(), approvalId: s.approvalId }, senders)).toEqual({ error: "슬랙 응답 404: no_service" });
    const [failed] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, s.approvalId));
    expect(isExportPayload(failed.payload) && failed.payload.error).toContain("404");
    fail = false;
    expect(await runExport(db, { ...base(), approvalId: s.approvalId }, senders)).toEqual({ ok: true });
    const actions = (await db.select().from(schema.auditLogs)).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["export.fail", "export.send"]));
  });
});
