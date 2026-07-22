// The FIXED registry of Patron Asistanı actions. The AI may only ever suggest a kind from this list
// (an unknown code is dropped, exactly like an invented exercise or checklist item). The WHO — the
// audience — is always computed deterministically from the snapshot, never chosen by the model; the AI
// picks the KIND, we own the recipients. Sending reuses the audited engagement pipeline
// (sendEngagementAction → notify), so marketing consent / opt-in is enforced in one place. The owner
// confirms every send (recipient count + editable text) before anything leaves.

export type PatronActionKind = 'remind_debtors' | 'renew_expiring' | 'winback_dormant' | 'draft_campaign'

export interface PatronActionDef {
  readonly kind: PatronActionKind
  readonly label: string
  // Which deterministic audience from the snapshot this send targets. null → not a send (a navigation).
  readonly audienceKey: 'debtors' | 'expiring' | 'dormant' | null
  readonly defaultSubject: string
  readonly defaultBody: string
  readonly navigate: string | null // for non-send actions (e.g. open the campaign composer)
}

export const PATRON_ACTIONS: Record<PatronActionKind, PatronActionDef> = {
  remind_debtors: {
    kind: 'remind_debtors',
    label: 'Borçlulara ödeme hatırlatması',
    audienceKey: 'debtors',
    defaultSubject: 'Küçük bir hatırlatma 🌸',
    defaultBody:
      'Merhaba! Paketinizle ilgili küçük bir bakiye hatırlatması yapmak istedik. Uygun olduğunuzda resepsiyondan kolayca tamamlayabilirsiniz. Sağlıkla kalın 💛',
    navigate: null,
  },
  renew_expiring: {
    kind: 'renew_expiring',
    label: 'Süresi dolanlara yenileme daveti',
    audienceKey: 'expiring',
    defaultSubject: 'Paketinizin süresi yaklaşıyor',
    defaultBody:
      'Merhaba! Paketinizin süresi yaklaşıyor. Ara vermemek ve kazandığın formu korumak için yenileme fırsatını kaçırma — sana en uygun paket için buradayız 🌸',
    navigate: null,
  },
  winback_dormant: {
    kind: 'winback_dormant',
    label: 'Kaçan üyelere dönüş mesajı',
    audienceKey: 'dormant',
    defaultSubject: 'Seni özledik 🌸',
    defaultBody:
      'Merhaba! Bir süredir seni göremedik, iyi olduğuna emin olmak istedik. Sana uygun bir gün ayarlayalım — kapımız her zaman açık 🤗',
    navigate: null,
  },
  draft_campaign: {
    kind: 'draft_campaign',
    label: 'Kampanya taslağı hazırla',
    audienceKey: null,
    defaultSubject: '',
    defaultBody: '',
    navigate: '/engagement',
  },
}

// Resolved for the client: the kind + a real recipient count and the exact member ids + editable text.
export interface ResolvedPatronAction {
  readonly kind: PatronActionKind
  readonly label: string
  readonly audienceCount: number
  readonly memberIds: readonly string[]
  readonly defaultSubject: string
  readonly defaultBody: string
  readonly navigate: string | null
}

// The chat/briefing return shapes — declared here (not in the 'use server' action file, which may only
// export async functions) so both the action and the client can share them.
export interface PatronAnswer {
  readonly answer: string
  readonly actions: readonly ResolvedPatronAction[]
  readonly aiGenerated: boolean
}
export interface PatronBriefing extends PatronAnswer {
  readonly generatedAt: number
  readonly weekKey: string
}

export const PATRON_ACTION_KINDS = Object.keys(PATRON_ACTIONS) as PatronActionKind[]
