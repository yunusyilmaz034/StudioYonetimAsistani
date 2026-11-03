// How a conversation is NAMED in the panel (IG-1). WhatsApp always had a phone to fall back on; an
// Instagram conversation may have no name and no phone yet — only an Instagram-scoped id, which is
// meaningless to a person. So the fallback order is: the name she gave → her @username → the tail of
// her phone → "Instagram kişisi". Never the raw conversation key.
export interface ConvLabelInput {
  readonly name: string
  readonly handle: string
  readonly phone: string
  readonly channel: 'whatsapp' | 'instagram'
}

export function convLabel(c: ConvLabelInput, tail = 6): string {
  if (c.name.trim()) return c.name.trim()
  if (c.handle.trim()) return `@${c.handle.trim()}`
  if (c.phone) return c.phone.slice(-tail)
  return c.channel === 'instagram' ? 'Instagram kişisi' : 'WhatsApp kişisi'
}

export const CHANNEL_LABEL = { whatsapp: 'WhatsApp', instagram: 'Instagram' } as const
