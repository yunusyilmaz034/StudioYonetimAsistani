import { describe, expect, it } from 'vitest'

import { instant, type BranchId, type DeviceId, type StaffUserId, type StudioId, type TenantContext } from '../../../shared'
import type { TurnstileCode, TurnstileDevice } from '../domain/types'
import type { CheckinDeps } from './ports'
import { staffCrossTurnstile } from './turnstile'

// PERSONEL TURNİKEDEN GEÇİYOR (owner, 2026-09-13 · OR-74).
//
// Bu dosyanın korduğu iki şey: personel geçişi ÜYE YOLUNA HİÇ DOKUNMAZ (doluluk, varlık, paket), ve
// bir ret KODU HARCAMAZ — sıra üye geçişindekiyle aynı.

const NOW = 1_800_000_000_000
const STUDIO = 'retro' as StudioId
const BRANCH = 'brn_1' as BranchId
const DEVICE = 'dev_1' as DeviceId
const STAFF = 'usr_hoca' as StaffUserId
const CODE = '654321'
const CTX = { studioId: STUDIO, branchIds: [BRANCH], role: 'trainer', actor: { type: 'trainer', id: STAFF } } as unknown as TenantContext

const device = (over: Partial<TurnstileDevice> = {}): TurnstileDevice => ({
  id: DEVICE,
  studioId: STUDIO,
  branchId: BRANCH,
  name: 'Giriş',
  secretHash: 'x',
  active: true,
  lastSeenAt: null,
  createdAt: instant(NOW - 86_400_000),
  ...over,
})

const code = (over: Partial<TurnstileCode> = {}): TurnstileCode => ({
  code: CODE,
  deviceId: DEVICE,
  studioId: STUDIO,
  branchId: BRANCH,
  issuedAt: instant(NOW - 2_000),
  expiresAt: instant(NOW + 20_000),
  usedBy: null,
  usedAt: null,
  usedByKind: null,
  ...over,
})

function kur(opts: { code?: TurnstileCode; device?: TurnstileDevice; prepareRefuses?: boolean; consumeWins?: boolean } = {}) {
  const log = { consumed: [] as unknown[][], committed: 0, prepared: [] as unknown[], memberPathTouched: false }
  const uyeYolu = async () => {
    log.memberPathTouched = true
    throw new Error('personel geçişi üye yoluna dokundu')
  }
  const deps = {
    clock: { now: () => instant(NOW) },
    repo: {
      getTurnstileCode: async () => opts.code ?? code(),
      getDevice: async () => opts.device ?? device(),
      consumeTurnstileCode: async (...args: unknown[]) => {
        log.consumed.push(args.slice(1))
        return opts.consumeWins ?? true
      },
      getPresence: uyeYolu,
      applyCheckIn: uyeYolu,
      saveDeviceWithEvents: uyeYolu,
    },
    entries: { listActiveByMember: uyeYolu },
    staffCrossing: {
      prepare: async (_c: unknown, input: unknown) => {
        log.prepared.push(input)
        return opts.prepareRefuses
          ? ({ ok: false, error: { code: 'own_shift_only' } } as const)
          : ({ ok: true, value: { shiftStarted: true, shiftStartedAt: instant(NOW) } } as const)
      },
      commit: async () => {
        log.committed++
      },
    },
  } as unknown as CheckinDeps & Parameters<typeof staffCrossTurnstile>[0]
  return { deps, log }
}

describe('staffCrossTurnstile', () => {
  it('kodu PERSONEL olarak harcar, vardiyayı yazar ve üye yoluna dokunmaz', async () => {
    const { deps, log } = kur({ device: device({ side: 'in' } as Partial<TurnstileDevice>) })
    const r = await staffCrossTurnstile(deps, CTX, { staffUserId: STAFF, code: CODE, reportedDirection: null })
    expect(r).toEqual({ ok: true, value: { direction: 'in', deviceId: DEVICE, shiftStarted: true, shiftStartedAt: NOW } })
    expect(log.consumed).toEqual([[CODE, STAFF, NOW, 'staff']])
    expect(log.committed).toBe(1)
    expect(log.memberPathTouched).toBe(false)
  })

  it('tek ekranlı kapıda yön TAHMİN EDİLMEZ — null yazılır', async () => {
    const { deps, log } = kur()
    const r = await staffCrossTurnstile(deps, CTX, { staffUserId: STAFF, code: CODE, reportedDirection: null })
    expect(r.ok && r.value.direction).toBe(null)
    expect(log.prepared).toEqual([{ staffUserId: STAFF, deviceId: DEVICE, branchId: BRANCH, direction: null }])
  })

  it('karar reddederse kod HARCANMAZ ve hiçbir şey yazılmaz', async () => {
    const { deps, log } = kur({ prepareRefuses: true })
    const r = await staffCrossTurnstile(deps, CTX, { staffUserId: STAFF, code: CODE, reportedDirection: null })
    expect(r).toEqual({ ok: false, error: { code: 'own_shift_only' } })
    expect(log.consumed).toEqual([])
    expect(log.committed).toBe(0)
  })

  it('süresi dolmuş kodu reddeder — personel için ayrı bir gevşeklik yok', async () => {
    const { deps, log } = kur({ code: code({ expiresAt: instant(NOW - 1) }) })
    const r = await staffCrossTurnstile(deps, CTX, { staffUserId: STAFF, code: CODE, reportedDirection: null })
    expect(r).toEqual({ ok: false, error: { code: 'qr_expired' } })
    expect(log.prepared).toEqual([])
  })

  it('aynı saniyede başkası harcadıysa qr_used döner ve vardiya YAZILMAZ', async () => {
    const { deps, log } = kur({ consumeWins: false })
    const r = await staffCrossTurnstile(deps, CTX, { staffUserId: STAFF, code: CODE, reportedDirection: null })
    expect(r).toEqual({ ok: false, error: { code: 'qr_used' } })
    expect(log.committed).toBe(0)
  })
})
