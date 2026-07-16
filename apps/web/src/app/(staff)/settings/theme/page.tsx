import { requirePageAccess } from '@/server/auth'
import { getStudioThemeAction } from '@/server/actions/theme'

import { ThemeScreen } from './theme-screen'

// Ayarlar › Tema (PF-12). Gated at /settings like Entegrasyonlar; the update action is owner-only.
export default async function ThemePage() {
  await requirePageAccess('/settings')
  const initial = await getStudioThemeAction()
  return <ThemeScreen initial={initial} />
}
