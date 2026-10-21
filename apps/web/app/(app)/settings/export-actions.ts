"use server";

// F205 내보내기 연결: 이메일(SMTP)·슬랙(웹훅) 등록·삭제. 비밀값은 암호화해 저장하고 기록에는 남기지 않는다
import { getDb } from "@agentorg/shared/db";
import { deleteExportChannel, EXPORT_CHANNELS, type ExportChannel, saveExportChannel } from "@agentorg/shared/export";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export type ExportChannelState = { error?: string; ok?: string } | undefined;

const FIELDS = ["webhookUrl", "host", "port", "user", "pass", "from", "to"];

export async function saveChannel(_prev: ExportChannelState, form: FormData): Promise<ExportChannelState> {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) redirect("/settings");
  const kind = String(form.get("kind"));
  if (!(EXPORT_CHANNELS as readonly string[]).includes(kind)) return { error: "연결 종류를 찾을 수 없습니다" };
  const raw = Object.fromEntries(FIELDS.map((f) => [f, String(form.get(f) ?? "")]));
  let r: Awaited<ReturnType<typeof saveExportChannel>>;
  try {
    r = await saveExportChannel(getDb(), { orgId: org.id, userId: user.id, kind: kind as ExportChannel, raw });
  } catch {
    return { error: "서버 암호화 설정(ENCRYPTION_KEY)이 없습니다. 잠시 후 다시 시도해 주세요" };
  }
  if ("error" in r) return { error: r.error };
  revalidatePath("/settings");
  return { ok: "암호화해서 저장했습니다" };
}

export async function deleteChannel(form: FormData) {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) redirect("/settings");
  const kind = String(form.get("kind"));
  if (!(EXPORT_CHANNELS as readonly string[]).includes(kind)) return;
  await deleteExportChannel(getDb(), { orgId: org.id, userId: user.id, kind: kind as ExportChannel });
  revalidatePath("/settings");
}
