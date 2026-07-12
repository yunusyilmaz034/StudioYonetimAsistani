import type { ExportableTable } from '@/lib/widgets/contract'

// Export, v1.23. CSV today; Excel and PDF later — and they will be *writers over the same
// `ExportableTable`*, not new screens. That is the point of putting the contract in first: a report
// is columns and rows, and the file format is a detail that must never leak into a screen.
//
// UTF-8 BOM on purpose: without it Excel renders Turkish characters as mojibake, and the owner's
// very first export reads "Ay?e".
export function downloadCsv(table: ExportableTable): void {
  const escape = (v: string | number): string => {
    const s = String(v)
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  // Semicolon, not comma: Turkish Excel reads the comma as a decimal separator, so a comma-separated
  // file lands entirely in column A.
  const lines = [table.columns.map(escape).join(';'), ...table.rows.map((r) => r.map(escape).join(';'))]
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${table.name}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
