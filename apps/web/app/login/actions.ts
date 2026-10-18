"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";

export async function login(_prev: string | undefined, form: FormData): Promise<string | undefined> {
  try {
    await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      redirectTo: "/dashboard",
    });
  } catch (e) {
    if (e instanceof AuthError) return "이메일 또는 비밀번호가 맞지 않습니다";
    throw e; // 로그인 성공 시의 redirect도 여기로 온다
  }
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
