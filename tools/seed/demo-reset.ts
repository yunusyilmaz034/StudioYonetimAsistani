// DEMO STÜDYOSUNU SIFIRLA — yalnızca `studios/demo/` altını siler.
//
//   FIREBASE_PROJECT_ID=studio-yonetim-prod pnpm tsx tools/seed/demo-reset.ts          (kuru)
//   FIREBASE_PROJECT_ID=studio-yonetim-prod pnpm tsx tools/seed/demo-reset.ts --apply
//
// NEDEN VAR. `demo-studio.ts` tek geçişte kurulacak şekilde yazıldı: yarıda kalırsa "kaldığı yerden
// devam" etmiyor, çünkü hiç çalıştırılmamış bir devam dalı sessizce yanlış veri üretir. Yarıda
// kalınca doğru hareket burayı boşaltıp baştan kurmak.
//
// NEDEN KORUNAN LİSTESİ, SİLİNEN LİSTESİ DEĞİL. İlk hâli silinecekleri tek tek sayıyordu ve
// `members_by_phone` listede yoktu: 45 üye silindi, telefon indeksi kaldı, ikinci kurulum ilk üyede
// "phone_already_registered" ile çöktü. Elle yazılmış bir silme listesinin hata biçimi SESSİZ
// kalıntıdır — yeni bir koleksiyon eklendiğinde kimse listeyi güncellemeyi hatırlamaz. Tersi
// güvenli: korunacaklar sayılı, geri kalan her şey gider.
//
// GÜVENLİK. Bu bir SİLME scripti ve Işıl'ın işletmesiyle aynı veritabanında çalışıyor. `lockToStudio`
// yüzünden `studios/demo/` dışındaki her yol — okuma dahil — veritabanına ulaşmadan çöküyor.
// Koleksiyonlar da stüdyo dokümanının kendi altından okunuyor; başka bir stüdyonun koleksiyonu bu
// listeye giremez.
import { getFirestore, type CollectionReference } from 'firebase-admin/firestore'
import { initializeApp } from 'firebase-admin/app'

import { lockToStudio } from './demo-guard'

const STUDIO = 'demo'
const APPLY = process.argv.includes('--apply')

/**
 * Kurulumun DEĞİL, hesabın parçası olanlar. Şube, ayarlar ve personel silinirse geriye giriş
 * yapılamayan bir stüdyo kalır — sıfırlanan şey demo verisi, hesabın kendisi değil.
 */
const KORUNAN = new Set(['branches', 'settings', 'staff'])

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = lockToStudio(getFirestore(), STUDIO)

  console.log(APPLY ? '── SİLİNİYOR ──' : '── KURU ÇALIŞMA (hiçbir şey silinmez) ──')
  console.log(`Stüdyo: ${STUDIO} (kilit aktif — bu id dışına dokunulamaz)\n`)

  const hepsi = await db.doc(`studios/${STUDIO}`).listCollections()
  let toplam = 0

  for (const col of hepsi) {
    if (KORUNAN.has(col.id)) {
      console.log(`   korundu          ${col.id}`)
      continue
    }
    const n = (await col.count().get()).data().count
    if (n === 0) continue
    if (APPLY) await db.recursiveDelete(col as CollectionReference)
    console.log(`   ${APPLY ? 'silindi' : 'var    '}  ${String(n).padStart(6)}  ${col.id}`)
    toplam += n
  }

  console.log(`\n${toplam === 0 ? 'Demo zaten boş.' : `Toplam ${toplam} doküman.`}`)
  if (!APPLY && toplam > 0) console.log('Silmek için --apply')
  process.exit(0)
}

void main()
