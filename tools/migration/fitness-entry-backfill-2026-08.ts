import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import {
  FirestoreEntitlementRepository,
  decideConsumeEntry,
  entriesUsed,
  instant,
  newCorrelationId,
  type TenantContext,
} from '@studio/core'

// KAÇMIŞ FITNESS GİRİŞLERİNİ DÜŞ (owner onayı, 2026-08-26).
//
//   pnpm tsx tools/migration/fitness-entry-backfill-2026-08.ts            (kuru çalışma)
//   pnpm tsx tools/migration/fitness-entry-backfill-2026-08.ts --apply
//
// WHY. Fitness serbest-giriş sayacını hareket ettiren kod `qr.ts` içinde yaşıyordu ve elle yapılan
// check-in onu hiç çağırmıyordu. QR okutan üyelerin sayacı doğru işledi; RESEPSİYONUN elle
// işaretlediği üyeninki hiç işlemedi. Işıl kâğıt föyle ekranı karşılaştırınca buldu.
//
// Kod düzeltildi (tüketim artık `recordCheckIn` içinde, her kapı oradan geçiyor). Bu script yalnızca
// GEÇMİŞİ onarıyor.
//
// NASIL. Uydurma bir sayı yazmıyoruz: kaçmış her giriş için GERÇEK check-in kaydını buluyoruz ve
// `decideConsumeEntry`'yi o `checkInId` ile çalıştırıyoruz. Yani üretilen olaylar, o gün doğru
// çalışsaydı ne yazılacak idiyse onunla birebir aynı — ve her düzeltme hangi ziyarete ait olduğunu
// söyleyebiliyor.
//
// AKTÖR. Script kendi kimliğiyle yazıyor (#5): bir düzeltmenin altında resepsiyonistin adı olmaz.

const STUDIO = 'retro'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const repo = new FirestoreEntitlementRepository(db)

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  const ctx = {
    studioId: STUDIO,
    branchIds: [],
    role: 'owner',
    actor: { type: 'system', id: 'sys_entry_backfill_2026_08' },
  } as unknown as TenantContext

  const ms = (v: unknown): number =>
    typeof v === 'number' ? v : ((v as { toMillis?: () => number })?.toMillis?.() ?? 0)

  const ents = await db.collection(`studios/${STUDIO}/entitlements`).where('status', '==', 'active').get()
  let toplam = 0

  for (const doc of ents.docs) {
    const v = doc.data()
    if (v.productSnapshot?.category !== 'fitness' || v.productSnapshot?.entryAllowance == null) continue

    // Sınırsız fitness erişimi olan üyenin sayacı hiç işlemez — onu düzeltmeye kalkmak, olmayan bir
    // borcu yazmak olur.
    const hepsi = await db
      .collection(`studios/${STUDIO}/entitlements`)
      .where('memberId', '==', v.memberId)
      .where('status', '==', 'active')
      .get()
    const sinirsizVar = hepsi.docs.some(
      (x) => x.data().productSnapshot?.category === 'fitness' && x.data().productSnapshot?.entryAllowance == null,
    )
    if (sinirsizVar) continue

    const uye = (await db.doc(`studios/${STUDIO}/members/${v.memberId}`).get()).data()
    const ad = String(uye?.fullName ?? v.memberId)

    const ci = await db.collection(`studios/${STUDIO}/checkIns`).where('memberId', '==', v.memberId).get()
    const girisler = ci.docs
      .filter((c) => c.data().direction === 'in' && ms(c.data().occurredAt) >= ms(v.validFrom))
      .sort((a, b) => ms(a.data().occurredAt) - ms(b.data().occurredAt))

    const dusen = (v.entryLedger?.consumed ?? 0) - (v.entryLedger?.restored ?? 0)
    const eksik = girisler.length - dusen
    if (eksik <= 0) continue

    // Zaten düşmüş olanlar en eskiler; onarılacaklar sondakiler.
    const onarilacak = girisler.slice(dusen)
    console.log(`${ad}  izin:${v.productSnapshot.entryAllowance}  düşen:${dusen}  giriş:${girisler.length}  → ${eksik} düzeltme`)
    for (const g of onarilacak) {
      console.log(`   ${new Date(ms(g.data().occurredAt)).toISOString().slice(0, 16)}  ${g.data().method}  (${g.id})`)
    }
    toplam += eksik

    if (!apply) continue

    // Sırayla, çünkü her adım bir öncekinin defterini okuyor.
    let ent = await repo.getEntitlement(ctx, doc.id as never)
    for (const g of onarilacak) {
      if (!ent) break
      const decided = decideConsumeEntry(
        {
          studioId: ctx.studioId,
          actor: ctx.actor,
          now: instant(ms(g.data().occurredAt)), // ziyaretin KENDİ zamanı, bugünün değil
          correlationId: newCorrelationId(),
          source: 'migration',
          commandId: null,
        },
        ent,
        g.id,
      )
      if (!decided.ok) {
        console.log(`   ✗ ${g.id}: ${decided.error.code}`)
        break
      }
      await repo.saveEntitlement(ctx, decided.value.next, decided.value.events)
      ent = decided.value.next
      console.log(`   ✓ düşüldü → toplam ${entriesUsed(ent.entryLedger)}`)
    }
  }

  console.log(`\n${toplam === 0 ? 'Düzeltilecek bir şey yok.' : `Toplam ${toplam} giriş.`}`)
  if (!apply && toplam > 0) console.log('Uygulamak için --apply')
  process.exit(0)
}

void main()
