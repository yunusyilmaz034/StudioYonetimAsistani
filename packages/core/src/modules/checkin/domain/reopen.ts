import type { BranchId, DeviceId, MemberId, NewEvent } from '../../../shared'
import { TURNSTILE_REOPENED } from '../events'
import { DEBOUNCE_MS, type DecideContext } from './decide'
import type { CheckIn, CheckInDirection } from './types'

// ── KOL DÖNMEDİ, TEKRAR OKUTTU (owner, 2026-09-14 · OR-79) ─────────────────────────────────
//
// *"hoşgeldiniz diyor ama kol ilerlemiyor"* — ve üye tekrar okutunca çift-okuma koruması "az önce geçti" diye
// reddediyordu: kaydı yazılmış ama kapıdan geçememiş üye 45 saniye kapıda kalıyordu. Owner: kol bir kez daha açılsın.
//
// SAF. Kural dar, bilerek — her gevşeklik bir kişinin daha arkadaşını sokabilmesi demek:
//   · Son geçiş TURNİKEDEN olmalı (resepsiyonun elle geçirmesi değil).
//   · AYNI YÖNDE (giriş ekranından girip giriş ekranını tekrar okutan).
//   · Son geçişten 45 sn içinde (çift-okuma koruması penceresiyle aynı; ondan sonrası zaten normal geçiştir).
//   · Her geçiş için BİR KEZ. Açık kalan telefon kamerası kodu kendiliğinden okumaya devam etse bile kol ikinci kez açılmaz.
// Yeni giriş YAZILMAZ: doluluk, yoklama, paket hakkı etkilenmez. Olay yalnızca kolun tekrar açıldığını söyler.

export interface TurnstileReopen {
  /** Damgalanmış son geçiş kaydı. */
  readonly checkIn: CheckIn
  readonly events: NewEvent[]
}

export function decideTurnstileReopen(
  ctx: DecideContext,
  input: { readonly memberId: MemberId; readonly branchId: BranchId; readonly deviceId: DeviceId; readonly direction: CheckInDirection },
  /** Üyenin son geçişleri, EN YENİSİ BAŞTA. */
  recent: readonly CheckIn[],
): TurnstileReopen | null {
  const son = recent[0]
  if (!son) return null
  if (son.method !== 'device') return null
  if (son.direction !== input.direction) return null
  if (ctx.now - son.occurredAt >= DEBOUNCE_MS) return null
  if (son.reopenedAt) return null

  return {
    checkIn: { ...son, reopenedAt: ctx.now },
    events: [
      {
        studioId: ctx.studioId,
        branchId: input.branchId,
        version: 1,
        occurredAt: ctx.now,
        actor: ctx.actor,
        source: ctx.source,
        subject: { kind: 'member', id: input.memberId as string },
        related: { memberId: input.memberId },
        policyRef: null,
        commandId: null,
        causationId: null,
        correlationId: ctx.correlationId,
        type: TURNSTILE_REOPENED,
        payload: {
          deviceId: input.deviceId as string,
          direction: input.direction,
          secondsSinceCrossing: Math.floor((ctx.now - son.occurredAt) / 1000),
        },
      },
    ],
  }
}
