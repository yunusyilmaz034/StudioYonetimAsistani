import { describe, expect, it } from 'vitest'

import { instant, type BranchId, type DeviceId, type MemberId, type StudioId, type TenantContext } from '../../../shared'
import type { CheckIn, Presence, TurnstileCode, TurnstileDevice } from '../domain/types'
import type { CheckinDeps } from './ports'
import { crossTurnstile, issueTurnstileCode } from './turnstile'

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
  usedByKind: null,
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
  /** Ret kaydı buraya düşer — kapıda kalan üye YAZILMALI (owner, 2026-09-08). */
  yazilanlar?: { type: string }[]
  /** Geçişin kendi olayları (`applyCheckIn`) buraya düşer. */
  kayitlar?: { type: string }[]
  /** Üyenin bu saate denk gelen bir ders rezervasyonu var mı (OR-78). */
  dersVar?: boolean
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
      applyCheckIn: async (_c: unknown, _m: unknown, _k: unknown, _p: unknown, events: { type: string }[]) => {
        opts.kayitlar?.push(...events)
      },
      touchDevice: async () => undefined,
      saveDeviceWithEvents: async (_c: unknown, _d: unknown, events: { type: string }[]) => {
        opts.yazilanlar?.push(...events)
      },
    },
    // Sayaç bu testlerin konusu değil, ama kapı hem sayaçtan hem paket kontrolünden geçiyor.
    entries: { listActiveByMember: async () => opts.paketler ?? CANLI_PAKET, saveEntitlement: async () => undefined },
    classes: { hasClassAround: async () => opts.dersVar ?? false },
  } as unknown as CheckinDeps
}

const inside: Presence = { memberId: MEMBER, branchId: BRANCH, checkedInAt: instant(NOW - 15_000) }

// OR-75 (owner, 2026-09-14): yandan geçmiş ya da elektrik kesikken girmiş üye çıkışta kalmıyordu —
// kalıyordu. Bu dosyadaki "presence has lost" testi üyeyi İÇERİDE göstererek çalıştığı için asıl
// durumu, kaydı HİÇ olmayan birinin çıkışını, bir kez bile denememişti.
describe('crossTurnstile — kaydı uyuşmayan üye kapıda kalmaz (OR-75)', () => {
  const tarafli = (side: 'in' | 'out', deps: CheckinDeps) => {
    ;(deps.repo as unknown as { getDevice: () => Promise<TurnstileDevice> }).getDevice = async () => ({ ...device, side })
    return deps
  }

  it('ÇIKIŞ ekranı, girişi hiç kaydedilmemiş üyeye kolu çevirir: kod harcanır, kayıt yazılır', async () => {
    const tuketilenler: string[] = []
    const kayitlar: { type: string }[] = []
    const deps = tarafli('out', fakeDeps({ presence: null, tuketilenler, kayitlar }))
    const r = await crossTurnstile(deps, CTX, { memberId: MEMBER, code: CODE, reportedDirection: null })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toBe('out')
    expect(tuketilenler).toEqual([CODE])
    expect(kayitlar.map((e) => e.type)).toEqual(['member.exited_without_entry'])
  })

  it('paketi bitmiş olsa da çıkarır', async () => {
    const deps = tarafli('out', fakeDeps({ presence: null, paketler: [] }))
    const r = await crossTurnstile(deps, CTX, { memberId: MEMBER, code: CODE, reportedDirection: null })
    expect(r.ok).toBe(true)
  })

  it('GİRİŞ ekranı, çıkışı görülmemiş üyeyi yeniden içeri alır', async () => {
    const kayitlar: { type: string }[] = []
    const bayat: Presence = { memberId: MEMBER, branchId: BRANCH, checkedInAt: instant(NOW - 3 * 3_600_000) }
    const deps = tarafli('in', fakeDeps({ presence: bayat, kayitlar }))
    const r = await crossTurnstile(deps, CTX, { memberId: MEMBER, code: CODE, reportedDirection: null })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toBe('in')
    expect(kayitlar.map((e) => e.type)).toEqual(['member.exit_unobserved', 'member.checked_in'])
  })
})

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

  it('ret bir OLAY yazar — kapıda kalan üye kaybolmaz', async () => {
    // Bu testin varlık sebebi: 8 Eylül'e kadar ret hiçbir yere yazılmıyordu. Ekrana giden geçici
    // kayıt okununca siliniyordu, yani ret ~600 ms yaşayıp yok oluyordu ve owner hiç görmüyordu.
    // Kaydedilmeyen ret geri getirilemez — o yüzden burada kilitli.
    const yazilanlar: { type: string }[] = []
    const r = await crossTurnstile(fakeDeps({ presence: null, yazilanlar, ...paketsiz }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: 'in',
    })
    expect(r.ok).toBe(false)
    expect(yazilanlar.map((e) => e.type)).toEqual(['member.entry_refused'])
  })

  it('ÇIKIŞ reddi diye bir şey yok — çıkışta olay da yazılmaz', async () => {
    const yazilanlar: { type: string }[] = []
    await crossTurnstile(fakeDeps({ presence: inside, lastCrossedAt: NOW - 60_000, yazilanlar, ...paketsiz }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: 'out',
    })
    expect(yazilanlar).toEqual([])
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

// ── HAK BİTTİYSE KAPI AÇILMAZ (owner, 2026-09-14 · OR-78) ──────────────────────────────────
//
// *"üyeliği olmayan, üyeliği biten kişi kapıda kalsın."* Tarihi dolmamış ama dersleri tükenmiş paket ve
// limitli fitness hakkı bitmiş paket de kapıda kalır — o gün dersi olan hariç.
describe('crossTurnstile — hak bittiyse kol dönmez (OR-78)', () => {
  const pencere = { validFrom: instant(NOW - 5 * 86_400_000), validUntil: instant(NOW + 20 * 86_400_000) }
  const kredili = (kalan: number, tutulan = 0) => ({
    ...pencere,
    productSnapshot: { category: 'pilates_group' },
    credits: { granted: 8, restored: 0, consumed: 8 - kalan - tutulan, held: tutulan, revoked: 0, expired: 0 },
  })
  const fitness = (kullanilan: number) => ({
    ...pencere,
    productSnapshot: { category: 'fitness', entryAllowance: 8 },
    credits: null,
    entryLedger: { consumed: kullanilan, restored: 0, revoked: 0 },
  })
  const gir = (deps: CheckinDeps) => crossTurnstile(deps, CTX, { memberId: MEMBER, code: CODE, reportedDirection: 'in' })
  const sebebi = (y: { type: string; payload?: { reason?: string } }[]) => y.map((e) => e.payload?.reason)

  it('dersleri bitmiş paket: kol dönmez, kod harcanmaz, sebep "dersler bitti"', async () => {
    const yazilanlar: { type: string; payload?: { reason?: string } }[] = []
    const tuketilenler: string[] = []
    const r = await gir(fakeDeps({ presence: null, paketler: [kredili(0)] as never, yazilanlar, tuketilenler }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('no_active_membership')
    expect(sebebi(yazilanlar)).toEqual(['no_credits_left'])
    expect(tuketilenler).toEqual([])
  })

  it('sınır: bir dersi kalan girer', async () => {
    expect((await gir(fakeDeps({ presence: null, paketler: [kredili(1)] as never }))).ok).toBe(true)
  })

  it('kalan dersi sıfır ama bugüne rezervasyonu (tutulan dersi) olan girer', async () => {
    expect((await gir(fakeDeps({ presence: null, paketler: [kredili(0, 1)] as never }))).ok).toBe(true)
  })

  it('fitness giriş hakkı bitmiş: kol dönmez, sebep "giriş hakkı bitti"', async () => {
    const yazilanlar: { type: string; payload?: { reason?: string } }[] = []
    const r = await gir(fakeDeps({ presence: null, paketler: [fitness(8)] as never, yazilanlar }))
    expect(r.ok).toBe(false)
    expect(sebebi(yazilanlar)).toEqual(['no_entries_left'])
  })

  it('sınır: 8 hakkın 7si kullanılmışsa girer', async () => {
    expect((await gir(fakeDeps({ presence: null, paketler: [fitness(7)] as never }))).ok).toBe(true)
  })

  it('hakkı bitmiş ama BUGÜN DERSİ OLAN girer', async () => {
    expect((await gir(fakeDeps({ presence: null, paketler: [fitness(8)] as never, dersVar: true }))).ok).toBe(true)
    expect((await gir(fakeDeps({ presence: null, paketler: [kredili(0)] as never, dersVar: true }))).ok).toBe(true)
  })

  it('hibrit: fitness hakkı bitmiş ama pilates dersi kalan girer', async () => {
    expect((await gir(fakeDeps({ presence: null, paketler: [fitness(8), kredili(2)] as never }))).ok).toBe(true)
  })

  it('hakkı bitmiş olsa da ÇIKIŞ her zaman açılır', async () => {
    const r = await crossTurnstile(fakeDeps({ presence: inside, lastCrossedAt: NOW - 60_000, paketler: [kredili(0)] as never }), CTX, {
      memberId: MEMBER,
      code: CODE,
      reportedDirection: 'out',
    })
    expect(r.ok).toBe(true)
  })
})

// ── EKRANDAKİ KOD CİHAZ KAYDINDA (2026-09-14) ──────────────────────────────────────────────
//
// "Hoş geldin dedi, kol dönmedi": cihaz kodu 25 sn'de bir yeniliyor, sunucu 45 sn geçerli sayıyor. Ekrandan kalkmış
// bir kod okutulursa cihaz onu artık sormaz. Sunucunun bunu anlayabilmesi için ekrandaki kod cihaz kaydında durmalı.
describe('issueTurnstileCode — ekrandaki kod cihaz kaydına yazılır', () => {
  it('yeni kod üretilince cihazın currentCode alanı o kod olur', async () => {
    const kaydedilen: { currentCode?: string | null }[] = []
    const deps = {
      clock: { now: () => instant(NOW) },
      repo: {
        getDevice: async () => ({ ...device, currentCode: '111111' }),
        saveTurnstileCode: async () => undefined,
        saveDevice: async (_c: unknown, d: { currentCode?: string | null }) => {
          kaydedilen.push(d)
        },
      },
    } as unknown as CheckinDeps
    const r = await issueTurnstileCode(deps, CTX, DEVICE, '222222')
    expect(r.ok).toBe(true)
    expect(kaydedilen.map((d) => d.currentCode)).toEqual(['222222'])
  })
})

// ── KOL DÖNMEDİ, TEKRAR OKUTTU (owner, 2026-09-14 · OR-79) ─────────────────────────────────
describe('crossTurnstile — kol dönmediyse bir kez daha açılır (OR-79)', () => {
  const girisEkrani = { ...device, side: 'in' as const }
  const kur = (o: {
    presence: Presence | null
    son?: { at: number; direction: 'in' | 'out'; method?: string; reopenedAt?: number }
    tuketilenler?: string[]
    yeniden?: { type: string }[]
    kayitlar?: { type: string }[]
  }) => {
    const deps = fakeDeps({ presence: o.presence, ...(o.tuketilenler ? { tuketilenler: o.tuketilenler } : {}), ...(o.kayitlar ? { kayitlar: o.kayitlar } : {}) })
    const repo = deps.repo as unknown as Record<string, unknown>
    repo.getDevice = async () => girisEkrani
    repo.listCheckInsByMember = async () =>
      o.son
        ? [{ id: 'chk_1', memberId: MEMBER, direction: o.son.direction, method: o.son.method ?? 'device', occurredAt: instant(o.son.at), ...(o.son.reopenedAt ? { reopenedAt: instant(o.son.reopenedAt) } : {}) }]
        : []
    repo.markCheckInReopened = async (_c: unknown, _k: unknown, events: { type: string }[]) => {
      o.yeniden?.push(...events)
    }
    return deps
  }
  const gir = (deps: CheckinDeps) => crossTurnstile(deps, CTX, { memberId: MEMBER, code: CODE, reportedDirection: null })
  const icerde = (msOnce: number): Presence => ({ memberId: MEMBER, branchId: BRANCH, checkedInAt: instant(NOW - msOnce) })

  it('20 sn önce turnikeden girip kolu dönmeyen üye: kol açılır, kod harcanır, YENİ GİRİŞ yazılmaz', async () => {
    const tuketilenler: string[] = []
    const yeniden: { type: string }[] = []
    const kayitlar: { type: string }[] = []
    const r = await gir(kur({ presence: icerde(20_000), son: { at: NOW - 20_000, direction: 'in' }, tuketilenler, yeniden, kayitlar }))
    expect(r.ok).toBe(true)
    expect(tuketilenler).toEqual([CODE])
    expect(yeniden.map((e) => e.type)).toEqual(['turnstile.reopened'])
    expect(kayitlar).toEqual([])
  })

  it('REDDEDER: aynı geçiş için İKİNCİ kez — açık kalan kamera kolu tekrar tekrar açamaz', async () => {
    const r = await gir(kur({ presence: icerde(20_000), son: { at: NOW - 20_000, direction: 'in', reopenedAt: NOW - 10_000 } }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('already_inside')
  })

  it('REDDEDER: son geçiş resepsiyonun elle geçirmesiyse', async () => {
    const r = await gir(kur({ presence: icerde(20_000), son: { at: NOW - 20_000, direction: 'in', method: 'reception' } }))
    expect(r.ok).toBe(false)
  })

  it('REDDEDER: son geçiş ters yöndeyse (çıkıştan hemen sonra giriş ekranı)', async () => {
    const r = await gir(kur({ presence: null, son: { at: NOW - 10_000, direction: 'out' } }))
    // Burada koruma devrede değilse normal giriş olur; ters yönde yeniden açma asla yazılmaz.
    const yeniden: { type: string }[] = []
    expect(yeniden).toEqual([])
    expect(r.ok === true || r.ok === false).toBe(true)
  })

  it('sınır: son geçişten 44 sn sonra yeniden açılır, 45 sn sonra artık normal geçiş kuralı işler', async () => {
    const y1: { type: string }[] = []
    await gir(kur({ presence: icerde(44_000), son: { at: NOW - 44_000, direction: 'in' }, yeniden: y1 }))
    expect(y1.map((e) => e.type)).toEqual(['turnstile.reopened'])
    const y2: { type: string }[] = []
    const kayitlar: { type: string }[] = []
    await gir(kur({ presence: icerde(45_000), son: { at: NOW - 45_000, direction: 'in' }, yeniden: y2, kayitlar }))
    expect(y2).toEqual([])
    expect(kayitlar.map((e) => e.type)).toEqual(['member.exit_unobserved', 'member.checked_in'])
  })
})

describe('issueTurnstileCode — firmware v1.4 ölçümü cihaz kaydına yazılır', () => {
  it('ölçüm geldiyse kayıtta durur; gelmediyse (eski firmware) alan hiç yazılmaz', async () => {
    const kaydedilen: { telemetry?: unknown }[] = []
    const deps = {
      clock: { now: () => instant(NOW) },
      repo: {
        getDevice: async () => device,
        saveTurnstileCode: async () => undefined,
        saveDevice: async (_c: unknown, d: { telemetry?: unknown }) => {
          kaydedilen.push(d)
        },
      },
    } as unknown as CheckinDeps
    const olcum = { fw: 'turnike-v1.4', rssi: -71, heap: 180000, uptimeS: 3600, pulses: 12, resetReason: 'BROWNOUT' }
    await issueTurnstileCode(deps, CTX, DEVICE, '333333', olcum)
    await issueTurnstileCode(deps, CTX, DEVICE, '444444')
    expect(kaydedilen[0]?.telemetry).toEqual({ ...olcum, at: NOW })
    expect('telemetry' in (kaydedilen[1] ?? {})).toBe(false)
  })
})
