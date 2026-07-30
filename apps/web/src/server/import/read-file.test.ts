import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import { readCsv, readUpload, readXlsx } from './read-file'

// The xlsx path is the newest code in this feature and the one with the most ways to be quietly
// wrong, so it is tested against a REAL workbook rather than a fixture someone hand-wrote: the
// traps here (1-indexed row values, serial dates, formula cells) only exist in a file exceljs
// itself produced.

async function workbook(build: (sheet: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Üyeler')
  build(sheet)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('readXlsx', () => {
  it('reads a plain sheet, header row included', async () => {
    const buf = await workbook((s) => {
      s.addRow(['Ad Soyad', 'Telefon'])
      s.addRow(['AYŞE YILMAZ', '05321111111'])
    })
    const out = await readXlsx(buf)
    expect(out.rows[0]).toEqual(['Ad Soyad', 'Telefon'])
    expect(out.rows[1]).toEqual(['AYŞE YILMAZ', '05321111111'])
  })

  it('does NOT shift columns — row.values is 1-indexed with a hole at 0', async () => {
    // Slicing that wrong moves every column by one, and the mapping screen then looks perfectly
    // correct while reading the wrong cells. This is the failure that would be hardest to see.
    const buf = await workbook((s) => {
      s.addRow(['A', 'B', 'C'])
      s.addRow(['1', '2', '3'])
    })
    const out = await readXlsx(buf)
    expect(out.rows[0]).toEqual(['A', 'B', 'C'])
    expect(out.rows[1]).toEqual(['1', '2', '3'])
  })

  it('turns a real date cell into dd.MM.yyyy, not 46253', async () => {
    // Excel stores 19.08.2026 as a serial number. Handing that number downstream turns every
    // package expiry into 1970 — or into a rejected row nobody can explain, because the cell
    // plainly says a date.
    const buf = await workbook((s) => {
      s.addRow(['Bitiş'])
      s.addRow([new Date(Date.UTC(2026, 7, 19))])
    })
    const out = await readXlsx(buf)
    expect(out.rows[1]![0]).toBe('19.08.2026')
  })

  it('reads a formula cell as its cached result, never by evaluating it', async () => {
    // Evaluating an uploaded formula is running an uploaded program.
    const buf = await workbook((s) => {
      s.addRow(['Toplam'])
      s.addRow([{ formula: 'SUM(1,2)', result: 3 }])
    })
    const out = await readXlsx(buf)
    expect(out.rows[1]![0]).toBe('3')
  })

  it('keeps a number-formatted phone as digits', async () => {
    // Excel eats the leading zero. The phone normaliser accepts a bare 10-digit 5… number, so this
    // survives — but it must arrive as digits and not as scientific notation.
    const buf = await workbook((s) => {
      s.addRow(['Telefon'])
      s.addRow([5321111111])
    })
    const out = await readXlsx(buf)
    expect(out.rows[1]![0]).toBe('5321111111')
  })

  it('skips fully empty rows and reports the sheet names', async () => {
    const buf = await workbook((s) => {
      s.addRow(['Ad'])
      s.addRow([])
      s.addRow(['AYŞE'])
    })
    const out = await readXlsx(buf)
    expect(out.rows).toEqual([['Ad'], ['AYŞE']])
    expect(out.sheetNames).toEqual(['Üyeler'])
  })

  it('refuses something that is not a workbook, with a message a human can act on', async () => {
    await expect(readXlsx(Buffer.from('not a workbook'))).rejects.toThrow(/okunamadı/)
  })
})

describe('readCsv', () => {
  it('sniffs the semicolon Turkish Excel writes', () => {
    const out = readCsv('Ad Soyad;Telefon\nAYŞE;05321111111')
    expect(out.rows[0]).toEqual(['Ad Soyad', 'Telefon'])
  })

  it('still handles a comma file', () => {
    expect(readCsv('a,b\n1,2').rows[1]).toEqual(['1', '2'])
  })

  it('strips the BOM — left in place it becomes part of the first header name', () => {
    // The column lookup then silently fails to find "ad", because the column is really "<BOM>ad".
    const out = readCsv('﻿Ad;Tel\nAYŞE;0532')
    expect(out.rows[0]![0]).toBe('Ad')
  })

  it('honours quoted fields containing the delimiter', () => {
    const out = readCsv('ad;not\n"YILMAZ, AYŞE";"a;b"')
    expect(out.rows[1]).toEqual(['YILMAZ, AYŞE', 'a;b'])
  })

  it('drops blank lines', () => {
    expect(readCsv('a;b\n\n1;2\n').rows).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('readUpload', () => {
  it('picks the xlsx reader by content, not just by name', async () => {
    // A workbook saved as "uyeler.xls" or with no extension is still a zip; the magic bytes decide.
    const buf = await workbook((s) => s.addRow(['Ad']))
    const out = await readUpload('uyeler', buf)
    expect(out.rows[0]).toEqual(['Ad'])
  })

  it('falls back to CSV for text', async () => {
    const out = await readUpload('uyeler.csv', Buffer.from('a;b\n1;2', 'utf8'))
    expect(out.rows[1]).toEqual(['1', '2'])
  })
})
