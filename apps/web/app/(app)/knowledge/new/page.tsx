import Link from "next/link";
import { requireUser } from "@/lib/session";
import { DocForm } from "../forms";

// F105 새 지식 문서 직접 쓰기
export default async function NewKnowledgePage() {
  await requireUser();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <Link href="/knowledge" className="text-sm opacity-70">
        ← 지식 베이스
      </Link>
      <h1 className="text-xl font-bold">새 문서</h1>
      <DocForm />
    </main>
  );
}
