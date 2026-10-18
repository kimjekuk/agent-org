"use server";

// F017 웹 푸시 구독 (이 기기에서 알림 켜기·끄기·시험). 모든 변경은 AuditLog에 기록한다
import { writeAudit } from "@agentorg/shared/audit";
import { getDb, schema } from "@agentorg/shared/db";
import { getVapidKeys, notifyUser } from "@agentorg/shared/push";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";

export async function getPushPublicKey(): Promise<string> {
  await requireUser();
  return (await getVapidKeys(getDb())).publicKey;
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function savePushSubscription(sub: SubscriptionInput): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!/^https:\/\//.test(sub?.endpoint ?? "") || !sub.keys?.p256dh || !sub.keys?.auth) return { ok: false, error: "알림 구독 정보가 올바르지 않습니다" };
  await getDb().transaction(async (tx) => {
    await tx
      .insert(schema.pushSubscriptions)
      .values({ userId: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
      .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: { userId: user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    await writeAudit(tx, { actorType: "USER", actorId: user.id, action: "push.subscribe", targetType: "user", targetId: user.id, reasoning: "이 기기에서 알림을 켰습니다" });
  });
  return { ok: true };
}

export async function removePushSubscription(endpoint: string) {
  const user = await requireUser();
  await getDb().transaction(async (tx) => {
    await tx.delete(schema.pushSubscriptions).where(and(eq(schema.pushSubscriptions.endpoint, endpoint), eq(schema.pushSubscriptions.userId, user.id)));
    await writeAudit(tx, { actorType: "USER", actorId: user.id, action: "push.unsubscribe", targetType: "user", targetId: user.id, reasoning: "이 기기에서 알림을 껐습니다" });
  });
}

export async function sendTestPush(): Promise<{ sent: number }> {
  const user = await requireUser();
  const sent = await notifyUser(getDb(), user.id, user.email, { title: "🔔 AgentOrg 알림 시험", body: "알림이 잘 옵니다. 승인 요청·예산 경고·미션 완료를 이렇게 알려 드립니다.", url: "/dashboard", tag: "test" });
  return { sent };
}
