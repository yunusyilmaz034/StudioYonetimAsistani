import { requirePageAccess } from '@/server/auth'

import { ContentTabs } from './content-tabs'

// "İçerik": the week's Instagram plan (IG-2a/2b/2c) and, beside it, the comments (IG-3).
// The AI proposes and drafts; people film, approve and reply. Nothing goes out unapproved.
export default async function ContentPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePageAccess('/content')
  const { tab } = await searchParams
  return <ContentTabs initial={tab === 'comments' ? 'comments' : 'plan'} />
}
