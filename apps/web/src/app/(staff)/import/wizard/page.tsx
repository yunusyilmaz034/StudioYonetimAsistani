import { requirePageAccess } from '@/server/auth'

import { ImportWizard } from './wizard-screen'

// THE IMPORT WIZARD (owner, 2026-07-30).
//
// Read a spreadsheet, map its columns to ours, decide whose package is whose, look at exactly what
// will happen, and only then commit. Every step before the last writes nothing.
//
// It supersedes the frozen BulutGym importer at `/import`: that one reads one vendor's CSV in one
// shape. This one reads whatever the next studio arrives with, which is the difference between
// onboarding a customer in a day and writing a parser per customer.
export default async function ImportWizardPage() {
  const ctx = await requirePageAccess('/import')
  return <ImportWizard branchId={ctx.branchIds[0] ?? null} />
}
