import { getJson, mutate } from './client'

/** Web Push subscription helpers (ADR-026). The VAPID public key is fetched from the API (not baked
 *  into the build), so rotating it needs no re-deploy of the client. */

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** base64url VAPID key → the ArrayBuffer PushManager.subscribe wants for applicationServerKey. */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const buf = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return buf
}

const vapidKey = () => getJson<{ key: string | null }>('/v1/push/vapid-key')

/** Is this browser currently subscribed to push for this app? */
export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false
  const reg = await navigator.serviceWorker.ready
  return (await reg.pushManager.getSubscription()) !== null
}

/** Request permission, subscribe, and register the subscription with the server. Returns false if
 *  unsupported, permission denied, or push not configured server-side. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false
  const { key } = await vapidKey()
  if (key === null) return false // server has no VAPID keys → push unavailable
  if ((await Notification.requestPermission()) !== 'granted') return false
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBuffer(key) }))
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return false
  try {
    await mutate('POST', '/v1/push/subscribe', { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } })
  } catch (err) {
    // the server rejected it (e.g. a tenant-wide admin with no account) — don't leave a dangling
    // browser subscription the server never stored, or the UI would show "On" yet nothing arrives
    await sub.unsubscribe().catch(() => undefined)
    throw err
  }
  return true
}

/** Unsubscribe this browser + tell the server to drop it. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub === null) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  await mutate('POST', '/v1/push/unsubscribe', { endpoint }).catch(() => undefined)
}
