import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// HUNİYİ GERİYE DÖNÜK DOLDUR (owner, 2026-09-01).
//
//   pnpm tsx tools/migration/huni-geriye-donuk-2026-09.ts            (kuru çalışma)
//   pnpm tsx tools/migration/huni-geriye-donuk-2026-09.ts --apply
//
// ── NEDEN ───────────────────────────────────────────────────────────────────────────────────
//
// 192 lead'in 190'ı `new` aşamasında duruyordu. Sebep ölçüldü: AI her sohbeti okuyup bir kanaate
// varıyordu, o kanaat sohbet belgesinde kalıyor ve huniye hiç ulaşmıyordu.
//
// Bağlantı bugün kuruldu — ama yalnızca BUNDAN SONRA yazan kişiler için. Sessiz lead'ler sonsuza
// kadar "Yeni"de kalırdı, ve owner huniyi açtığında yine 190 satırlık tek bir yığın görürdü. Yani
// "atıl kaldı" şikâyeti çözülmemiş olurdu.
//
// ── NEDEN HEPSİ "BİLGİ ALIYOR" ─────────────────────────────────────────────────────────────
//
// Eski sıcaklığı (`sıcak/ılık/soğuk`) aşamaya çevirmek CAZİP ama YANLIŞ olurdu. "Sıcak" 82 sohbete
// yapıştırılmıştı ve gerekçeleri karışıktı: kimi fiyat sormuş, kimi sadece ilgili görünmüş. Onları
// toptan "Fiyat verildi" yapmak, huniyi doğru rakamla değil GÜVENİLİR GÖRÜNEN bir rakamla
// doldurmak olurdu — ve bir daha kimse sorgulamazdı.
//
// Kanıtlanabilir olan tek şey şu: bu kişi yazdı ve biz cevapladık. Karşılığı `contacted` =
// "Bilgi alıyor". Ötesi tahmindir.
//
// Bundan sonrası kendiliğinden düzelir: kişi bir daha yazdığında AI aşamayı okur ve huni ilerler.
// Yani bu script bir başlangıç noktası koyar, son sözü söylemez.

const STUDIO = 'retro'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  const sohbetler = new Map(
    (await db.collection(`studios/${STUDIO}/conversations`).get()).docs.map((d) => [
      String((d.data() as { phone?: string }).phone ?? d.id),
      d.data() as { messages?: unknown[] },
    ]),
  )
  const leadler = (await db.collection(`studios/${STUDIO}/leads`).get()).docs

  let hedef = 0
  let sohbetsiz = 0
  let zaten = 0
  for (const d of leadler) {
    const l = d.data() as { stage?: string; phone?: string }
    if (l.stage !== 'new') {
      zaten++
      continue
    }
    const konusma = sohbetler.get(String(l.phone))
    // Sohbeti olmayan lead'e dokunulmaz: onun "Yeni"de olması DOĞRU — kimse onunla konuşmadı.
    if (!konusma || (konusma.messages?.length ?? 0) < 2) {
      sohbetsiz++
      continue
    }
    hedef++
    if (!apply) continue
    await d.ref.update({ stage: 'contacted' })
  }

  console.log(`toplam lead              : ${leadler.length}`)
  console.log(`zaten ilerlemiş          : ${zaten}`)
  console.log(`sohbeti yok — dokunulmaz : ${sohbetsiz}`)
  console.log(`"Bilgi alıyor" olacak    : ${hedef}`)
  if (!apply) console.log('\n(uygulamak için --apply)')
  else console.log('\n✓ Huni dolduruldu. Bundan sonrası AI tarafından ilerletilir.')
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
