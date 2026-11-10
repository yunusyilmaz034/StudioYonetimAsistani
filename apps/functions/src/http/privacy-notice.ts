// KVKK aydınlatma for people who are not members yet (owner, 2026-11-10).
//
// A member read the notice when she signed up. Someone who writes to the studio from an ad on
// WhatsApp or Instagram never did, and her messages are processed (by the AI, abroad) from the first
// word. So the FIRST reply in a conversation carries one line with the notice's address, and no reply
// after it does — once is the duty, more is noise.
//
// The address is the studio's own data (`settings/ai.privacyNoticeUrl`): no studio's domain lives in
// code. Absent ⇒ no line, which is what a studio without a notice page gets until it sets one.

export interface PrivacyNoticeState {
  privacyNoticeAt?: number
}

export function withPrivacyNotice(
  reply: string,
  conv: PrivacyNoticeState,
  url: string | undefined,
): { text: string; noticed: boolean } {
  const address = url?.trim()
  if (!address || conv.privacyNoticeAt) return { text: reply, noticed: false }
  return { text: `${reply}\n\nKişisel verilerinizin işlenmesi hakkında bilgi: ${address}`, noticed: true }
}
