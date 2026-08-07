// `pnpm setup:turnstile <studioId> <branchId> "<name>"` — pair a turnstile with the studio.
//
// Mints the device's id and secret and prints the secret ONCE. Only the SHA-256 hash is stored: a
// door key readable from the database is a key that everyone who can read the database also has, and
// this one opens a physical door.
//
// The secret goes into the device's firmware. If it is lost, run this again for a new one and
// deactivate the old device from the panel — there is deliberately no way to read it back.
//
// Manual, admin-only, never in CI.
import { createHash, randomBytes } from 'node:crypto'

import { newOperationId, type StudioId } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore'

const PROJECT = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-sos'
if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.ALLOW_PRODUCTION) {
  console.error('Refusing to run against production without ALLOW_PRODUCTION=1.')
  process.exit(1)
}

const STUDIO = (process.argv[2] ?? 'retro') as StudioId
const BRANCH = process.argv[3] ?? 'mutlukent'
const NAME = process.argv[4] ?? 'Turnike'

async function main(): Promise<void> {
  initializeApp({ projectId: PROJECT })
  const db: Firestore = getFirestore()

  const deviceId = `dev_${newOperationId().slice(4)}`
  const secret = randomBytes(24).toString('base64url')
  const secretHash = createHash('sha256').update(secret).digest('hex')

  await db.doc(`studios/${STUDIO}/devices/${deviceId}`).set({
    studioId: STUDIO,
    branchId: BRANCH,
    name: NAME,
    secretHash,
    active: true,
    lastSeenAt: null,
    createdAt: Timestamp.now(),
  })

  console.log(`\n✅ Turnike kaydedildi: ${NAME}`)
  console.log(`\n   Cihaz kimliği : ${deviceId}`)
  console.log(`   Gizli anahtar : ${secret}`)
  console.log(`\n   Cihazın Authorization başlığı:`)
  console.log(`     Bearer ${deviceId}.${secret}`)
  console.log(`     X-Studio-Id: ${STUDIO}`)
  console.log(`\n   ⚠️  Bu anahtar BİR KEZ gösterilir; veritabanında yalnızca özeti (hash) duruyor.`)
  console.log(`   Kaybolursa bu betiği tekrar çalıştır ve eskisini panelden pasife al.\n`)
  process.exit(0)
}

void main()
