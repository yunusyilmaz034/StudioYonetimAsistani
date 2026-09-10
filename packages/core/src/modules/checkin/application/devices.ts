import { ok, type BranchId, type DeviceId, type DomainError, type Result, type TenantContext } from '../../../shared'
import {
  decideRegisterDevice,
  decideRotateDeviceSecret,
  decideSetDeviceActive,
} from '../domain/decide'
import type { TurnstileDevice } from '../domain/types'
import { decideContext } from './context'
import type { CheckinDeps } from './ports'

// ── KAPI CİHAZLARININ YÖNETİMİ (owner onayı, 2026-09-11) ────────────────────────────────────
//
// İlk iki cihaz ELLE oluşturulmuştu ve sır `secrets.h`e yazılıp flash'lanıyordu: her yeni kapı bir
// Mac, bir yazılımcı ve bir gece. `TURNSTILE-HARDWARE.md` §5 bunu ikinci stüdyodan önce kapatılacak
// üç işten biri sayıyordu — *"ikinci kapı takıldığı anda bunlar birer arıza olarak geri gelir."*
//
// SIR BU KATMANA HAZIR GELİR. Rastgelelik burada da üretilmiyor: `secretHash` çağıranın işi, tıpkı
// `issueTurnstileCode`ın rastgele hanelerini dışarıdan alması gibi. Tohumlanamayan bir üreteç
// sınanamaz, ve bir kapı anahtarının üretimi sınanamayan tek yer olmamalı.

export async function registerDevice(
  deps: CheckinDeps,
  ctx: TenantContext,
  input: { deviceId: DeviceId; branchId: BranchId; name: string; side: 'in' | 'out' | null; secretHash: string },
): Promise<Result<TurnstileDevice, DomainError>> {
  // Var olanı OKUYORUZ: aynı kimlikle ikinci bir kayıt, duvarda çalışan bir kapının sırrını
  // sessizce değiştirirdi — kutu yerinde kalır, kimse açamaz, sebebi hiçbir yerde yazmaz.
  const existing = await deps.repo.getDevice(ctx, input.deviceId)
  const decided = decideRegisterDevice(decideContext(deps, ctx), existing, input)
  if (!decided.ok) return decided
  await deps.repo.saveDeviceWithEvents(ctx, decided.value.next, decided.value.events)
  return ok(decided.value.next)
}

export async function rotateDeviceSecret(
  deps: CheckinDeps,
  ctx: TenantContext,
  input: { deviceId: DeviceId; secretHash: string; reason: string },
): Promise<Result<void, DomainError>> {
  const device = await deps.repo.getDevice(ctx, input.deviceId)
  if (!device) return { ok: false, error: { code: 'operation_not_applicable' } }
  const decided = decideRotateDeviceSecret(decideContext(deps, ctx), device, input.secretHash, input.reason)
  if (!decided.ok) return decided
  // Eski sır bu yazımdan itibaren ÖLÜ. Duvardaki kutu yeni sırrı alana kadar kapı açmaz, ve bu
  // bilerek böyle: kaybolmuş bir anahtarı "geçiş dönemi" adına bir süre daha geçerli tutmanın adı
  // sızıntıdır.
  await deps.repo.saveDeviceWithEvents(ctx, decided.value.next, decided.value.events)
  return ok(undefined)
}

/** Devre dışı bırakmak SİLMEK değildir: cihazın geçmişi durur, yalnızca kapıyı artık açmaz. */
export async function setDeviceActive(
  deps: CheckinDeps,
  ctx: TenantContext,
  input: { deviceId: DeviceId; active: boolean },
): Promise<Result<void, DomainError>> {
  const device = await deps.repo.getDevice(ctx, input.deviceId)
  if (!device) return { ok: false, error: { code: 'operation_not_applicable' } }
  const decided = decideSetDeviceActive(decideContext(deps, ctx), device, input.active)
  if (decided.events.length > 0) await deps.repo.saveDeviceWithEvents(ctx, decided.next, decided.events)
  return ok(undefined)
}
