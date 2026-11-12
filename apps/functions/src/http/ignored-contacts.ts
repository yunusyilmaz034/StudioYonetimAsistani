import type { Firestore } from 'firebase-admin/firestore'

// PRIVATE CONTACTS (owner, 2026-11-12: "ışıl ve benim yunus olan yazışmalar buraya gelmesin").
//
// The owners write to their own studio's WhatsApp and Instagram from their personal phones — family
// messages, tests. Those are not customers: they must not appear in Sohbetler, not be counted as
// leads, and the AI must not answer them. The list is the studio's DATA (`settings/ai.ignoredContacts`,
// conversation keys: a WhatsApp number as Meta sends it, e.g. "905…", or "ig_<igsid>"), never a
// number in code. A message from a listed contact is dropped before anything is stored.

/** PURE. Is this conversation key on the studio's private list? */
export function isIgnoredContact(list: unknown, key: string): boolean {
  return Array.isArray(list) && list.some((k) => typeof k === 'string' && k.trim() === key)
}

export async function ignoredContact(db: Firestore, sid: string, key: string): Promise<boolean> {
  const list = (await db.doc(`studios/${sid}/settings/ai`).get()).get('ignoredContacts')
  return isIgnoredContact(list, key)
}
