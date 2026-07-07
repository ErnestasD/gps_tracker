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
