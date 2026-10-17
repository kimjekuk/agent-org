"use client";

// SSE(/api/events)로 조직 이벤트를 받으면 화면을 다시 그린다. 데이터는 서버가 DB에서 다시 읽는다.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function LiveRefresh({ orgId }: { orgId: string }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource(`/api/events?org=${encodeURIComponent(orgId)}`);
    source.onmessage = () => {
      // 이벤트가 몰려 와도 0.5초에 한 번만 새로고침
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 500);
    };
    return () => {
      clearTimeout(timer);
      source.close(); // 연결이 끊기면 브라우저가 자동으로 다시 연결한다
    };
  }, [orgId, router]);

  return null;
}
