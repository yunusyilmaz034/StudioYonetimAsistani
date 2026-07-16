// `pnpm setup:payment-surcharge` — set the studio's KK/havale payment surcharge + max installments,
// through the domain path (updateStudioSettings → decide → save with a settings_update event). The
// owner edits these from Ayarlar › Ödeme (PAYTR) afterwards; this just seeds the pilot's opening value.
import {
  DEFAULT_STUDIO_CONFIG,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  systemClock,
  updateStudioSettings,
  type SchedulingDeps,
  type StudioId,
  type StudioSettings,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-sos'
if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.ALLOW_PRODUCTION) {
  console.error('Refusing to run against production without ALLOW_PRODUCTION=1.')
  process.exit(1)
}
const STUDIO = (process.argv[2] ?? 'retro') as StudioId
const BRANCH = process.argv[3] ?? 'mutlukent'

const SURCHARGE_KURUS = 100_000 // 1.000 ₺ — the KK/havale fark (cash excluded, handled elsewhere)
const MAX_INSTALLMENTS = 3

async function main(): Promise<void> {
  initializeApp({ projectId: PROJECT })
  const db: Firestore = getFirestore()
  const ctx: TenantContext = {
    studioId: STUDIO,
    branchIds: [BRANCH as never],
    role: 'owner',
    actor: { type: 'platform_admin', id: 'setup' as never },
  }
  const deps: SchedulingDeps = {
    repo: new FirestoreSchedulingRepository(db),
    clock: systemClock,
    studioConfig: DEFAULT_STUDIO_CONFIG,
    hours: new FirestoreStudioHours(db),
  }

  const current = await deps.repo.getStudioSettings(ctx)
  if (!current) throw new Error('Stüdyo ayarları bulunamadı — önce Ayarlar kurulmalı.')

  const next: StudioSettings = {
    ...current,
    paymentSurcharge: { cardTransferSurchargeKurus: SURCHARGE_KURUS, maxInstallments: MAX_INSTALLMENTS },
  }
  const r = await updateStudioSettings(deps, ctx, next)
  if (!r.ok) throw new Error(`Ayar yazılamadı: ${r.error.code}`)

  console.log(`✅ Ödeme farkı ${(SURCHARGE_KURUS / 100).toLocaleString('tr-TR')} ₺ · max ${MAX_INSTALLMENTS} taksit ayarlandı.`)
  process.exit(0)
}

void main()
