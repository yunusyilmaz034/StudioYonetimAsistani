import {
  FirestoreStaffShiftRepository,
  STAFF_SHIFT_ENDED,
  newCorrelationId,
  type StaffShift,
  type StaffUserId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// BUSE HOCA'NIN 18 EYLÜL ÇIKIŞI — ELLE DÜZELTME (owner, 2026-09-18).
//
//   pnpm exec tsx tools/migration/buse-hoca-mesai-cikis-2026-09-18.ts            (kuru çalışma)
//   pnpm exec tsx tools/migration/buse-hoca-mesai-cikis-2026-09-18.ts --apply
//
// NE OLDU. Sabah 09:09'da turnikeden geçti, vardiyası açıldı. Akşam çıkışta kodu okuttuğunda panel
// *"Bu bir turnike kodu değil"* dedi ve geçiş HİÇ kaydedilmedi — reddin sunucuda izi bile yoktu
// (o sessizlik `actions/shift.ts`'te ayrıca düzeltildi). Gece 23:00 süpürgesi, kuralı gereği, açık
// vardiyayı SON GEÇİŞE kapattı: 09:09. Yani kayıt "bir dakika çalışmış" diyor.
//
// Owner: *"buse hocanın mesai kaydını elle düzelt, 21:08'de çıktı."*
//
// NEDEN BETİK. Üretim verisi elle düzenlenmez (CLAUDE.md): düzeltme de bir harekettir ve sebebiyle
// birlikte loga girer. Burada yazılan şey `staff.shift_ended` olayının YENİSİDİR — eski olay
// silinmez, çünkü o da olmuş bir şeydi (gece işi gerçekten öyle kapatmıştı). Log iki kaydı da
// taşır: sistemin gördüğü ve insanın düzelttiği.
//
// AKTÖR: `platform_admin` — `kendisi()` kuralı yalnızca platform yöneticisinin bir başkasının
// saatini yazmasına izin verir, ve bu betik tam olarak o istisnadır.

const STUDIO = 'retro'
const RUN = 'buse-hoca-mesai-cikis-2026-09-18'
const VARDIYA = 'shf_01M2SJ3YA5ZVNC9QZ8J0WJYHY0'
const PERSONEL = 'LLMbDiiR4LPA2K8UAdVJWjiDldF3' // Buse Hoca
// 21:08 TRT = 18:08 UTC. Owner'ın verdiği saat; turnike bunu göremedi çünkü kod hiç okunamadı.
const CIKIS = Date.parse('2026-09-18T18:08:00Z')

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: ['mutlukent'],
    role: 'platform_admin',
  } as unknown as TenantContext
  const repo = new FirestoreStaffShiftRepository(db)

  const snap = await db.doc(`studios/${STUDIO}/staffShifts/${VARDIYA}`).get()
  if (!snap.exists) return console.log(`${VARDIYA}: BULUNAMADI`)
  const d = snap.data() ?? {}
  const basladi = Number(d.startedAt?.toMillis?.() ?? 0)
  const bittiEski = Number(d.endedAt?.toMillis?.() ?? 0)
  const sonGecis = Number(d.lastCrossingAt?.toMillis?.() ?? 0)
  const saat = (ms: number) => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })

  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`personel : ${String(d.staffUserId)}`)
  console.log(`başlangıç: ${saat(basladi)}`)
  console.log(`bitiş    : ${saat(bittiEski)}  →  ${saat(CIKIS)}`)
  console.log(`süre     : ${Math.floor((bittiEski - basladi) / 60_000)} dk  →  ${Math.floor((CIKIS - basladi) / 60_000)} dk`)
  if (String(d.staffUserId) !== PERSONEL) return console.log('DURDU: vardiya başka bir personele ait')
  if (CIKIS <= basladi) return console.log('DURDU: çıkış saati başlangıçtan önce')
  if (!apply) return console.log('\nkuru çalışma — yazılmadı')

  const shift: StaffShift = {
    id: VARDIYA as StaffShift['id'],
    staffUserId: PERSONEL as StaffUserId,
    branchId: d.branchId,
    startedAt: basladi as StaffShift['startedAt'],
    endedAt: CIKIS as StaffShift['endedAt'],
    // Son geçiş olduğu gibi kalıyor: turnike o an gerçekten bir şey görmedi ve görmediğini
    // yazmak, görmüş gibi yazmaktan iyidir (#11).
    lastCrossingAt: (sonGecis || basladi) as StaffShift['lastCrossingAt'],
  } as StaffShift

  await repo.saveShift(ctx, shift, [
    {
      studioId: STUDIO,
      aggregate: 'staff',
      aggregateId: PERSONEL,
      actor: ctx.actor,
      source: 'migration',
      occurredAt: CIKIS,
      correlationId: newCorrelationId(),
      commandId: null,
      causationId: null,
      policyRef: null,
      related: { staffUserId: PERSONEL },
      branchId: d.branchId,
      type: STAFF_SHIFT_ENDED,
      version: 1,
      payload: {
        staffUserId: PERSONEL,
        shiftId: VARDIYA,
        minutes: Math.max(0, Math.floor((CIKIS - basladi) / 60_000)),
        reason: 'Turnike kodu okunamadığı için çıkış kaydedilemedi; owner beyanıyla 21:08 olarak düzeltildi.',
      },
    } as never,
  ])
  console.log('✅ vardiya 21:08 çıkışıyla düzeltildi')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
