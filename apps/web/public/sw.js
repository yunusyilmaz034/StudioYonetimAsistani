/* eslint-disable no-undef */
// Minimal service worker — its presence enables the Android "install app" prompt. Deliberately does NO
// caching: an admin panel must never serve stale data. It just passes requests through.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
