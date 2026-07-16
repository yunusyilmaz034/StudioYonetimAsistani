// `pnpm setup:payment-provider` — write the studio's PAYTR provider config (the NON-secret half:
// merchant id, test mode, URLs, enabled flags). The secrets (merchant_key/salt) live ONLY in Secret
// Manager and are never here. Config, not event-sourced (like the notification-template overrides).
// The owner can edit it afterwards from Ayarlar › Entegrasyonlar.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-sos'
if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.ALLOW_PRODUCTION) {
  console.error('Refusing to run against production without ALLOW_PRODUCTION=1.')
  process.exit(1)
}
const STUDIO = process.argv[2] ?? 'retro'
const MERCHANT_ID = process.argv[3] ?? '724651'
const BASE = process.argv[4] ?? 'https://panel.pilatesfitnessbyisil.com'

async function main(): Promise<void> {
  initializeApp({ projectId: PROJECT })
  const db: Firestore = getFirestore()

  const config = {
    provider: 'paytr' as const,
    merchantId: MERCHANT_ID,
    // TEST mode ON: real PAYTR API calls, but no real charge — for the pilot's end-to-end test. The
    // owner flips it off from Ayarlar › Entegrasyonlar when going live.
    testMode: true,
    active: true,
    posEnabled: true,
    linkEnabled: true,
    // The code appends `?sid=<studioId>` to the callback URL itself, so this stays the bare route.
    callbackUrl: `${BASE}/api/payments/paytr/callback`,
    successUrl: `${BASE}/payments/return`,
    failUrl: `${BASE}/payments/return`,
  }
  await db.doc(`studios/${STUDIO}/settings/paymentProvider`).set(config, { merge: true })
  console.log(`✅ PAYTR sağlayıcı ayarı yazıldı — mağaza ${MERCHANT_ID}, TEST modu, aktif.`)
  console.log('   (merchant_key / merchant_salt Secret Manager\'da; burada YOK.)')
  process.exit(0)
}

void main()
