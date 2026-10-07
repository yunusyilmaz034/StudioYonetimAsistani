import { addLocalDays, daysBetween } from '../../../shared'
import { mondayOf } from './week-plan'
import type { PlannedDay } from './working-time'

// ── A/B HAFTA DÖNGÜSÜ (owner, 2026-10-06) ──────────────────────────────────────────────────
//
// WEEK_A = cumartesisiz hafta · WEEK_B = cumartesili hafta · A → B → A → B …
//
// SAF ve DETERMİNİSTİK: parite bir çapa tarihinden hesaplanır, saklanan bir sayaçtan değil. Sayaç
// olsaydı bir hafta atlandığında ya da iki kez işlendiğinde döngü sessizce kayardı.
//
// Takvim ay/yıl dönümü döngüyü bozmaz, çünkü hesap AY ve YIL görmez: iki pazartesi arasındaki gün
// farkı yediye tam bölünür, ve paritesi alınır. 52 haftalık yıl ile 53 haftalık yıl arasında fark
// yoktur — hafta sayısı hiç kullanılmıyor.
//
// Hafta tanımı mevcut olandır (`mondayOf`, owner kararı Pazartesi–Pazar). İkinci bir hafta tanımı
// icat etmek, "bu hafta hangisi" sorusuna iki cevap vermek olurdu.

export type WeekParity = 'A' | 'B'

/**
 * Çapa haftası A'dır; ondan sonraki hafta B, sonraki yine A.
 *
 * Çapadan ÖNCEki haftalar da doğru hesaplanır (negatif fark modülü düzeltiliyor), böylece geçmiş
 * bir haftanın çizelgesi bugünkü çapayla da yeniden üretilebilir.
 */
export function weekParityAt(cycleAnchorDate: string, date: string): WeekParity {
  const weeks = daysBetween(mondayOf(cycleAnchorDate), mondayOf(date)) / 7
  return (((weeks % 2) + 2) % 2) === 0 ? 'A' : 'B'
}

/** ISO hafta günü: 1 = Pazartesi … 7 = Pazar. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** Bir haftanın şablonu: çalışılmayan gün için alan yazılmaz. */
export type TemplateWeek = Readonly<Partial<Record<IsoWeekday, PlannedDay>>>

/**
 * Personelin iki haftalık döngüsü.
 *
 * `cycleAnchorDate` DEĞİŞTİRİLEMEZ olmalı: değişirse geçmiş bütün haftaların paritesi kayar ve
 * imzalanmış çizelgelerle sistem çelişir. Döngü kaydırılacaksa yeni bir şablon açılır.
 */
export interface ShiftTemplate {
  readonly cycleAnchorDate: string
  readonly weekA: TemplateWeek
  readonly weekB: TemplateWeek
}

/** Haftanın kaçıncı günü: indeks 0 pazartesidir, çünkü hafta pazartesi başlıyor. */
const isoWeekday = (index: number): IsoWeekday => ((index + 1) as IsoWeekday)

/**
 * Şablondan bir haftanın günlerini üretir: 'YYYY-MM-DD' → planlanan gün.
 *
 * ÜRETİR, KARAR VERMEZ (owner, 2026-10-07). Çıktı yalnızca haftalık plan taslağını doldurmak
 * içindir; personelin gördüğü ve raporun yargıladığı şey ONAYLANMIŞ plandır. İkisi çelişirse
 * onaylanmış plan kazanır — yoksa "bu hafta kaçta?" sorusunun iki cevabı olurdu (OR-77'nin
 * resepsiyon → owner → yayın zinciri da böyle korunuyor).
 */
export function templateWeekDays(
  template: ShiftTemplate,
  weekStart: string,
): Readonly<Record<string, PlannedDay>> {
  const week = weekParityAt(template.cycleAnchorDate, weekStart) === 'A' ? template.weekA : template.weekB
  const out: Record<string, PlannedDay> = {}
  for (let i = 0; i < 7; i++) {
    const day = week[isoWeekday(i)]
    if (day) out[addLocalDays(weekStart, i)] = day
  }
  return out
}
