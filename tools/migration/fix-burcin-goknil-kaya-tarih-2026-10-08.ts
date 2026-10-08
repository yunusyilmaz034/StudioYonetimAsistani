import {
  adjustCredits,
  amendEntitlement,
  available,
  FirestoreEntitlementRepository,
  instant,
  systemClock,
  type EntitlementId,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// BURÇİN GÖKNİL KAYA — REFORMER 8 DERS: 08.09 → 08.10 YERİNE 15.09 → 15.10 (owner, 2026-10-08)
//
//   pnpm tsx tools/migration/fix-burcin-goknil-kaya-tarih-2026-10-08.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-burcin-goknil-kaya-tarih-2026-10-08.ts --apply    # yaz
//
// Owner: *"paketi 8'de başlamış ama paket tarihini 15'ten başlat, bitişi de diğer ayın 15'i olarak
// düzelt."*
//
// Tanı (`tani-burcin-goknil-kaya-2026-10-08.ts`): paket 08.09'da satılmış ve o gün başlatılmış, ama
// üyenin önceki 8'liği 13.09'a kadar sürüyordu — bu paketle girdiği ilk ders 15.09. Yani başlangıç
// bir hafta erken yazılmış. Bedeli bu sabah ödendi: 08.10 03:00 taraması paketi kapattı ve
// kullanılmamış 3 dersi yaktı.
//
// MASANIN YAPACAĞI İKİ İŞLEM, aynı use-case'lerle — elle veri yazımı yok:
//   1) adjustCredits    — yanan 3 ders "Düzeltme" olarak geri verilir (`restored` +3; `expired`
//                         sayacına DOKUNULMAZ — yandığı da, geri verildiği de defterde kalır)
//   2) amendEntitlement — 15.09.2026 → 15.10.2026; bitiş geleceğe geçtiği ve içinde ders olduğu
//                         için paket canlanır (`entitlement.amended` + `entitlement.reactivated`)
//
// Sıra bilerek böyle. Önce tarih taşınsaydı domain reddederdi (içi boş paket canlanmaz); arada
// ölürse elde "süresi dolmuş, 3 dersi geri verilmiş" bir paket kalır — görünür, zararsız, ve betik
// kaldığı yerden devam eder.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-burcin-goknil-kaya-tarih-2026-10-08'
const APPLY = process.argv.includes('--apply')

const VAKA = {
  memberId: 'mem_01KZRPWV6ZHAE5EE83AS43FEFJ' as MemberId,
  entitlementId: 'ent_01M20Z5MMGG9S819HJTFHH73KN' as EntitlementId,
  eskiBaslangic: '2026-09-08',
  eskiBitis: '2026-10-08',
  yeniBaslangic: '2026-09-15',
  yeniBitis: '2026-10-15',
  yananDers: 3,
} as const

const REASON =
  'Paket başlangıcı bir hafta erken girilmişti (08.09); üyenin önceki paketi 13.09\'a kadar sürdü ve bu ' +
  'paketle ilk dersi 15.09\'da. Doğru dönem 15.09.2026 → 15.10.2026. Yanlış bitiş yüzünden 08.10 sabahı ' +
  'yanan 3 ders geri verildi (owner talimatı, 2026-10-08).'

const dayMs = (iso: string): number => Date.parse(`${iso}T00:00:00+03:00`)
const gun = (ms: number): string => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: [BRANCH],
    correlationId: RUN,
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const repo = new FirestoreEntitlementRepository(db)
  const deps = { repo, clock: systemClock }

  const [ent, paketler] = await Promise.all([
    repo.getEntitlement(ctx, VAKA.entitlementId),
    repo.listByMember(ctx, VAKA.memberId),
  ])

  // ── KORUMALAR ──
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }
  if (!ent) return dur('paket yok.')
  if (ent.memberId !== VAKA.memberId) dur('paket bu üyeye ait değil.')
  const k = ent.credits
  if (!k) return dur('kredili paket değil.')

  console.log('━━ BURÇİN GÖKNİL KAYA')
  console.log(`   ${ent.productSnapshot.name} · ${ent.status} · ${gun(ent.validFrom as number)} → ${gun(ent.validUntil as number)}`)
  console.log(`   krediler: ${JSON.stringify(k)} → kalan ${available(k)}`)

  const hedefte = (ent.validFrom as number) === dayMs(VAKA.yeniBaslangic) && (ent.validUntil as number) === dayMs(VAKA.yeniBitis)
  if (hedefte && ent.status === 'active') { console.log('\nDUR: zaten düzeltilmiş.'); return }
  if (ent.status !== 'expired') dur(`paket beklenmeyen durumda: ${ent.status}`)
  if (!hedefte && ((ent.validFrom as number) !== dayMs(VAKA.eskiBaslangic) || (ent.validUntil as number) !== dayMs(VAKA.eskiBitis)))
    dur('tarihler tanıdakinden farklı — arada biri dokunmuş.')
  if (k.granted !== 8 || k.consumed !== 5 || k.expired !== VAKA.yananDers || k.held !== 0 || k.revoked !== 0)
    dur('kredi sayaçları tanıdakinden farklı.')
  if (k.restored !== 0 && k.restored !== VAKA.yananDers) dur(`beklenmeyen iade sayısı: ${k.restored}`)
  const digerCanli = paketler.filter((e) => e.id !== ent.id && e.status === 'active')
  if (digerCanli.length > 0) dur(`üyenin başka aktif paketi var (${digerCanli.map((e) => e.productSnapshot.name).join(', ')}) — durum değişmiş.`)

  const geriVerilecek = k.restored === 0
  console.log(`\n   HEDEF: ${gun(dayMs(VAKA.yeniBaslangic))} → ${gun(dayMs(VAKA.yeniBitis))} · aktif · kalan ${VAKA.yananDers} ders`)

  if (!APPLY) {
    console.log('\n── KURU ÇALIŞMA ── sırayla uygulanacak:')
    console.log(`   1) +${VAKA.yananDers} ders (Düzeltme)${geriVerilecek ? '' : ' — ZATEN VERİLMİŞ, atlanır'}`)
    console.log(`   2) tarih: ${VAKA.yeniBaslangic} → ${VAKA.yeniBitis} (paket canlanır)`)
    console.log(`\n   sebep: ${REASON}\n\n   --apply ile çalıştır.`)
    return
  }

  console.log('\n── UYGULANIYOR ──')
  if (geriVerilecek) {
    const r = await adjustCredits(deps, ctx, { entitlementId: ent.id, delta: VAKA.yananDers, reason: 'correction', note: REASON })
    if (!r.ok) dur(`1) KREDİ İADESİ BAŞARISIZ: ${JSON.stringify(r.error)}`)
    console.log(`   1) ✓ ${VAKA.yananDers} ders geri verildi`)
  } else console.log('   1) – dersler zaten geri verilmiş')

  const r = await amendEntitlement(deps, ctx, {
    entitlementId: ent.id,
    patch: { validFrom: instant(dayMs(VAKA.yeniBaslangic)), validUntil: instant(dayMs(VAKA.yeniBitis)) },
    reason: REASON,
  })
  if (!r.ok) dur(`2) TARİH DÜZELTMESİ BAŞARISIZ: ${JSON.stringify(r.error)} — dersler geri verildi ama paket hâlâ süresi dolmuş. Betiği yeniden çalıştır.`)
  console.log('   2) ✓ tarih taşındı, paket canlandı')

  const son = await repo.getEntitlement(ctx, VAKA.entitlementId)
  console.log('\n✅ UYGULANDI')
  console.log(`   ${son!.productSnapshot.name} · ${son!.status} · ${gun(son!.validFrom as number)} → ${gun(son!.validUntil as number)} · kalan ${available(son!.credits!)} ders`)
}

main().catch((e) => { console.error(e); process.exit(1) })
