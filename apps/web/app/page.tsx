import { APP_NAME } from "@agentorg/shared";

export default function Home() {
  return (
    <main className="font-sans flex min-h-screen flex-col items-center justify-center gap-2 p-4">
      <h1 className="text-3xl font-bold">{APP_NAME}</h1>
      <p className="text-sm opacity-70">0-B 자동 배포 확인 — 기능은 1단계부터 추가됩니다.</p>
    </main>
  );
}
