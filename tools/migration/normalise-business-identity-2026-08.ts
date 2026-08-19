// İŞLETME KİMLİĞİNİ TEK YAZIMA GETİR.
//
//   pnpm tsx tools/migration/normalise-business-identity-2026-08.ts            (kuru çalışma)
//   pnpm tsx tools/migration/normalise-business-identity-2026-08.ts --apply
//
// WHY. Local SEO'nun tamamı Google'ın işletmeyi TEK bir varlık olarak tanımasına dayanıyor, ve o
// tanıma isim-adres-telefonun her yerde AYNI yazılmasıyla kuruluyor. 2026-08-20 itibarıyla aynı
// işletme dört farklı biçimde yazılıydı:
//
//   site + hukuki metinler : "Pilates Fitness by Işıl"  · "Akse Mahallesi, Karasu Caddesi No: 28/T…"
//   panel ayarları         : "Pilates Fitness By Işıl"  · "akse mah karasu cad no 28/T"
//
// Bu alanlar dekoratif değil: `company.displayName` makbuzlarda ve `/api/public/products`in
// `studioName` alanında görünüyor — yani tanıtım sitesinin ÜYELİK sayfasında müşteriye gösteriliyor.
// `address` makbuzun üstünde basılıyor. Yani hem Google'ın gördüğü sinyal hem müşterinin gördüğü
// belge burada belirleniyor.
//
// Kaynak: `apps/web/src/lib/legal.ts`teki SELLER. Orası hukuki metinlerin de okuduğu yer, yani
// sözleşmede ne yazıyorsa makbuzda da o yazacak.

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const STUDIO = 'retro'

// SELLER ile birebir aynı olmalı. Elle kopyalanıyor çünkü bu script `apps/web` bağımlılığı taşımaz.
const CANON = {
  displayName: 'Pilates Fitness by Işıl',
  legalName: 'Retro Spor Hizmetleri Tic. Ltd. Şti.',
  address: 'Akse Mahallesi, Karasu Caddesi No: 28/T, 41420 Çayırova / Kocaeli',
  phone: '0533 199 41 23',
  taxOffice: 'İlyasbey Vergi Dairesi',
  taxNumber: '7342634727',
} as const

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  const sRef = db.doc(`studios/${STUDIO}/settings/studio`)
  const company = (((await sRef.get()).data() ?? {}) as { company?: Record<string, unknown> }).company ?? {}

  const patch: Record<string, string> = {}
  for (const [k, want] of Object.entries(CANON)) {
    const has = String(company[k] ?? '')
    const same = has === want
    console.log(`${k.padEnd(12)} ${same ? '=' : '≠'} ${JSON.stringify(has)}`)
    if (!same) {
      console.log(`${' '.repeat(14)}→ ${JSON.stringify(want)}`)
      patch[k] = want
    }
  }

  const mRef = db.doc(`studios/${STUDIO}/settings/mobile`)
  const branding = (((await mRef.get()).data() ?? {}) as { branding?: Record<string, unknown> }).branding ?? {}
  const appName = String(branding.appName ?? '')
  const appNeeds = appName !== CANON.displayName
  console.log(`\nmobil appName ${appNeeds ? '≠' : '='} ${JSON.stringify(appName)}`)
  if (appNeeds) console.log(`${' '.repeat(14)}→ ${JSON.stringify(CANON.displayName)}`)

  if (Object.keys(patch).length === 0 && !appNeeds) {
    console.log('\nHer şey zaten tutarlı.')
    process.exit(0)
  }
  if (!apply) {
    console.log('\nUygulamak için --apply')
    process.exit(0)
  }

  // Merge, ve yalnızca bu alanlar: `company` içinde başka alanlar da var (logo, IBAN vb.) ve
  // buradan yazılan bir tam nesne onları sessizce silerdi.
  if (Object.keys(patch).length > 0) await sRef.set({ company: patch }, { merge: true })
  if (appNeeds) await mRef.set({ branding: { ...branding, appName: CANON.displayName } }, { merge: true })

  console.log('\n✓ Yazıldı. Makbuz, mobil uygulama ve /api/public/products artık aynı ismi kullanıyor.')
  process.exit(0)
}

void main()
