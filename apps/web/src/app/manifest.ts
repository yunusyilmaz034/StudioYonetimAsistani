import type { MetadataRoute } from 'next'

// PWA manifest — makes the panel installable to a phone/tablet home screen. Distributed by LINK (this
// URL), gated by staff login: no app store, restricted to whoever has the link + an account.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Studio Yönetim Paneli',
    short_name: 'Studio Panel',
    description: 'Stüdyo yönetim paneli — resepsiyon & sahip',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#F1ECE6',
    theme_color: '#7A1F3D',
    icons: [
      { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
