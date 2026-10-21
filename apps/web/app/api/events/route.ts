// 실시간 이벤트 (SSE). worker·web이 Redis에 발행한 조직 이벤트를 브라우저로 전달한다 (PRD 5장 "실시간 전달")
import { createSubscriber, orgChannel } from "@agentorg/shared/events";
import { getT } from "@/lib/i18n";
import { getOwnedOrg } from "@/lib/org";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const t = await getT();
  const userId = (await getSessionUser())?.id;
  if (!userId) return new Response(t("로그인이 필요합니다"), { status: 401 });
  const orgId = new URL(request.url).searchParams.get("org") ?? "";
  if (!(await getOwnedOrg(userId, orgId))) return new Response(t("조직을 찾을 수 없습니다"), { status: 404 });

  const encoder = new TextEncoder();
  const sub = createSubscriber();
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // 연결이 이미 닫힘
        }
      };
      sub.on("message", (_channel, payload) => send(`data: ${payload}\n\n`));
      await sub.subscribe(orgChannel(orgId));
      send(": connected\n\n");
      // 프록시가 유휴 연결을 끊지 않도록 25초마다 주석 한 줄
      heartbeat = setInterval(() => send(": ping\n\n"), 25_000);
    },
    cancel() {
      clearInterval(heartbeat);
      sub.disconnect();
    },
  });

  request.signal.addEventListener("abort", () => {
    clearInterval(heartbeat);
    sub.disconnect();
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
