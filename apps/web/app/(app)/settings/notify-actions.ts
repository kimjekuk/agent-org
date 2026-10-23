"use server";

// F207 알림 채널: 종류별로 슬랙·이메일을 켜고 끈다. 켤 때 지금 보고 있는 앱 주소를 알림 링크용으로 저장한다
import { getDb } from "@agentorg/shared/db";
import { NOTIFY_CHANNELS, NOTIFY_KINDS, type NotifyChannel, type NotifyKind, toggleNotify } from "@agentorg/shared/notify";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export async function toggleNotifyAction(form: FormData) {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) return;
  const kind = String(form.get("kind"));
  const channel = String(form.get("channel"));
  if (!(kind in NOTIFY_KINDS) || !(NOTIFY_CHANNELS as readonly string[]).includes(channel)) return;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  await toggleNotify(getDb(), {
    orgId: org.id,
    userId: user.id,
    kind: kind as NotifyKind,
    channel: channel as NotifyChannel,
    on: form.get("on") === "1",
    baseUrl: host ? `${proto.split(",")[0]}://${host}` : null,
  });
  revalidatePath("/settings");
}
