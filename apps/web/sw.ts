/// <reference lib="webworker" />
/**
 * App-shell service worker (E02-6, injectManifest via vite-plugin-pwa): precaches
 * only the built shell assets. Everything NOT in the precache — /v1/* API calls,
 * WS upgrades, map tiles/styles/glyphs — is deliberately not intercepted and goes
 * straight to the network (live position data must never be served stale).
 */
import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('install', () => {
  void self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Web Push (ADR-026): the worker sends {title, body}; show it as a notification. A malformed/absent
// payload falls back to a generic alert rather than dropping it silently.
//
// The fallbacks are BRANDLESS on purpose. This runs on a reseller's customers' phones and the title
// is what the lock screen shows: `'Orbetra'` there named the platform to people who have never heard
// of it, on a device we do not control, for a notification the tenant's own brand paid for. The
// icon is likewise omitted rather than pointing at ours — and the path it used, `/icon-192.png`,
// did not exist anyway (the real one is /icons/pwa-192.png), so it silently fell through to the
// manifest icon, which until now was ours too.
self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string } = {}
  try {
    data = (event.data?.json() as { title?: string; body?: string }) ?? {}
  } catch {
    data = { body: event.data?.text() }
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? '', {
      body: data.body ?? 'New alert',
      tag: 'fleet-alert',
    }),
  )
})

// clicking a notification focuses an open app tab, or opens one
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => 'focus' in c)
      if (existing) return existing.focus()
      return self.clients.openWindow('/app/events')
    }),
  )
})
