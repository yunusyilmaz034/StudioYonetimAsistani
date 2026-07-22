// Lowering a package's granted credits at the point of sale (an 8-class package sold as 6) reuses the
// credit-adjustment mechanism, which requires a non-empty audit note (AD-39, `note_required`). At the
// point of sale reception has no note field and shouldn't need one — so when a credit override actually
// LOWERS the count and no note was typed, we record a clear, automatic reason instead of refusing the
// save. The invariant (every adjustment carries a reason) is preserved; only the friction is removed.
export function autoSaleNote(packageCredit: number | null | undefined, creditOverride: number | null, providedNote: string): string {
  const typed = providedNote.trim()
  if (typed) return providedNote
  if (creditOverride != null && packageCredit != null && creditOverride !== packageCredit) {
    return `Satışta kredi ${packageCredit} → ${creditOverride} olarak ayarlandı`
  }
  return providedNote
}
