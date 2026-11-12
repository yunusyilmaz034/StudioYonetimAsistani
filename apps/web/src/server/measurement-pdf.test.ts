import { describe, expect, it } from 'vitest'

import { parseTanitaLines } from './measurement-pdf'

// The lines exactly as the reader rebuilds them from a PERFECTO (Tanita) sheet — taken from a real
// printout with the member replaced by a made-up one. Ranges, segmental rows, ratios, gauges and the
// history table are kept because they are what a careless reader would pick up instead.
const SHEET = [
  'PERFECTO SEGMENTAL VÜCUT ANALİZİ',
  '2026/11/06 18:46:00 2026/11/06 18:46:00',
  'Hazırlayan',
  'Adı Soyadı Cinsiyet Vücut Tipi Yaş Kilo (kg) Boy (cm) BMI',
  'Ad Soyad',
  'DENEME ÜYE 12 Kadın Standart 34 64.4 162.0 24.5 (20 ~ 25)',
  'Genel Genel',
  'İdeal Kilo 59.05kg ( 52.49~65.61kg ) Protein 8.54kg / 13.26% ( 8.76~9.72kg / 13.6~15.09%)',
  'Yağsız Kütle 47.98kg / 74.5% ( 46.37~51.52kg / 72~80%) Mineral 3.5kg / 5.44% ( 3.41~3.74kg / 5.3~5.81%)',
  'Kas 45.55kg / 70.73% ( 44.02~48.91kg / 68.35~75.95%) Metabolik Yaş 31',
  'Yağ 16.42kg / 25.5% (12.88~18.03kg / 20~28%) Bazal Metabolizma Hızı 1,429 kcal / 5,979 kjl ( 1,100~1,750 kcal / 4,602~7,322 kjl)',
  'Sıvı 35.94kg / 55.8% (32.20~39.28kg /50~60.99%) Beden Yoğunluğu 1.0393 (1.033~1.053)',
  'Hücre İçi Sıvı 20.00kg Hücre Dışı Sıvı 16.00kg',
  'Obezite Derecesi 9.06% İç Yağlanma 7.5 (1 ~ 13)',
  'Yumuşak Yağsız Kütle 44.48kg / 69.07% İskeletsel Kaslar 27.16kg / 42.17% Organsal Kaslar 16.25kg / 25.23%',
  'Kas kg 25.55',
  'Yağ kg 9.23',
  'BMR/Ağırlık 22 Bel / Kalça 0.78',
  'Bel (cm) 76 Bel / Boy 0.47',
  'Yağ Oranı % Sıvı % İç Yağlanma Oranı',
  'Ölçüm Tarihi Ağırlık Sıvı Yağ',
  '06/11/2026 18:46:00 64.4 35.94 16.42',
  'Yağ (kg) 2.83 2.51 0.96 0.86 9.23',
  'Kas (kg) 7.6 7.8 2.2 2.4 25.55',
  'Yağ Kütlesi 16.42 kg Yağ Oranı % 25.5 BMI 24.5 (64.4) /(162.0)* (162.0)',
]

describe('parseTanitaLines — the PERFECTO sheet, read without AI', () => {
  it('reads every reading and none of the ranges, segmental rows or ratios', () => {
    const r = parseTanitaLines(SHEET)
    expect(r).toEqual({
      ok: true,
      value: {
        takenOn: '2026-11-06',
        waistCm: 76,
        metrics: {
          weightKg: 64.4,
          bmi: 24.5,
          idealWeightKg: 59.05,
          leanMassKg: 47.98,
          leanMassPercent: 74.5,
          muscleKg: 45.55,
          musclePercent: 70.73,
          waterKg: 35.94,
          waterPercent: 55.8,
          fatKg: 16.42,
          fatPercent: 25.5,
          bmr: 1429,
          visceralFat: 7.5,
        },
      },
    })
  })

  it('never lets the name reach a field, even a name with digits in it', () => {
    expect(JSON.stringify(parseTanitaLines(SHEET))).not.toMatch(/DENEME|ÜYE/)
  })

  it('takes the weight from the BMI box when the header row is laid out differently', () => {
    const r = parseTanitaLines(SHEET.filter((l) => !l.startsWith('DENEME')))
    expect(r.ok && r.value.metrics.weightKg).toBe(64.4)
    expect(r.ok && r.value.metrics.bmi).toBe(24.5)
  })

  it('"Yumuşak Yağsız Kütle" never answers "Yağsız Kütle"', () => {
    const r = parseTanitaLines(SHEET.filter((l) => !l.startsWith('Yağsız Kütle')))
    expect(r.ok && r.value.metrics.leanMassKg).toBeUndefined()
  })

  it('a waist ratio is not a circumference', () => {
    const r = parseTanitaLines(
      SHEET.map((l) => (l.startsWith('Bel (cm)') ? 'Bel / Boy 0.47' : l)),
    )
    expect(r.ok && r.value.waistCm).toBeNull()
  })

  it('decimal commas are read as decimals; a BMR thousands comma is not', () => {
    const r = parseTanitaLines([
      'Kas 45,55kg / 70,73%',
      'Bazal Metabolizma Hızı 1.429 kcal',
    ])
    expect(r.ok && r.value.metrics).toEqual({
      muscleKg: 45.55,
      musclePercent: 70.73,
      bmr: 1429,
    })
  })

  it('a sheet it does not know is unreadable — never an empty measurement', () => {
    expect(parseTanitaLines(['Fatura', 'Toplam 4.000,00 TL'])).toEqual({
      ok: false,
      reason: 'unreadable',
    })
    expect(parseTanitaLines([])).toEqual({ ok: false, reason: 'unreadable' })
  })
})
