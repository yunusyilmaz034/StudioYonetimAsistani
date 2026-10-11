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

// İLKİM İREM GENÇ — HİBRİT 2 AYLIK: 08.09 → 08.10 YERİNE 08.09 → 07.11 (owner, 2026-10-11)
//
//   pnpm tsx tools/migration/fix-ilkim-irem-genc-hibrit-sure-2026-10-11.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-ilkim-irem-genc-hibrit-sure-2026-10-11.ts --apply    # yaz
//
// Owner: *"bu üyeye hibrit 2 aylık verilmiş ama 1 ay süre eklenmiş, normalde 2 ay olması lazım."*
//
// Tanı (`tani-ilkim-irem-genc-2026-10-11.ts`): demet 31.08'de satıldığında iki bileşeni de 30 günlük
// kesilmiş (ürün o gün 30 gün veriyordu; bugün 60). Sayılar zaten iki aylık — 8 ders, 16 giriş —
// yanlış olan yalnızca süre. 08.10 03:00 taraması ikisini de kapattı ve kullanılmamış 4 dersi yaktı.
// Açık ya da ileriye dönük rezervasyon yok. Para doğru (10.000 ₺ nakit, bakiye 0) — dokunulmuyor.
//
// MASANIN YAPACAĞI ÜÇ İŞLEM, aynı use-case'lerle:
//   1) adjustCredits    — pilates: yanan 4 ders "Düzeltme" olarak geri (`restored` +4; `expired` kalır)
//   2) amendEntitlement — pilates: bitiş 07.11.2026 → canlanır
//   3) amendEntitlement — fitness: bitiş 07.11.2026 → canlanır; 16 girişin 8'i kullanılmış, DOKUNULMAZ
//      (owner: satıldığı gibi 16 kalsın — katalog sonradan 14'e indi)
//
// Sıra bilerek böyle: içi boş kredili paket canlanmaz (OR-52), önce dersler geri verilir. Her adım
// kendi durumuna bakar; arada ölürse betik kaldığı yerden devam eder.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-ilkim-irem-genc-hibrit-sure-2026-10-11'
const APPLY = process.argv.includes('--apply')

const VAKA = {
  memberId: 'mem_01KXN38TVZD51PFYVMZDB10J98' as MemberId,
  pilatesId: 'ent_01M1BX49K11XDFBFCA2BQ8QZ7M' as EntitlementId,
  fitnessId: 'ent_01M1BX49WE6PTJ74B6GARBE6AQ' as EntitlementId,
  baslangic: '2026-09-08',
  eskiBitis: '2026-10-08',
  yeniBitis: '2026-11-07',
  yananDers: 4,
} as const

const REASON =
  'Hibrit 2 Aylık demet 31.08 satışında 30 günlük kesilmişti; doğru süre 60 gün (08.09.2026 → 07.11.2026). ' +
  'Yanlış bitiş yüzünden 08.10 sabahı yanan 4 pilates dersi geri verildi; fitness girişleri (16) satıldığı ' +
  'gibi bırakıldı (owner talimatı, 2026-10-11).'

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

  const [pil, fit, paketler] = await Promise.all([
    repo.getEntitlement(ctx, VAKA.pilatesId),
    repo.getEntitlement(ctx, VAKA.fitnessId),
    repo.listByMember(ctx, VAKA.memberId),
  ])

  // ── KORUMALAR ──
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }
  if (!pil || !fit) return dur('paket yok.')
  if (pil.memberId !== VAKA.memberId || fit.memberId !== VAKA.memberId) dur('paket bu üyeye ait değil.')
  const k = pil.credits
  if (!k) return dur('pilates bileşeni kredili değil.')
  if (fit.credits) dur('fitness bileşeni süreli değil.')

  console.log('━━ İLKİM İREM GENÇ')
  for (const e of [pil, fit])
    console.log(`   ${e.productSnapshot.category} · ${e.status} · ${gun(e.validFrom as number)} → ${gun(e.validUntil as number)} · ${e.credits ? `krediler ${JSON.stringify(e.credits)} → kalan ${available(e.credits)}` : `giriş ${e.entryLedger.consumed}/${e.productSnapshot.entryAllowance}`}`)

  const tamam = (e: typeof pil): boolean => e.status === 'active' && (e.validUntil as number) === dayMs(VAKA.yeniBitis)
  if (tamam(pil) && tamam(fit)) { console.log('\nDUR: zaten düzeltilmiş.'); return }
  for (const e of [pil, fit]) {
    if (tamam(e)) continue
    if (e.status !== 'expired') dur(`${e.productSnapshot.category}: beklenmeyen durum ${e.status}`)
    if ((e.validFrom as number) !== dayMs(VAKA.baslangic) || (e.validUntil as number) !== dayMs(VAKA.eskiBitis))
      dur(`${e.productSnapshot.category}: tarihler tanıdakinden farklı — arada biri dokunmuş.`)
  }
  if (k.granted !== 8 || k.consumed !== 4 || k.expired !== VAKA.yananDers || k.held !== 0 || k.revoked !== 0)
    dur('pilates kredi sayaçları tanıdakinden farklı.')
  if (k.restored !== 0 && k.restored !== VAKA.yananDers) dur(`beklenmeyen iade sayısı: ${k.restored}`)
  if (fit.productSnapshot.entryAllowance !== 16 || fit.entryLedger.consumed !== 8 || fit.entryLedger.restored !== 0)
    dur('fitness giriş sayaçları tanıdakinden farklı.')
  const digerCanli = paketler.filter((e) => e.id !== pil.id && e.id !== fit.id && e.status === 'active')
  if (digerCanli.length > 0) dur(`üyenin başka aktif paketi var (${digerCanli.map((e) => e.productSnapshot.name).join(', ')}) — durum değişmiş.`)

  const geriVerilecek = k.restored === 0
  console.log(`\n   HEDEF: ${gun(dayMs(VAKA.baslangic))} → ${gun(dayMs(VAKA.yeniBitis))} · aktif · pilates kalan ${VAKA.yananDers} · fitness kalan 8/16`)

  if (!APPLY) {
    console.log('\n── KURU ÇALIŞMA ── sırayla uygulanacak:')
    console.log(`   1) pilates +${VAKA.yananDers} ders (Düzeltme)${geriVerilecek ? '' : ' — ZATEN VERİLMİŞ, atlanır'}`)
    console.log(`   2) pilates bitiş → ${VAKA.yeniBitis}${tamam(pil) ? ' — ZATEN, atlanır' : ' (canlanır)'}`)
    console.log(`   3) fitness bitiş → ${VAKA.yeniBitis}${tamam(fit) ? ' — ZATEN, atlanır' : ' (canlanır)'}`)
    console.log(`\n   sebep: ${REASON}\n\n   --apply ile çalıştır.`)
    return
  }

  console.log('\n── UYGULANIYOR ──')
  if (geriVerilecek) {
    const r = await adjustCredits(deps, ctx, { entitlementId: pil.id, delta: VAKA.yananDers, reason: 'correction', note: REASON })
    if (!r.ok) dur(`1) KREDİ İADESİ BAŞARISIZ: ${JSON.stringify(r.error)}`)
    console.log(`   1) ✓ ${VAKA.yananDers} ders geri verildi`)
  } else console.log('   1) – dersler zaten geri verilmiş')

  for (const [n, e] of [[2, pil], [3, fit]] as const) {
    if (tamam(e)) { console.log(`   ${n}) – ${e.productSnapshot.category} zaten taşınmış`); continue }
    const r = await amendEntitlement(deps, ctx, { entitlementId: e.id, patch: { validUntil: instant(dayMs(VAKA.yeniBitis)) }, reason: REASON })
    if (!r.ok) dur(`${n}) ${e.productSnapshot.category} TARİH DÜZELTMESİ BAŞARISIZ: ${JSON.stringify(r.error)} — betiği yeniden çalıştır.`)
    console.log(`   ${n}) ✓ ${e.productSnapshot.category} bitişi taşındı, canlandı`)
  }

  console.log('\n✅ UYGULANDI')
  for (const id of [VAKA.pilatesId, VAKA.fitnessId]) {
    const e = (await repo.getEntitlement(ctx, id))!
    console.log(`   ${e.productSnapshot.category} · ${e.status} · ${gun(e.validFrom as number)} → ${gun(e.validUntil as number)} · ${e.credits ? `kalan ${available(e.credits)} ders` : `giriş ${e.entryLedger.consumed}/${e.productSnapshot.entryAllowance}`}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
