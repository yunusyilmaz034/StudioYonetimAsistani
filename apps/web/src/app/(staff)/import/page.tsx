import { requirePageAccess } from '@/server/auth'

import { ImportScreen } from './import-screen'

// THE BULUTGYM IMPORT (v1.27 S5).
//
// The owner's one-time move off the old system. It reads a CSV, tells her — row by row, with line
// numbers — what it will not accept, and refuses the whole run until she has fixed the source file.
//
// It imports a NAME and a PHONE. Nothing else: BulutGym exports nothing else, and packages, credits
// and balances are opened by hand against her own list rather than guessed from a file.
export default async function ImportPage() {
  const ctx = await requirePageAccess('/import')
  return <ImportScreen branchId={ctx.branchIds[0] ?? null} />
}
