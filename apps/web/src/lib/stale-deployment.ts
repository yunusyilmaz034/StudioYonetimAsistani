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

// The SERVER logs "Failed to find Server Action …". The BROWSER usually does not see that string —
// it gets a generic failure, and on 2026-07-30 that meant an operator mid-import was told to "try
// again", which is the one thing that cannot work. So the client-visible phrasings are here too.
const MARKERS = [
  'Failed to find Server Action',
  'older or newer deployment',
  'An unexpected response was received from the server',
  'Connection closed',
  'Failed to fetch',
  'NetworkError',
  'Load failed',
] as const

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

/**
 * Kapıdaki bir yazmanın NEDEN düştüğü.
 *
 * `checkInCommand` bir Server Action değil — istemci doğrudan `/commands`'a yazar. Ekran bu yazmanın
 * her başarısızlığını tek bir cümleyle karşılıyordu: *"İşlem alınamadı. Bağlantıyı kontrol edin."*
 * Bu bir TAHMİNDİ, ve üç ayrı arızayı aynı torbaya koyuyordu — oturum düşmüş, yetki reddetmiş, ağ
 * gitmiş. Üçünün çaresi farklı, ve resepsiyon üçünde de wifi'ye bakıyordu.
 *
 * 2026-08-31'de owner "çıkış yap"a basıp bu cümleyi gördü ve elimizde teşhis edecek hiçbir şey
 * yoktu, çünkü `catch` hatayı olduğu gibi çöpe atıyordu (OR-42: görülemeyen arıza).
 */
export function commandErrorMessage(e: unknown): string {
  // Firestore hataları bir `code` taşır; onu okumak tahmin etmekten iyidir.
  const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : ''
  const text = e instanceof Error ? e.message : String(e ?? '')

  if (text.includes('Not authenticated') || code.includes('unauthenticated')) {
    return 'Oturumunuz düşmüş. Sayfayı yenileyip tekrar giriş yapın.'
  }
  if (text.includes('claim on token')) {
    // Nadir ama gerçek: yetkiler değiştiğinde token tazelenene kadar bu olur, ve tek çare yenilemek.
    return 'Yetki bilgileriniz güncel değil. Sayfayı yenileyin (⌘R), sonra tekrar deneyin.'
  }
  if (code.includes('permission-denied')) {
    return 'Bu işlem için yetkiniz görünmüyor. Sayfayı yenileyin; sürerse haber verin.'
  }
  if (isStaleDeployment(e)) return saveErrorMessage(e)
  if (code.includes('unavailable') || code.includes('deadline-exceeded')) {
    return 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.'
  }
  return 'İşlem alınamadı. Sayfayı yenileyip tekrar deneyin; sürerse haber verin.'
}
