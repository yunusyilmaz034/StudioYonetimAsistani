import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { isClean, REJECTION_COPY, validateMembers, type ValidationReport } from './canonical'
import { readBulutGymMembers } from './csv'

// `pnpm migrate:validate -- <dosya.csv>`
//
// Reads the incumbent export and says, row by row, whether it may enter the system. **It writes
// nothing to the database.** It is the step that runs in the dry-run rehearsal, days before the
// cutover, precisely because a phone collision needs a human and a phone call — and neither is
// available at T+2h on cutover morning (Doc 8, R9).

const REPORT_DIR = resolve('tools/migration/reports')

export function writeReport(name: string, body: string): string {
  mkdirSync(REPORT_DIR, { recursive: true })
  const path = resolve(REPORT_DIR, name)
  writeFileSync(path, body, 'utf8')
  return path
}

export function renderValidationReport(report: ValidationReport): string {
  const lines: string[] = []
  lines.push('# İçe aktarma doğrulama raporu')
  lines.push('')
  lines.push(`Toplam satır: **${report.total}**`)
  lines.push(`Geçerli: **${report.valid.length}**`)
  lines.push(`Reddedilen: **${report.rejected.length}**`)
  lines.push('')

  if (report.rejected.length) {
    lines.push('## Reddedilen satırlar')
    lines.push('')
    lines.push('| Satır | Ad Soyad | Telefon | Sebep |')
    lines.push('|---|---|---|---|')
    for (const r of report.rejected) {
      const why =
        r.reason === 'duplicate_phone'
          ? `${REJECTION_COPY[r.reason]} (çakıştığı satır: ${r.collidesWithLine})`
          : REJECTION_COPY[r.reason]
      lines.push(`| ${r.line} | ${r.fullName || '—'} | ${r.phoneRaw || '—'} | ${why} |`)
    }
    lines.push('')
    lines.push(
      '> Bu satırlar **kaynak dosyada** düzeltilmelidir. Import onları tahmin etmez, ' +
        'düzeltmez ve birleştirmez — çünkü hangisinin doğru olduğunu yalnızca bir insan bilir.',
    )
  } else {
    lines.push('## Reddedilen satır yok')
    lines.push('')
    lines.push('Dosya içe aktarılmaya hazır.')
  }

  return `${lines.join('\n')}\n`
}

function main(): void {
  const path = process.argv[2]
  if (!path) {
    console.error('Kullanım: pnpm migrate:validate -- <bulutgym-export.csv>')
    process.exit(2)
  }

  const rows = readBulutGymMembers(path)
  const report = validateMembers(rows)
  const written = writeReport('validation.md', renderValidationReport(report))

  console.log(`Toplam ${report.total} satır · geçerli ${report.valid.length} · reddedilen ${report.rejected.length}`)
  console.log(`Rapor: ${written}`)

  if (!isClean(report)) {
    // A NON-ZERO exit. The dry-run script chains on this, so a dirty file can never be imported by
    // somebody who did not read the output — which, at 07:00 on cutover morning, is everybody.
    console.error('\n❌ Dosya içe aktarılamaz. Reddedilen satırlar var; kaynak dosyayı düzeltin.')
    process.exit(1)
  }
  console.log('\n✅ Temiz. İçe aktarılabilir.')
}

// Only when run directly — the report renderer is imported by the tests.
if (process.argv[1]?.endsWith('validate.ts')) main()
