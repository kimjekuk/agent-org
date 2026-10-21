"use server";

// F209 화면 언어(계정별)와 에이전트 기본 사용 언어(조직별)
import { isLanguage, LANGUAGES } from "@agentorg/shared/agents/language";
import { writeAudit } from "@agentorg/shared/audit";
import { getDb, schema } from "@agentorg/shared/db";
import { isLocale, LOCALE_COOKIE, LOCALES } from "@agentorg/shared/i18n";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export async function saveLocale(form: FormData) {
  const user = await requireUser();
  const locale = String(form.get("locale"));
  if (!isLocale(locale)) return;
  await getDb().transaction(async (tx) => {
    await tx.update(schema.users).set({ locale }).where(eq(schema.users.id, user.id));
    await writeAudit(tx, { actorType: "USER", actorId: user.id, action: "user.locale", targetType: "user", targetId: user.id, reasoning: `화면 언어 → ${LOCALES[locale]}` }); // i18n-ignore
  });
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function saveOrgLanguage(form: FormData) {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) return;
  const language = String(form.get("language"));
  if (!isLanguage(language) || language === org.language) return;
  await getDb().transaction(async (tx) => {
    await tx.update(schema.organizations).set({ language }).where(eq(schema.organizations.id, org.id));
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "org.language",
      targetType: "organization",
      targetId: org.id,
      reasoning: `에이전트 기본 사용 언어 → ${LANGUAGES[language].label}`, // i18n-ignore
    });
  });
  revalidatePath("/settings");
}
