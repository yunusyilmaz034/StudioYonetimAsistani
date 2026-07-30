import { requirePageAccess } from '@/server/auth'
import { listImportBatchesAction } from '@/server/actions/import-wizard'

import { ImportHistory } from './history-screen'

// AKTARIMLAR — the list of every import this studio has run, and the undo for each.
//
// This replaced the frozen BulutGym one-shot screen as the landing page (2026-07-30). That importer
// read one vendor's CSV in one fixed shape; the wizard at `/import/wizard` reads whatever the next
// studio arrives with. The old screen is kept at `/import/legacy` — it is the tool that moved this
// studio's 120 members and there is no reason to delete a thing that worked.
export default async function ImportPage() {
  await requirePageAccess('/import')
  const rows = await listImportBatchesAction()
  return <ImportHistory rows={rows.map((r) => ({ ...r, appliedAt: Number(r.appliedAt) }))} />
}
