import {
  allStudioIds,
  FirestoreFinanceRepository,
  FirestoreIdentityRepository,
  FirestoreInvoiceRepository,
  invoicesDue,
  loadExcludedMemberIds,
  newCorrelationId,
  notify,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { getAuth } from 'firebase-admin/auth'
import * as logger from 'firebase-functions/logger'

import { db } from '../shared/firebase'
import { notificationDeps, studioNotificationSettings } from '../triggers/on-event-notify'

// FATURA — HAVALE/EFT 7 GÜN (owner, 2026-11-03).
//
// *"EFT ve havaleleri özellikle 7 gün dolmadan kesmek istiyoruz; bunun için 7 gün dolmadan bana mail
// atmanı istiyorum, acil kesilmeli diye."*
//
// Every morning: the transfers with three days or fewer left (or already past) and no "fatura kesildi"
// tick go to every active owner in ONE e-mail. Nothing to report → nothing sent. A tick on the Fatura
// Takibi screen takes the line out of tomorrow's mail; that is the only way to silence it.

const DAY = 86_400_000
const tl = (k: number): string => `${(k / 100).toLocaleString('tr-TR')} ₺`
const gun = (ms: number): string => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })

function line(name: string, receivedAt: number, amountKurus: number, dueAt: number, daysLeft: number): string {
  const kalan = daysLeft < 0 ? `SÜRESİ ${-daysLeft} GÜN GEÇTİ` : daysLeft === 0 ? 'BUGÜN SON GÜN' : `${daysLeft} gün kaldı`
  return `• ${name} — ${tl(amountKurus)} · havale ${gun(receivedAt)} · son gün ${gun(dueAt)} · ${kalan}`
}

async function studio(studioId: StudioId, now: number): Promise<void> {
  const ctx: TenantContext = {
    studioId,
    branchIds: [],
    role: 'owner',
    actor: { type: 'system', id: 'invoice_deadline' } as TenantContext['actor'],
  }
  const d = db()
  const [payments, excluded] = await Promise.all([
    new FirestoreFinanceRepository(d).listPaymentsBetween(ctx, now - 31 * DAY, now),
    loadExcludedMemberIds(d, studioId),
  ])
  const transfers = payments.filter((p) => p.method === 'bank_transfer' && !p.voided)
  if (transfers.length === 0) return
  const marks = await new FirestoreInvoiceRepository(d).listInvoiceMarks(ctx, transfers.map((p) => p.id))
  const due = invoicesDue(transfers, new Set(marks.filter((m) => m.issued).map((m) => m.paymentId)), excluded, now)
  if (due.length === 0) return

  const ids = [...new Set(due.map((x) => x.memberId as string))]
  const snaps = await d.getAll(...ids.map((id) => d.doc(`studios/${studioId}/members/${id}`)))
  const name = new Map(snaps.map((s) => [s.id, String(s.get('fullName') ?? 'Üye')]))
  const lines = due.map((x) => line(name.get(x.memberId as string) ?? 'Üye', x.receivedAt, x.amount.amount, x.dueAt, x.daysLeft)).join('\n')

  const owners = (await new FirestoreIdentityRepository(d).listStaff(ctx)).filter((s) => s.active && s.role === 'owner')
  const deps = notificationDeps(await studioNotificationSettings(studioId))
  const today = Math.floor((now + 3 * 3600_000) / DAY)
  for (const owner of owners) {
    let email: string | null = null
    try {
      email = (await getAuth().getUser(owner.id as string)).email ?? null
    } catch {
      /* no auth account — in-app still reaches her */
    }
    try {
      await notify(deps, ctx, {
        intentId: `invoice-due-${today}-${owner.id}`,
        eventId: null,
        eventType: 'system.invoice_due',
        operationId: newCorrelationId(),
        templateId: 'invoice_due',
        recipient: { kind: 'staff', id: owner.id as string, email, phone: null, displayName: owner.displayName },
        params: { count: String(due.length), lines },
      })
    } catch (e) {
      logger.warn('invoice-due: owner notification failed', { studioId, error: (e as Error)?.message })
    }
  }
  logger.info('invoice-due: sent', { studioId, count: due.length, owners: owners.length })
}

export async function runInvoiceDeadlineSweep(now: number): Promise<void> {
  for (const studioId of await allStudioIds(db())) {
    try {
      await studio(studioId, now)
    } catch (e) {
      // One studio's failure must not stop the rest — and must not be silent either.
      logger.error('invoice-due: sweep failed', { studioId, error: (e as Error)?.message })
    }
  }
}
