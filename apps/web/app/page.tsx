import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// 대시보드(F003)는 1-F. 그 전까지는 설정 화면으로 보낸다.
export default async function Home() {
  await requireUser();
  redirect("/settings");
}
