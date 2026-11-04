import { narrateChecklistAction } from '@/server/actions/checklist'
import type { AdvisorItem } from '@/server/advisor-query'

// The dashboard's AI briefing, as a plain request — NOT a Server Action (owner, 2026-11-04: "sistem yavaş").
//
// Next.js runs a page's Server Actions ONE AT A TIME. The briefing waits on the model for up to several
// seconds, and as a Server Action it sat at the head of that queue: reception opened the home screen,
// pressed check-in or saved a note, and the press waited behind the AI (12 s on every timeout — 60 times
// on 4 Nov). A fetch has its own lane; nothing the desk does waits for it.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { items?: unknown }
  const items = Array.isArray(body.items) ? (body.items as AdvisorItem[]).slice(0, 80) : []
  try {
    return Response.json(await narrateChecklistAction(items))
  } catch {
    return Response.json(null, { status: 401 })
  }
}
