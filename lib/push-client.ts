// Client-side helpers for subscribing/unsubscribing from web push.
// Loaded only in browser code; relies on navigator.serviceWorker + PushManager.

const SW_PATH = "/sw-push.js";

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

export function getPushPermission(): PushPermission {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  return Notification.permission as PushPermission;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (existing) return existing;
  return navigator.serviceWorker.register(SW_PATH);
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (getPushPermission() === "unsupported") return null;
  const reg = await getRegistration();
  return reg.pushManager.getSubscription();
}

export interface SubscribeResult {
  ok: boolean;
  subscription?: PushSubscription;
  error?: string;
}

export async function subscribePush(): Promise<SubscribeResult> {
  if (getPushPermission() === "unsupported") {
    return { ok: false, error: "This browser doesn't support push notifications." };
  }

  const keyRes = await fetch("/api/push/vapid-public-key");
  if (!keyRes.ok) {
    const j = await keyRes.json().catch(() => null);
    return { ok: false, error: j?.error ?? `VAPID key fetch failed (${keyRes.status})` };
  }
  const { publicKey } = (await keyRes.json()) as { publicKey: string };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: `Permission ${permission}` };
  }

  const reg = await getRegistration();
  // Reuse existing subscription if it already exists.
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, error: "Subscription missing endpoint/keys" };
  }

  const saveRes = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent.slice(0, 500),
    }),
  });
  if (!saveRes.ok) {
    const j = await saveRes.json().catch(() => null);
    return { ok: false, error: j?.error ?? `Save failed (${saveRes.status})` };
  }
  return { ok: true, subscription: sub };
}

export async function unsubscribePush(): Promise<{ ok: boolean; error?: string }> {
  if (getPushPermission() === "unsupported") return { ok: false, error: "Unsupported" };
  const reg = await getRegistration();
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
  } else {
    await fetch("/api/push/unsubscribe", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  }
  return { ok: true };
}

export async function sendTestPush(): Promise<{ ok: boolean; sent: number; error?: string }> {
  const res = await fetch("/api/push/test", { method: "POST" });
  const j = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, sent: 0, error: j?.error ?? `HTTP ${res.status}` };
  return { ok: true, sent: j?.sent ?? 0 };
}
