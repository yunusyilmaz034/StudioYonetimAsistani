'use server'

import { requireTenantContext } from '../auth'
import { loadAdvisor, type AdvisorItem } from '../advisor-query'

// Decision-support is owner-first (the product vision). The advisor reveals the business — who owes,
// who is about to churn — so it is owner-confidential; reception and trainers have no access.
const OWNER = ['owner', 'platform_admin'] as const

export async function loadAdvisorAction(): Promise<readonly AdvisorItem[]> {
  const ctx = await requireTenantContext(OWNER)
  return loadAdvisor(ctx)
}
