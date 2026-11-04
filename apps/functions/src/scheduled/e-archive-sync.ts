import { FirestoreInvoiceRepository, type StudioId } from '@studio/core'
import * as logger from 'firebase-functions/logger'

import { PARASUT_PROD } from '../parasut/api'
import { credentialsFromEnv, ParasutClient, tokenDoc } from '../parasut/client'
import { E_ARCHIVE_ACTOR, processEArchive } from '../parasut/issue'
import { systemTenantContext, listStudioIds } from '../shared/context'
import { db } from '../shared/firebase'

// FT-2 · every 5 minutes: finish what the trigger started. A request whose trigger run was cut short,
// whose e-Arşiv job was still running, or whose Paraşüt call failed on the network lands here.
// It NEVER starts a request — only a human's press does (OR-132). Once a day it also refreshes the
// Paraşüt token, because an unused refresh token dies after ~30 days and the owner would have to sign
// in again in the middle of a quiet month.

const DAY = 86_400_000

export async function runEArchiveSync(now: number): Promise<void> {
  const database = db()
  for (const studioId of await listStudioIds(database)) {
    try {
      const ctx = systemTenantContext(studioId as StudioId, E_ARCHIVE_ACTOR)
      const repo = new FirestoreInvoiceRepository(database)
      const pending = await repo.listPendingEArchives(ctx)
      for (const m of pending) {
        const r = await processEArchive(database, studioId as StudioId, m.paymentId, now)
        logger.info('e-archive sync', { studioId, paymentId: m.paymentId, outcome: r })
      }
      await keepAlive(studioId, now)
    } catch (e) {
      logger.error('e-archive sync failed', { studioId, error: (e as Error)?.message })
    }
  }
}

async function keepAlive(studioId: string, now: number): Promise<void> {
  const credentials = credentialsFromEnv()
  if (!credentials) return
  const t = await tokenDoc(db(), studioId).get()
  const at = t.get('refreshedAt')?.toMillis?.() as number | undefined
  if (!t.get('refreshToken') || (at && now - at < DAY)) return
  const policy = await new FirestoreInvoiceRepository(db()).getInvoicePolicy(systemTenantContext(studioId as StudioId, E_ARCHIVE_ACTOR))
  if (!policy.parasut.companyId) return
  await new ParasutClient({
    database: db(),
    studioId,
    companyId: policy.parasut.companyId,
    credentials,
    apiBase: policy.parasut.apiBase ?? PARASUT_PROD.apiBase,
    idBase: policy.parasut.idBase ?? PARASUT_PROD.idBase,
  })
    .refresh()
    .catch((e: unknown) => logger.warn('parasut keep-alive refresh failed', { studioId, error: (e as Error)?.message }))
}
