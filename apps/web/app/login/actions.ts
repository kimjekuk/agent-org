"use server";

import { getDb, schema } from "@agentorg/shared/db";
import { isLocale, LOCALE_COOKIE } from "@agentorg/shared/i18n";
import { eq } from "drizzle-orm";
import { AuthError } from "next-auth";
import { cookies } from "next/headers";
import { signIn, signOut } from "@/auth";
import { getT } from "@/lib/i18n";

export async function login(_prev: string | undefined, form: FormData): Promise<string | undefined> {
  try {
    await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      redirectTo: "/dashboard",
    });
  } catch (e) {
    if (e instanceof AuthError) {
      const t = await getT();
      return t("이메일 또는 비밀번호가 맞지 않습니다");
    }
    // 로그인 성공 시의 redirect도 여기로 온다 → F209 계정의 화면 언어를 쿠키에 넣는다
    const [user] = await getDb().select({ locale: schema.users.locale }).from(schema.users).where(eq(schema.users.email, String(form.get("email") ?? "")));
    if (isLocale(user?.locale)) (await cookies()).set(LOCALE_COOKIE, user.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    throw e;
  }
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
