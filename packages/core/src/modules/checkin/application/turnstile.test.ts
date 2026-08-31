import { describe, expect, it } from 'vitest'

import { instant, type BranchId, type DeviceId, type MemberId, type StudioId, type TenantContext } from '../../../shared'
import type { CheckIn, Presence, TurnstileCode, TurnstileDevice } from '../domain/types'
import type { CheckinDeps } from './ports'
import { crossTurnstile } from './turnstile'

// WHY THIS FILE EXISTS.
//
// `decideCheckIn` refuses a second crossing within 45 s — unless a direction was STATED, because
// reception pressing "Çıkış" is a deliberate act and refusing it would leave a member stuck inside.
// The turnstile passed a direction on every crossing, so it took that exemption every time and the
// guard never once ran on the path it was written for.
//
// The screen issues a new code every few seconds. A member who left the camera open entered and
// immediately left again, and occupancy drifted somewhere nobody was looking. The owner found it in
// ten minutes of real use; 1094 tests had not, because every one of them stopped at a layer
// boundary — the domain was tested with a direction, and nobody asked what the turnstile sends.

const NOW = 1_800_000_000_000
const STUDIO = 'retro' as StudioId
const BRANCH = 'brn_1' as BranchId
const MEMBER = 'mem_1' as MemberId
const DEVICE = 'dev_1' as DeviceId
const CODE = '123456'

const CTX = { studioId: STUDIO, branchIds: [BRANCH], role: 'kiosk', actor: { type: 'device', id: DEVICE } } as unknown as TenantContext

const device: TurnstileDevice = {
  id: DEVICE,
  studioId: STUDIO,
  branchId: BRANCH,
  name: 'Giriş turnikesi',
  secretHash: 'x',
  active: true,
  lastSeenAt: null,
  createdAt: instant(NOW - 86_400_000),
}

const code: TurnstileCode = {
  code: CODE,
  deviceId: DEVICE,
  studioId: STUDIO,
  branchId: BRANCH,
  issuedAt: instant(NOW - 2_000),
  expiresAt: instant(NOW + 20_000),
  usedBy: null,
  usedAt: null,
}

/** Only what `crossTurnstile` touches. A fuller fake would hide which parts decide anything. */
/** Bugün geçerli bir paket. Kapı 2026-08-31'den beri buna bakıyor, o yüzden varsayılan bu. */
const CANLI_PAKET = [
  { validFrom: instant(NOW - 30 * 86_400_000), validUntil: instant(NOW + 30 * 86_400_000), productSnapshot: {} },
] as never

function fakeDeps(opts: {
  presence: Presence | null
  lastCrossedAt?: number
  tuketilenler?: string[]
  /** Varsayılan: canlı bir paketi var. `[]` ⇒ paketi yok, kol dönmemeli. */
  paketler?: unknown
}): CheckinDeps {
  const recent: CheckIn[] =
    opts.lastCrossedAt === undefined
      ? []
      : ([{ occurredAt: instant(opts.lastCrossedAt) }] as unknown as CheckIn[])

  return {
    clock: { now: () => instant(NOW) },
    repo: {
      getTurnstileCode: async () => code,
      getDevice: async () => device,
      getPresence: async () => opts.presence,
      consumeTurnstileCode: async (_c: unknown, kod: string) => {
        opts.tuketilenler?.push(kod)
        return true
      },
      getBranch: async () => ({ branchId: BRANCH, isOpen: true, capacity: 50 }),
      countPresence: async () => 3,
      listCheckInsByMember: async () => recent,
      applyCheckIn: async () => undefined,
      touchDevice: async () => undefined,
    },
    // Sayaç bu testlerin konusu değil, ama kapı hem sayaçtan hem paket kontrolünden geçiyor.
    entries: { listActiveByMember: async () => opts.paketler ?? CANLI_PAKET, saveEntitlement: async () => undefined },
  } as unknown as CheckinDeps
}

const inside: Presence = { memberId: MEMBER, branchId: BRANCH, checkedInAt: instant(NOW - 15_000) }

describe('crossTurnstile — the double-scan guard actually runs', () => {
  it('refuses a second crossing seconds after the first', async () => {
    // The exact case the owner hit: scan, then the screen rotates and the still-open camera fires
    // again. Under the old code this recorded an exit fifteen seconds after the entry.
    const r = await crossTurnstile(fakeDeps({ presence: inside, lastCrossedAt: NOW - 15_000 }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('checkin_too_soon')
  })

  it('lets her out once the window has passed', async () => {
    const r = await crossTurnstile(fakeDeps({ presence: inside, lastCrossedAt: NOW - 60_000 }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: null,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toBe('out')
  })

  it('a first crossing is never debounced — there is nothing to repeat', async () => {
    const r = await crossTurnstile(fakeDeps({ presence: null }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: null,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toBe('in')
  })

  it("the screen's SIDE decides the direction, not whether she seems to be inside", async () => {
    // The bug the owner hit at midnight: scanning the ENTRY screen recorded an EXIT. The redemption
    // computed the direction from `device.side` correctly and then `crossTurnstile` threw that
    // result away, passing only the arm's report — which is null. So the check-in fell back to
    // presence and the records alternated out/in/out/in regardless of which screen was scanned.
    const giris: TurnstileDevice = { ...device, side: 'in' }
    const deps = fakeDeps({ presence: inside })      // sistem onu İÇERİDE sanıyor
    ;(deps.repo as unknown as { getDevice: () => Promise<TurnstileDevice> }).getDevice = async () => giris
    const r = await crossTurnstile(deps, CTX, { memberId: MEMBER, code: CODE, reportedDirection: null })
    expect(r.ok).toBe(false)
    // Giriş ekranı 'in' diyor, ama zaten içeride görünüyor → doğru cevap REDDETMEK, sessizce
    // "çıkış" yazmak değil. Üye çıkış ekranını okutmalı.
    if (!r.ok) expect(r.error.code).toBe('already_inside')
  })

  it('the exit screen records an exit even for a member presence has lost', async () => {
    const cikis: TurnstileDevice = { ...device, side: 'out' }
    const deps = fakeDeps({ presence: inside })
    ;(deps.repo as unknown as { getDevice: () => Promise<TurnstileDevice> }).getDevice = async () => cikis
    const r = await crossTurnstile(deps, CTX, { memberId: MEMBER, code: CODE, reportedDirection: null })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toBe('out')
  })

  it('a side is NOT a deliberate assertion — the double-scan guard still runs', async () => {
    // The distinction this rests on: reception pressing "Çıkış" is an act and waives the guard; a
    // screen bolted to a wall is a fact and does not. Conflating them is what disabled `side`.
    const cikis: TurnstileDevice = { ...device, side: 'out' }
    const deps = fakeDeps({ presence: inside, lastCrossedAt: NOW - 15_000 })
    ;(deps.repo as unknown as { getDevice: () => Promise<TurnstileDevice> }).getDevice = async () => cikis
    const r = await crossTurnstile(deps, CTX, { memberId: MEMBER, code: CODE, reportedDirection: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('checkin_too_soon')
  })

  it('a REFUSED crossing spends no code — the arm must not turn on a refusal', async () => {
    // The defect this replaced: the code was consumed BEFORE the check-in was decided, so a refusal
    // left a spent code behind. The device polls "was my code used?", saw yes, turned the arm and
    // said "Hoş geldin" — while the member's app said the code was invalid and nothing was recorded.
    // A door that opens with no record is how occupancy drifts where nobody is looking.
    const tuketilenler: string[] = []
    const r = await crossTurnstile(fakeDeps({ presence: inside, lastCrossedAt: NOW - 15_000, tuketilenler }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('checkin_too_soon')
    expect(tuketilenler).toHaveLength(0) // kod dokunulmadan duruyor, üye tekrar okutabilir
  })

  it('an ACCEPTED crossing does spend the code', async () => {
    const tuketilenler: string[] = []
    const r = await crossTurnstile(fakeDeps({ presence: null, tuketilenler }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: null,
    })
    expect(r.ok).toBe(true)
    expect(tuketilenler).toEqual([CODE])
  })

  it('an ARM-REPORTED direction still bypasses the guard, and should', async () => {
    // The exemption is not a bug — it exists for a direction that was genuinely asserted rather
    // than inferred. When the arm's direction wire is wired up it says what the door DID, and what
    // the door did is not a double press.
    const r = await crossTurnstile(fakeDeps({ presence: inside, lastCrossedAt: NOW - 5_000 }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: 'out',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toBe('out')
  })
})

describe('paketi olmayan üyeye kol dönmez (owner, 2026-08-31)', () => {
  // *"Paketi olmayan pasif sayılsın."* Kapı karar veremez, o yüzden kapı hayır der ve
  // resepsiyona yönlendirir.
  const paketsiz = { paketler: [] as unknown }

  it('GİRİŞTE reddeder', async () => {
    const r = await crossTurnstile(fakeDeps({ presence: null, ...paketsiz }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: 'in',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('no_active_membership')
  })

  it('ÇIKIŞTA reddetmez — içerideki birini içeride tutmak kural değil, arızadır', async () => {
    // Bu testin varlık sebebi: dersi sırasında paketi biten üye tam çıkarken kapıda kalırdı.
    const r = await crossTurnstile(fakeDeps({ presence: inside, lastCrossedAt: NOW - 60_000, ...paketsiz }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: 'out',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toBe('out')
  })

  it('reddedince KODU HARCAMAZ — üye paketini yeniletip aynı ekranı okutabilir', async () => {
    const tuketilenler: string[] = []
    const r = await crossTurnstile(fakeDeps({ presence: null, tuketilenler, ...paketsiz }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: 'in',
    })
    expect(r.ok).toBe(false)
    expect(tuketilenler).toEqual([])
  })

  it('İLERİ TARİHLİ paket bugün kapıyı açmaz', async () => {
    // Gamze'nin durumu: parası ödenmiş ama 7 Eylül'de başlayan paketler. `listActiveByMember`
    // yalnızca `status` bakar; pencereyi burada kontrol etmesek bugün geçerdi.
    const ileri = [
      { validFrom: instant(NOW + 7 * 86_400_000), validUntil: instant(NOW + 97 * 86_400_000), productSnapshot: {} },
    ] as never
    const r = await crossTurnstile(fakeDeps({ presence: null, paketler: ileri }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: 'in',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('no_active_membership')
  })

  it('SÜRESİ GEÇMİŞ paket de açmaz', async () => {
    const gecmis = [
      { validFrom: instant(NOW - 97 * 86_400_000), validUntil: instant(NOW - 86_400_000), productSnapshot: {} },
    ] as never
    const r = await crossTurnstile(fakeDeps({ presence: null, paketler: gecmis }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: 'in',
    })
    expect(r.ok).toBe(false)
  })
})
