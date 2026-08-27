import type { DomainError, EntitlementId, Result, TenantContext } from '../../../shared'
import { decideAdjust, decideRestoreEntry, decideRevokeEntry } from '../domain/decide'
import { entriesUsed, type AdjustmentReason } from '../domain/types'
import { decideContext, loadEntitlement } from './context'
import type { EntitlementsDeps } from './ports'

export interface AdjustCreditsInput {
  readonly entitlementId: EntitlementId
  readonly delta: number
  readonly reason: AdjustmentReason
  readonly note: string
}

// Admin credit adjustment (AD-39, I-20): closed-enum reason + mandatory note,
// enforced in the domain. A decrease below zero is refused, never clamped.
export async function adjustCredits(
  deps: EntitlementsDeps,
  ctx: TenantContext,
  input: AdjustCreditsInput,
): Promise<Result<void, DomainError>> {
  const ent = await loadEntitlement(deps, ctx, input.entitlementId)
  const outcome = decideAdjust(decideContext(deps, ctx), ent, input.delta, input.reason, input.note)
  if (!outcome.ok) return outcome
  await deps.repo.saveEntitlement(ctx, outcome.value.next, outcome.value.events)
  return { ok: true, value: undefined }
}

export interface AdjustEntriesInput {
  readonly entitlementId: EntitlementId
  /** Üyede KALMASI istenen giriş sayısı. Paketin hakkı değil — onun kullanımı. */
  readonly targetRemaining: number
  readonly note: string
}

/**
 * FITNESS GİRİŞ SAYACINI DÜZELT — paketin hakkına dokunmadan (owner, 2026-08-27).
 *
 * Owner'ın cümlesi: *"ben paketin hakkı değil onun kalan kullanımını değiştirmek istiyorum."*
 *
 * `entryAllowance` ÜRÜNÜN verdiği hak — 8 girişlik bir paket 8 girişliktir. Kalan sayı ise
 * `allowance − kullanılan`. Resepsiyon "kalan 5 olsun" dediğinde düzeltilmesi gereken KULLANIM'dır;
 * hakkı 7'ye çekmek, sayıyı doğru gösterip paketi yanlış anlatır — ve o paket bir daha hiçbir
 * raporda 8'lik görünmez.
 *
 * Kredi tarafı bunu zaten böyle yapıyor: `granted` sabit kalır, defter hareket eder. Bu, giriş
 * tarafının aynısı.
 *
 * İKİ YÖN, AMA AYRI KUTULAR. Artırmak bir geri verme (`entry_restored`), azaltmak bir geri alma
 * (`entry_revoked`). Azaltmayı `consumed`'a yazmak, olmamış bir ziyareti geçmişine koymak olurdu —
 * ve stüdyo o geçmişi kâğıt föyle karşılaştırıyor, yani yalan bulunur ve inanılır. Kredi defteri bu
 * ayrımı ilk günden yapıyor: *"consumed demek bir ders onu aldı demek."* Giriş defterine bu kutu
 * bugüne kadar hiç açılmamıştı; ilk denemede azaltmayı reddetmem de onun eksikliğindendi.
 */
export async function adjustEntries(
  deps: EntitlementsDeps,
  ctx: TenantContext,
  input: AdjustEntriesInput,
): Promise<Result<{ readonly remaining: number }, DomainError>> {
  let ent = await loadEntitlement(deps, ctx, input.entitlementId)
  const allowance = ent.productSnapshot.entryAllowance
  if (allowance == null) return { ok: false, error: { code: 'operation_not_applicable' } }
  if (input.targetRemaining < 0 || input.targetRemaining > allowance) {
    return { ok: false, error: { code: 'invalid_amount' } }
  }

  const remainingOf = (e: typeof ent): number => Math.max(0, allowance - entriesUsed(e.entryLedger))
  const delta = input.targetRemaining - remainingOf(ent)
  if (delta === 0) return { ok: true, value: { remaining: remainingOf(ent) } }

  // Tek tek, çünkü her hareket kendi olayını yazıyor: "üç giriş iade edildi" diye tek bir olay yok,
  // üç iade var — defterde hangisinin ne zaman yapıldığı ayrı ayrı duruyor.
  for (let i = 0; i < Math.abs(delta); i++) {
    const outcome =
      delta > 0
        ? decideRestoreEntry(decideContext(deps, ctx), ent, null, input.note)
        : decideRevokeEntry(decideContext(deps, ctx), ent, input.note)
    if (!outcome.ok) return outcome
    await deps.repo.saveEntitlement(ctx, outcome.value.next, outcome.value.events)
    ent = outcome.value.next
  }
  return { ok: true, value: { remaining: remainingOf(ent) } }
}
