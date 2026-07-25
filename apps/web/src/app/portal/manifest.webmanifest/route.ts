// The MEMBER portal's own PWA manifest.
//
// The root `manifest.ts` describes the STAFF panel: `start_url: '/'`. A member who used "Ana Ekrana
// Ekle" would install that — and every launch would drop her on the staff login she can never pass.
// This manifest is scoped to `/portal`, so her home-screen icon opens her portal.
//
// It is a route, not a static file, because `start_url` has to carry `?s=<studioId>`: the login
// screen needs to know which studio she belongs to, and this platform is multi-tenant — the studio
// can never be a literal in the file.
export const dynamic = 'force-dynamic'

export function GET(req: Request): Response {
  const studioId = new URL(req.url).searchParams.get('s')?.trim() ?? ''
  const start = studioId ? `/portal/login?s=${encodeURIComponent(studioId)}` : '/portal/login'

  return Response.json(
    {
      name: 'Üyelik',
      short_name: 'Üyelik',
      description: 'Rezervasyonların, kalan ders hakkın ve programın',
      start_url: start,
      scope: '/portal',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#F1ECE6',
      theme_color: '#7A1F3D',
      icons: [
        { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' } },
  )
}
