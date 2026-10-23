"use server";

// F208 지시 템플릿: 보낸 지시·미션 주제를 템플릿으로 저장, 설정에서 추가·삭제
import { getDb } from "@agentorg/shared/db";
import { deleteDirectiveTemplate, saveDirectiveTemplate } from "@agentorg/shared/directiveTemplates";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getT } from "@/lib/i18n";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export type TemplateState = { error?: string; ok?: string } | undefined;

export async function saveTemplate(_prev: TemplateState, form: FormData): Promise<TemplateState> {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) redirect("/settings");
  const t = await getT();
  const r = await saveDirectiveTemplate(getDb(), { orgId: org.id, userId: user.id, content: String(form.get("content") ?? ""), title: String(form.get("title") ?? "") });
  if ("error" in r) return { error: t(r.error) };
  revalidatePath("/", "layout");
  return { ok: t("템플릿으로 저장했습니다") };
}

export async function deleteTemplate(form: FormData) {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) return;
  const id = String(form.get("id"));
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await deleteDirectiveTemplate(getDb(), { orgId: org.id, userId: user.id, id });
  revalidatePath("/", "layout");
}
