import type { AdjustmentKind, CompensationModel, EarningLineKind, StatementStatus } from '@studio/core'

// TR labels + money formatting for the payroll screens. Web-side (no server import) so a client
// bundle never pulls firebase-admin. Money is integer kuruş everywhere; only this file turns it into ₺.

export const MODEL_LABEL: Record<CompensationModel, string> = {
  fixed: 'Sabit maaş',
  hourly: 'Saatlik',
  per_class: 'Ders başı',
  per_member: 'Üye başı',
  commission: 'Komisyon',
  mixed: 'Karma',
}

export const LINE_LABEL: Record<EarningLineKind, string> = {
  base: 'Sabit maaş',
  hourly: 'Saatlik',
  per_class: 'Ders başı',
  per_member: 'Üye başı',
  commission: 'Komisyon',
}

export const ADJUSTMENT_LABEL: Record<AdjustmentKind, string> = {
  bonus: 'Prim',
  deduction: 'Kesinti',
  correction: 'Düzeltme',
  advance: 'Avans',
}

// A bonus/correction adds; a deduction/advance subtracts. The owner enters a positive magnitude and
// the kind fixes the sign — a negative "düzeltme" is entered as a "kesinti" (unambiguous, one meaning).
export const ADJUSTMENT_SIGN: Record<AdjustmentKind, 1 | -1> = {
  bonus: 1,
  correction: 1,
  deduction: -1,
  advance: -1,
}

export const STATUS_LABEL: Record<StatementStatus, string> = {
  finalized: 'Kesinleşti',
  paid: 'Ödendi',
}

// Kuruş → "1.234,50 ₺". A signed amount keeps its sign (a deduction reads as −250 ₺).
export function formatKurus(kurus: number): string {
  return `${(kurus / 100).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₺`
}

// "1.234,50 ₺" input helpers: a ₺ string → integer kuruş, and back. Reject anything non-numeric.
export function liraToKurus(lira: string): number | null {
  const n = Number(String(lira).replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

export function kurusToLira(kurus: number): string {
  return (kurus / 100).toString()
}
