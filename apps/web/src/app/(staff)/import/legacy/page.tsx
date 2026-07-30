import { requirePageAccess } from '@/server/auth'

import { ImportScreen } from '../import-screen'

// THE BULUTGYM IMPORT (v1.27 S5) — kept, not deleted.
//
// It reads a CSV, tells the owner row by row with line numbers what it will not accept, and refuses
// the whole run until the source file is fixed. It imports a NAME and a PHONE and nothing else,
// because BulutGym exported nothing else.
//
// Superseded by `/import/wizard`, which maps arbitrary columns from arbitrary files. This one stays
// reachable because it is the tool that actually moved this studio's 120 members, and a working
// migration tool is not something to delete the week after a migration.
export default async function LegacyImportPage() {
  const ctx = await requirePageAccess('/import')
  return <ImportScreen branchId={ctx.branchIds[0] ?? null} />
}
