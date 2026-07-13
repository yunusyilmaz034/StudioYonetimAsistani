import type { Clock, MemberId, NewEvent, TenantContext } from '../../../shared'
import type { Interaction, Lead, Offer } from '../domain/types'

export interface CrmRepository {
  getLead(ctx: TenantContext, id: string): Promise<Lead | null>
  listLeads(ctx: TenantContext): Promise<readonly Lead[]>
  saveLead(ctx: TenantContext, lead: Lead, events: readonly NewEvent[]): Promise<void>

  listInteractions(
    ctx: TenantContext,
    of: { leadId?: string; memberId?: MemberId },
  ): Promise<readonly Interaction[]>
  saveInteraction(ctx: TenantContext, i: Interaction, events: readonly NewEvent[]): Promise<void>

  getOffer(ctx: TenantContext, id: string): Promise<Offer | null>
  listOffers(ctx: TenantContext, of: { leadId?: string; memberId?: MemberId }): Promise<readonly Offer[]>
  saveOffer(ctx: TenantContext, offer: Offer, events: readonly NewEvent[]): Promise<void>

  // Churn is recorded against the member, but it is a CRM fact — it belongs to the relationship,
  // not to the credit ledger.
  recordChurn(ctx: TenantContext, memberId: MemberId, events: readonly NewEvent[]): Promise<void>
}

export interface CrmDeps {
  readonly repo: CrmRepository
  readonly clock: Clock
}
