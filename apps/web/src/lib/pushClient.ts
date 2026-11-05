import { API_BASE } from "./apiBase";
import { apiCall } from "./accountApi";

export type PushStatus = "unsupported" | "disabled_on_server" | "denied" | "subscribed" | "not_subscribed";

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function serverConfig(): Promise<{ enabled: boolean; vapid_public_key: string | null }> {
  try {
    const response = await fetch(`${API_BASE}/api/push/config`);
    const payload = (await response.json()) as { data?: { enabled: boolean; vapid_public_key: string | null } };
    return payload.data ?? { enabled: false, vapid_public_key: null };
  } catch {
    return { enabled: false, vapid_public_key: null };
  }
}

export async function currentPushStatus(): Promise<PushStatus> {
  if (!isPushSupported()) {
    return "unsupported";
  }
  if (Notification.permission === "denied") {
    return "denied";
  }
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? "subscribed" : "not_subscribed";
}

/** Registers the service worker, subscribes with the server's VAPID key, and stores the subscription. */
export async function enablePush(token: string): Promise<{ status: PushStatus; message: string }> {
  if (!isPushSupported()) {
    return { status: "unsupported", message: "This browser does not support Web Push notifications." };
  }
  const config = await serverConfig();
  if (!config.enabled || !config.vapid_public_key) {
    return { status: "disabled_on_server", message: "Push notifications are not enabled on this deployment yet." };
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { status: "denied", message: "Notification permission was not granted." };
  }
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(config.vapid_public_key) }));
  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const saved = await apiCall<{ subscription_id: string }>(token, "/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys })
  });
  if (!saved.ok) {
    await subscription.unsubscribe().catch(() => undefined);
    return { status: "not_subscribed", message: `Could not enable notifications: ${saved.message}` };
  }
  return { status: "subscribed", message: "Notifications enabled on this device." };
}

export async function disablePush(token: string): Promise<{ status: PushStatus; message: string }> {
  if (!isPushSupported()) {
    return { status: "unsupported", message: "This browser does not support Web Push notifications." };
  }
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await apiCall(token, "/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) });
    await subscription.unsubscribe().catch(() => undefined);
  }
  return { status: "not_subscribed", message: "Notifications disabled on this device." };
}
