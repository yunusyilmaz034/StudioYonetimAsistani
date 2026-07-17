import { getStudioSettingsAction } from '@/server/actions/settings'
import { getStudioThemeAction } from '@/server/actions/theme'
import { requirePageAccess } from '@/server/auth'

import { SettingsScreen } from './settings-screen'

// STUDIO SETTINGS (v1.27 S2).
//
// The point of this screen is not the screen. It is that **a studio can now be set up without
// anybody touching the Firestore console** — which the runbook forbids, and which was, until today,
// the only way to do it.
//
// Everything the studio produces — a receipt, an e-mail, a WhatsApp template, one day an e-fatura —
// reads its company details from ONE document. A company name typed into a template is a company
// name that will be wrong in one of them.
export default async function SettingsPage() {
  const ctx = await requirePageAccess('/settings')
  const [settings, theme] = await Promise.all([getStudioSettingsAction(), getStudioThemeAction()])
  return (
    <SettingsScreen
      settings={settings}
      theme={theme}
      branchId={ctx?.branchIds[0] ?? null}
      canManage={ctx?.role === 'owner'}
    />
  )
}
