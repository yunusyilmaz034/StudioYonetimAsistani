// A panel left open across a deployment cannot save, and used to say nothing useful about it.
//
// ── What happens (2026-07-29, reception could not register a member) ─────────────────────────
//
// Next.js gives every Server Action a content-hashed id baked into the page that calls it. Deploy a
// new build and those ids change. A tab opened before the deploy keeps calling the OLD id, the
// server answers "Failed to find Server Action … This request might be from an older or newer
// deployment", and the call throws — so every form's generic catch fires.
//
// Reception saw "Kaydedilemedi. Lütfen tekrar deneyin." while standing in front of a customer, and
// retrying is the one thing that CANNOT work: the tab is broken until it is reloaded. She tried
// three times, then messaged the owner. The panel was fine; her copy of it was stale.
//
// This is not rare — it happens to whoever has the panel open every single time we ship. So the one
// case where "try again" is wrong gets its own message, telling her the only thing that helps.
//
// Detection is by message text because that is all Next.js gives us: the failure arrives as a plain
// Error with no code. The check is deliberately loose (two independent fragments, either one is
// enough) so a wording change upstream degrades to the generic message rather than to a lie.

const MARKERS = ['Failed to find Server Action', 'older or newer deployment'] as const

/** True when a call failed only because this tab predates the running deployment. */
export function isStaleDeployment(e: unknown): boolean {
  const text =
    e instanceof Error ? `${e.message} ${e.stack ?? ''}` : typeof e === 'string' ? e : String(e ?? '')
  return MARKERS.some((m) => text.includes(m))
}

/** Turkish copy for the two outcomes, so every form says the same thing. */
export const STALE_DEPLOYMENT_MESSAGE =
  'Panelin yeni bir sürümü yayınlandı, bu sekme eski kaldı. Sayfayı yenileyin (Ctrl+R), sonra tekrar kaydedin.'

export const GENERIC_SAVE_ERROR = 'Kaydedilemedi. Lütfen tekrar deneyin.'

/** The message to show for a thrown save error — the only branch a form needs. */
export function saveErrorMessage(e: unknown): string {
  return isStaleDeployment(e) ? STALE_DEPLOYMENT_MESSAGE : GENERIC_SAVE_ERROR
}
