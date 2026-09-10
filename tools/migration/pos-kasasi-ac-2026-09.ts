import { FirestoreFinanceRepository, createDrawer, money, openDrawer, systemClock, type BranchId, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// POS KASASI AÇILIYOR (owner kararı, 2026-09-11: "pos kasası aç").
//
//   pnpm tsx tools/migration/pos-kasasi-ac-2026-09.ts
//   pnpm tsx tools/migration/pos-kasasi-ac-2026-09.ts --apply
//
// ── NEDEN ───────────────────────────────────────────────────────────────────────────────────
//
// Stüdyoda tanımlı bir POS kasası yoktu, dolayısıyla kartla giren hiçbir para bir kasaya
// düşmüyordu. 10 Eylül'de cüzdana yapılan fiziksel POS yüklemesi düzeltildi ve artık kasaya
// işlenmeye ÇALIŞIYOR — ama düşecek kasa olmadığı için hâlâ hiçbir yere düşmüyor. Bu betik o
// eksik yarıyı kapatıyor.
//
// ── GÜN SONU ELLE İŞ ÇIKARMIYOR ─────────────────────────────────────────────────────────────
//
// `drawer-cycle` türden bağımsız çalışıyor: 23:00'te açık her kasayı kapatıyor, 09:00'da kapalı
// her AKTİF kasayı sıfır açılışla açıyor ([[OR-68]]). POS kasası da bu döngüye kendiliğinden
// giriyor. Kapanış notu her seferinde SAYIM YAPILMADIĞINI yazıyor — otomatik bir kapanış hiçbir
// çekmeceyi sayamaz ve sıfır fark bir denklik değil, sayılmamışlıktır.
//
// ── AÇILIŞ BAKİYESİ SIFIR ───────────────────────────────────────────────────────────────────
//
// POS kasasında "çekmecede duran para" diye bir şey yok: kart parası bankaya gider. Kasa burada
// bir SAYAÇ — gün içinde karttan ne çekildiğini gösteriyor, bir çekmecenin içindekini değil.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const APPLY = process.argv.includes('--apply')
const AD = 'POS Kasası'
// Kimlik SABİT ve okunabilir: betik ikinci kez çalışırsa aynı belgeye denk gelir, ve `createDrawer`
// var olanı görüp reddeder. Rastgele bir kimlik, her çalıştırmada yeni bir kasa demekti.
const ID = 'drw_pos_retro'

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: 'migration:pos-kasasi-ac-2026-09' },
    branchIds: [BRANCH],
    correlationId: 'pos-kasasi-ac-2026-09',
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const fin = { repo: new FirestoreFinanceRepository(db), clock: systemClock }

  const mevcut = await fin.repo.listDrawers(ctx)
  console.log(APPLY ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA ──\n')
  console.log('  mevcut kasalar:')
  for (const d of mevcut) console.log(`    ${d.name} · ${d.kind} · ${d.status}`)

  // İKİNCİ KEZ ÇALIŞTIRILIRSA İKİNCİ KASA AÇMAZ. İki POS kasası, "kartla ne çektik" sorusunun
  // iki cevabı demektir.
  const varOlan = mevcut.find((d) => d.kind === 'pos')
  if (varOlan) {
    console.log(`\n  POS kasası ZATEN VAR: ${varOlan.name} · ${varOlan.status}`)
    if (varOlan.status === 'open' || !APPLY) return
    const r = await openDrawer(fin, ctx, { drawerId: varOlan.id, openingFloat: money(0) })
    console.log(r.ok ? '  ✓ açıldı' : `  ✗ açılamadı: ${JSON.stringify(r.error)}`)
    return
  }

  console.log(`\n  açılacak: "${AD}" · kind=pos · açılış bakiyesi 0 ₺`)
  if (!APPLY) { console.log('\n--apply ile çalıştırın.'); return }

  const created = await createDrawer(fin, ctx, { drawerId: ID, branchId: BRANCH as BranchId, name: AD, kind: 'pos' })
  if (!created.ok) { console.log(`✗ oluşturulamadı: ${JSON.stringify(created.error)}`); return }
  console.log(`  ✓ oluşturuldu: ${ID}`)

  // Hemen açılıyor: gece döngüsü yarın 09:00'da açacak, ama bugün kartla çekilen para bir kasaya
  // düşsün. Kapalı bir kasa para kabul etmiyor ve bugünü kaybetmenin bir sebebi yok.
  const opened = await openDrawer(fin, ctx, { drawerId: ID, openingFloat: money(0) })
  console.log(opened.ok ? '  ✓ açıldı' : `  ✗ açılamadı: ${JSON.stringify(opened.error)}`)
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
