import { loadExcludedMemberIds, type TenantContext } from '@studio/core'

import { formatKurus } from '@/lib/payroll-labels'

import { adminDb } from './firebase-admin'
import { studioToday } from './reservations-query'
import type { AdvisorItem } from './advisor-query'

// SANAL POS TAHSİLATLARI — today's card money, on the checklist, at the top, with its origin named.
//
// WHY IT IS HERE AND NOT IN THE TILL. An online payment carries no `drawerId`: the money goes from
// the payment institution to the bank account, never through the drawer, and putting it in the till
// would make the evening count short by exactly that amount. Correct — and it meant the owner had
// nowhere at all to see "what came in by card today" except the provider's own panel. On 2026-08-18
// a ₺14.000 package was paid by link, recorded perfectly, and he could not find it.
//
// So it is not a warning and nothing is wrong when it appears. It is the day's card takings, named,
// with the member, the package and WHERE THE PAYMENT CAME FROM on each line, sitting where he
// already looks.
//
// WHERE IT CAME FROM is not stored on the payment — it is a property of the intent that produced it
// (`purpose` + `flow` + who created it), and the two are joined by the id they share. The callback
// mints `pay_<ref>` from `pin_<ref>`, so the join is a key swap rather than a query.

/** The four ways money can reach us by card, in the owner's words. */
function originLabel(intent: Record<string, unknown> | undefined): string {
  if (!intent) return 'Sanal POS'
  const purpose = String(intent.purpose ?? '')
  const flow = String(intent.flow ?? '')
  const actor = String((intent.createdBy as { type?: string } | undefined)?.type ?? '')
  // A member acting for herself is the app or the member portal — nobody at the desk was involved.
  if (actor === 'member') return 'Üye mobil uygulamasından'
  if (purpose === 'public_membership') return 'Web sitesinden online üyelik'
  if (flow === 'link') return 'Ödeme linki (resepsiyon gönderdi)'
  if (flow === 'pos') return 'Sanal POS (resepsiyonda kartla)'
  return 'Sanal POS'
}

export async function onlinePaymentAdvisorItems(ctx: TenantContext): Promise<readonly AdvisorItem[]> {
  // Studio-local midnight, not UTC. A payment at 01:30 belongs to the day the studio calls it.
  const startMs = Date.parse(`${studioToday()}T00:00:00+03:00`)

  const snap = await adminDb()
    .collection(`studios/${ctx.studioId}/payments`)
    .where('receivedAt', '>=', new Date(startMs))
    .limit(200)
    .get()

  const rows = snap.docs
    .map((d) => ({ id: d.id, x: d.data() as Record<string, unknown> }))
    // `online` is what the provider callback writes. Cash, transfer and card-at-the-desk are the
    // drawer's business and are already counted there.
    .filter((r) => String(r.x.method) === 'online')
    .map((r) => ({
      paymentId: r.id,
      memberId: String(r.x.memberId ?? ''),
      amountKurus: Number((r.x.amount as { amount?: number } | undefined)?.amount ?? 0),
      receivedAtMs: msOf(r.x.receivedAt),
      note: String(r.x.note ?? ''),
    }))
    .filter((r) => r.amountKurus > 0)
    .sort((a, b) => b.receivedAtMs - a.receivedAtMs)

  // Stüdyonun kendi test hesabının kart ödemesi burada iş olarak görünmez (owner, 2026-08-27):
  // *"paket aldı etti kasaya yansımasın, bu tamamen demo."* Aynı liste, aynı anlam — olay silinmez,
  // okuma modeli saymaz.
  const excluded = await loadExcludedMemberIds(adminDb(), ctx.studioId)
  const visible = excluded.size === 0 ? rows : rows.filter((r) => !excluded.has(r.memberId))

  if (visible.length === 0) return []

  // Two batched reads: the members' names and the intents' origins. Both by id, both bounded by the
  // number of card payments the studio took today — a handful.
  const memberIds = [...new Set(visible.map((r) => r.memberId).filter(Boolean))]
  const names = await getAllById(ctx, 'members', memberIds, (d) => String(d.get('fullName') ?? ''))
  const intentIds = visible.map((r) => r.paymentId.replace(/^pay_/, 'pin_'))
  const intents = await getAllById(ctx, 'paymentIntents', intentIds, (d) => d.data() as Record<string, unknown>)

  const total = visible.reduce((s, r) => s + r.amountKurus, 0)

  return visible.map((r, i) => {
    const name = names.get(r.memberId) || 'Bilinmeyen üye'
    const time = new Date(r.receivedAtMs + 3 * 3_600_000).toISOString().slice(11, 16)
    const intent = intents.get(r.paymentId.replace(/^pay_/, 'pin_'))
    const what = String((intent?.context as { note?: string } | undefined)?.note ?? r.note ?? '').trim()
    return {
      id: `online_payment:${r.paymentId}`,
      kind: 'online_payment' as const,
      // `info`, deliberately. This is good news, and colouring money-that-arrived as urgent would
      // teach the eye to skim the colour that means something is wrong.
      severity: 'info' as const,
      subject: r.memberId ? { id: r.memberId, name } : null,
      title: `${name} — ${formatKurus(r.amountKurus)} karttan tahsil edildi`,
      detail:
        `${originLabel(intent)} · saat ${time}` +
        (what ? ` · ${what}` : '') +
        '. Para banka hesabına geçer, kasaya girmez.' +
        // The single-row case has no group header to carry the day's total, so the first row does.
        (i === 0 && visible.length > 1 ? ` Bugün karttan toplam ${formatKurus(total)}.` : ''),
      href: r.memberId ? `/members/${r.memberId}` : '/finance',
      actionLabel: r.memberId ? 'Üyeyi aç' : 'Kasayı aç',
    }
  })
}

/** `getAll` in chunks of 30, mapped by document id. Missing documents are simply absent. */
async function getAllById<T>(
  ctx: TenantContext,
  collection: string,
  ids: readonly string[],
  pick: (d: FirebaseFirestore.DocumentSnapshot) => T,
): Promise<Map<string, T>> {
  const out = new Map<string, T>()
  const unique = [...new Set(ids)].filter(Boolean)
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30)
    const docs = await adminDb().getAll(...chunk.map((id) => adminDb().doc(`studios/${ctx.studioId}/${collection}/${id}`)))
    for (const d of docs) if (d.exists) out.set(d.id, pick(d))
  }
  return out
}

function msOf(v: unknown): number {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object') {
    const t = v as { toMillis?: () => number; _seconds?: number }
    if (typeof t.toMillis === 'function') return t.toMillis()
    if (typeof t._seconds === 'number') return t._seconds * 1000
  }
  return 0
}
