"use client";

// F017 웹 푸시: 이 기기에서 알림 켜기·끄기·시험 보내기
import { useEffect, useState, useTransition } from "react";
import { getPushPublicKey, removePushSubscription, savePushSubscription, sendTestPush, type SubscriptionInput } from "@/app/(app)/more/actions";
import { button, buttonGhost } from "@/lib/ui";

type State = "loading" | "unsupported" | "denied" | "off" | "on";

function keyToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((s) => setState(s ? "on" : "off"));
  }, []);

  const enable = () =>
    start(async () => {
      setNote("");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(await getPushPublicKey()) });
      const r = await savePushSubscription(sub.toJSON() as SubscriptionInput);
      if (!r.ok) {
        setNote(r.error ?? "저장하지 못했습니다");
        return;
      }
      setState("on");
      setNote("알림을 켰습니다. '시험 알림'으로 확인해 보세요.");
    });

  const disable = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      setNote("이 기기의 알림을 껐습니다.");
    });

  const test = () =>
    start(async () => {
      const { sent } = await sendTestPush();
      setNote(sent ? "시험 알림을 보냈습니다. 몇 초 안에 도착합니다." : "보낼 기기가 없습니다. 알림을 다시 켜 주세요.");
    });

  if (state === "loading") return <p className="text-sm opacity-60">확인 중…</p>;
  if (state === "unsupported")
    return <p className="text-sm opacity-80">이 브라우저는 알림을 지원하지 않습니다. 아이폰은 Safari에서 &lsquo;홈 화면에 추가&rsquo;로 앱을 설치한 뒤 그 앱에서 켜 주세요.</p>;
  if (state === "denied") return <p className="text-sm opacity-80">알림이 차단되어 있습니다. 브라우저의 사이트 설정에서 알림을 &lsquo;허용&rsquo;으로 바꾼 뒤 다시 열어 주세요.</p>;

  return (
    <div className="flex flex-col gap-2">
      {state === "off" ? (
        <button type="button" onClick={enable} disabled={pending} className={button}>
          {pending ? "켜는 중…" : "🔔 이 기기에서 알림 켜기"}
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={test} disabled={pending} className={button}>
            시험 알림
          </button>
          <button type="button" onClick={disable} disabled={pending} className={buttonGhost}>
            알림 끄기
          </button>
        </div>
      )}
      {note && <p className="text-sm text-green-700 dark:text-green-400">{note}</p>}
    </div>
  );
}
