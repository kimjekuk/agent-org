// F207 알림 채널 (2026-10-23 결정): '승인 대기' 알림을 휴대폰 푸시 외에 슬랙·이메일로도. 종류별로 채널을 켜고 끈다.
// 절대 규칙 3과의 관계 (사용자 결정): 설정에서 켠 것을 동의로 본다 — 내 채널로 가는 푸시와 같은 것.
// 그래서 제목 한 줄 + 앱 링크만 보내고, 결과물 내용은 절대 넣지 않는다. 켜고 끈 것·보낸 것은 감사 로그에 남긴다.
// 알림 실패는 작업을 막지 않는다 (예외를 던지지 않음).
import { and, eq, inArray } from "drizzle-orm";
import { writeAudit } from "./audit";
import { type EmailConfig, postSlack, type SlackConfig, sendEmail } from "./channels";
import { decryptSecret } from "./crypto";
import type { AnyDb } from "./db/client";
import { exportChannels, organizations } from "./db/schema";

export const NOTIFY_KINDS = { APPROVAL: "승인 대기" } as const;
export type NotifyKind = keyof typeof NOTIFY_KINDS;
export const NOTIFY_CHANNELS = ["SLACK", "EMAIL"] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

export interface NotifySettings {
  /** 종류 → 켠 채널 */
  kinds?: Partial<Record<NotifyKind, NotifyChannel[]>>;
  /** 알림 링크에 쓸 앱 주소 (설정을 저장한 화면의 주소, 예: https://서버.ts.net:10000) */
  baseUrl?: string;
}

export interface Notice {
  title: string;
  body?: string;
  /** 앱 안 경로 (예: /approvals/…) */
  url: string;
}

export interface NotifySenders {
  slack(config: SlackConfig, text: string): Promise<void>;
  email(config: EmailConfig, subject: string, text: string): Promise<void>;
}

export const defaultNotifySenders: NotifySenders = {
  slack: (config, text) => postSlack(config, text),
  email: (config, subject, text) => sendEmail(config, config.to, { subject, text }),
};

export function parseNotify(v: unknown): NotifySettings {
  return v && typeof v === "object" ? (v as NotifySettings) : {};
}

/** 푸시 알림이 어느 종류인지 (승인함으로 가는 알림 = 승인 대기) */
export function noticeKind(n: Notice): NotifyKind | null {
  return n.url.startsWith("/approvals/") ? "APPROVAL" : null;
}

const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** 보낼 글: 제목 한 줄(짧은 요약 포함) + 링크. 결과물 내용은 넣지 않는다 */
export function noticeText(n: Notice, baseUrl: string | undefined): { line: string; link: string } {
  const line = oneLine(n.body ? `${n.title} — ${n.body}` : n.title, 140);
  return { line, link: baseUrl ? `${baseUrl.replace(/\/$/, "")}${n.url}` : n.url };
}

/** 켠 채널로 보낸다. 보낸 채널 수를 돌려준다 */
export async function notifyChannels(db: AnyDb, orgId: string, n: Notice, senders: NotifySenders = defaultNotifySenders): Promise<number> {
  try {
    const kind = noticeKind(n);
    if (!kind) return 0;
    const [org] = await db.select({ notify: organizations.notify }).from(organizations).where(eq(organizations.id, orgId));
    const settings = parseNotify(org?.notify);
    const wanted = settings.kinds?.[kind] ?? [];
    if (wanted.length === 0) return 0;
    const rows = await db
      .select()
      .from(exportChannels)
      .where(and(eq(exportChannels.orgId, orgId), inArray(exportChannels.kind, [...wanted])));
    const { line, link } = noticeText(n, settings.baseUrl);
    let sent = 0;
    rows.sort((a, b) => NOTIFY_CHANNELS.indexOf(a.kind as NotifyChannel) - NOTIFY_CHANNELS.indexOf(b.kind as NotifyChannel));
    for (const row of rows) {
      const channel = row.kind as NotifyChannel;
      let error: string | null = null;
      try {
        const config = JSON.parse(decryptSecret(row.encryptedConfig));
        if (channel === "SLACK") await senders.slack(config as SlackConfig, `${line}\n<${link}|AgentOrg에서 열기>`);
        else await senders.email(config as EmailConfig, `[AgentOrg] ${line}`, `${line}\n\n${link}\n\n— AgentOrg 알림 (설정 → 알림에서 끌 수 있습니다)`);
        sent++;
      } catch (e) {
        error = ((e as Error).message || "알 수 없는 오류").slice(0, 200);
      }
      await writeAudit(db, {
        orgId,
        actorType: "SYSTEM",
        action: error ? "notify.fail" : "notify.send",
        targetType: "export_channel",
        targetId: row.id,
        reasoning: `${NOTIFY_KINDS[kind]} 알림 → ${channel === "SLACK" ? "슬랙" : "이메일"}${error ? ` 실패: ${error}` : ""}: ${line}`,
      });
    }
    return sent;
  } catch (e) {
    console.error(`[notify] 알림 실패: ${(e as Error).message}`);
    return 0;
  }
}

/** 설정에서 종류·채널 하나를 켜고 끈다 (켠 것 = 사용자 동의, 감사 로그에 남김) */
export async function toggleNotify(
  db: AnyDb,
  input: { orgId: string; userId: string; kind: NotifyKind; channel: NotifyChannel; on: boolean; baseUrl?: string | null },
): Promise<NotifySettings> {
  return db.transaction(async (tx) => {
    const [org] = await tx.select({ notify: organizations.notify }).from(organizations).where(eq(organizations.id, input.orgId));
    const cur = parseNotify(org?.notify);
    const list = new Set(cur.kinds?.[input.kind] ?? []);
    if (input.on) list.add(input.channel);
    else list.delete(input.channel);
    const next: NotifySettings = {
      ...cur,
      kinds: { ...cur.kinds, [input.kind]: NOTIFY_CHANNELS.filter((c) => list.has(c)) },
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    };
    await tx.update(organizations).set({ notify: next }).where(eq(organizations.id, input.orgId));
    await writeAudit(tx, {
      orgId: input.orgId,
      actorType: "USER",
      actorId: input.userId,
      action: "notify.toggle",
      targetType: "organization",
      targetId: input.orgId,
      reasoning: `${NOTIFY_KINDS[input.kind]} 알림 ${input.channel === "SLACK" ? "슬랙" : "이메일"} ${input.on ? "켬 (사용자 동의)" : "끔"}`,
    });
    return next;
  });
}
