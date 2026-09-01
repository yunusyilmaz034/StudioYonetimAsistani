import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// TURNİKE CİHAZININ ADI (owner, 2026-09-01, montajdan önce).
//
//   pnpm tsx tools/migration/rename-turnstile-device-2026-09.ts
//   pnpm tsx tools/migration/rename-turnstile-device-2026-09.ts --apply
//
// Giriş cihazının adı `polis` — kurulum gecesinde iki kutuyu ayırt etmek için konmuş bir test adı.
// Artık o ad panelde resepsiyona gösteriliyor ve "polis kapısını aç" yazan bir düğme, güveni
// azaltmaktan başka bir şey yapmaz.
//
// Olay YAZILMIYOR, bilerek: bir cihazın etiketi bir iş olayı değil, bir montaj ayrıntısı. Yazılsaydı
// olay defterine anlamsız bir satır eklenirdi — ve o defterin değeri, içindeki her satırın bir şey
// anlatmasından geliyor. Konsoldan elle düzeltilmemesinin sebebi ise ayrı: elle düzeltmenin kaydı
// kalmaz, bu dosyanın kalır.

const STUDIO = 'retro'
const YENI: Record<string, string> = {
  dev_8f0a11df8e7e81885000: 'Giriş turnikesi',
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA ──\n')

  for (const [id, ad] of Object.entries(YENI)) {
    const ref = db.doc(`studios/${STUDIO}/devices/${id}`)
    const snap = await ref.get()
    if (!snap.exists) {
      console.log(`${id}: YOK — atlandı`)
      continue
    }
    const eski = String(snap.get('name') ?? '')
    if (eski === ad) {
      console.log(`${id}: zaten "${ad}"`)
      continue
    }
    console.log(`${id}: "${eski}" → "${ad}"`)
    if (apply) await ref.update({ name: ad })
  }
  if (!apply) console.log('\n(uygulamak için --apply)')
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
