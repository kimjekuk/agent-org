import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// 첫 화면은 대시보드 (F003)
export default async function Home() {
  await requireUser();
  redirect("/dashboard");
}
