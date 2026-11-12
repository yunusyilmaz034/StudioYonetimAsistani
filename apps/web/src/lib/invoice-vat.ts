// The VAT inside a VAT-included total (owner, 2026-11-12: "kesilen ve kesilmeyen tüm faturalarda … toplam kdv de
// hesaplansın"). Integer kuruş in, integer kuruş out (#10). The rate is the studio's (Ayarlar → Fatura), never a
// literal here; no rate set ⇒ null, and the screen says so instead of guessing 20.

/** VAT contained in `grossKurus` at `ratePercent`, rounded to the kuruş. */
export function vatInGross(grossKurus: number, ratePercent: number): number {
  return Math.round((grossKurus * ratePercent) / (100 + ratePercent))
}

/** Gross and VAT of a set of VAT-included amounts. VAT is summed per row, as each invoice rounds its own. */
export function vatSummary(grossKurus: readonly number[], ratePercent: number | null): { gross: number; vat: number | null } {
  const gross = grossKurus.reduce((n, g) => n + g, 0)
  if (ratePercent === null) return { gross, vat: null }
  return { gross, vat: grossKurus.reduce((n, g) => n + vatInGross(g, ratePercent), 0) }
}
