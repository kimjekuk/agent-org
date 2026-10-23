// F017 웹 푸시 알림 (PWA). 승인 대기·예산 경고·미션 완료를 조직 소유자의 기기로 보낸다.
// VAPID 키는 처음 쓸 때 만들어 app_secrets에 암호화해 저장한다 (서버 설정 불필요).
// 알림 실패는 작업을 막지 않는다 — 예외를 던지지 않고, 만료된 구독(404·410)은 지운다.
import { eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { decryptSecret, encryptSecret } from "./crypto";
import type { AnyDb } from "./db/client";
import { appSecrets, organizations, pushSubscriptions, users } from "./db/schema";
import { notifyChannels } from "./notify";

const VAPID = "vapid";

export interface PushMessage {
  title: string;
  body: string;
  /** 알림을 누르면 열 화면 (예: /approvals/…) */
  url: string;
  /** 같은 tag의 알림은 새 것으로 바뀐다 */
  tag?: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export async function getVapidKeys(db: AnyDb): Promise<VapidKeys> {
  const [row] = await db.select().from(appSecrets).where(eq(appSecrets.name, VAPID));
  if (row) return JSON.parse(decryptSecret(row.encryptedValue)) as VapidKeys;
  const keys = webpush.generateVAPIDKeys();
  // 동시에 두 곳에서 만들면 먼저 저장된 것을 쓴다
  await db.insert(appSecrets).values({ name: VAPID, encryptedValue: encryptSecret(JSON.stringify(keys)) }).onConflictDoNothing();
  const [saved] = await db.select().from(appSecrets).where(eq(appSecrets.name, VAPID));
  return JSON.parse(decryptSecret(saved.encryptedValue)) as VapidKeys;
}

/** 조직 소유자의 모든 기기로 보낸다. 보낸 기기 수를 돌려준다. F207: 설정에서 켠 슬랙·이메일로도 보낸다 */
export async function notifyOrgOwner(db: AnyDb, orgId: string, msg: PushMessage): Promise<number> {
  await notifyChannels(db, orgId, msg);
  try {
    const [org] = await db
      .select({ ownerId: organizations.ownerId, email: users.email })
      .from(organizations)
      .innerJoin(users, eq(users.id, organizations.ownerId))
      .where(eq(organizations.id, orgId));
    if (!org) return 0;
    return await notifyUser(db, org.ownerId, org.email, msg);
  } catch (e) {
    console.error(`[push] 알림 실패: ${(e as Error).message}`);
    return 0;
  }
}

export async function notifyUser(db: AnyDb, userId: string, email: string, msg: PushMessage): Promise<number> {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  if (subs.length === 0) return 0;
  const keys = await getVapidKeys(db);
  const payload = JSON.stringify(msg);
  const expired: string[] = [];
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          vapidDetails: { subject: `mailto:${email}`, publicKey: keys.publicKey, privateKey: keys.privateKey },
          TTL: 24 * 60 * 60,
          timeout: 5000,
        });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) expired.push(s.id);
        else console.error(`[push] 전송 실패 (${status ?? "네트워크"})`);
      }
    }),
  );
  if (expired.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, expired));
  return sent;
}
