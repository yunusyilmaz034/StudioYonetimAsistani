'use client'

import Link from 'next/link'
import { PrinterIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { TimesheetPaper } from '@/server/timesheet-query'

import { anYazi, gunKisa, haftaEtiketi, ssdd } from '../format'

// KÂĞIDIN KENDİSİ.
//
// Islak imzayla imzalanıp dosyaya girecek. O yüzden: siyah-beyaz yazıcıda çamura dönecek renk yok,
// tablo çizgili, ve kâğıdın hangi SÜRÜM olduğu üstünde yazıyor — bir düzeltmeden sonra iki kâğıt
// yan yana durduğunda hangisinin geçerli olduğu sorulmamalı.
//
// `@media print` uygulamanın geri kalanını siliyor (`globals.css`); yazıcıdan çıkan yalnızca bu.
//
// İMZA METNİ YOK, bilerek: "okudum, doğrudur" gibi bir beyan hukuki bir cümledir ve onu yazılım
// uyduramaz. Kâğıtta yalnızca imza yerleri var.

const BOS = '—'

export function KagitView({ kagit }: { kagit: TimesheetPaper }) {
  const s = kagit.sheet
  const sonradan = s.days.reduce((a, d) => a + d.retroEntryCount, 0)
  const otomatik = s.days.reduce((a, d) => a + d.autoClosedCount, 0)

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      {/* Bu blok basılırken kaybolur. */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/mesai/cizelge?hafta=${kagit.weekStart}`} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
          Haftalık çizelgeye dön
        </Link>
        <Button className="min-h-11" onClick={() => window.print()}>
          <PrinterIcon className="size-4" />
          Yazdır
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 text-black print:rounded-none print:border-0 print:p-0">
        <header className="border-b border-black pb-3">
          <p className="text-sm">{kagit.studioName}</p>
          <h1 className="text-xl font-semibold">Haftalık Çalışma ve Ara Dinlenmesi Çizelgesi</h1>
          <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2 print:grid-cols-2">
            <p>
              Personel: <span className="font-semibold">{kagit.staffName}</span>
            </p>
            <p>
              Hafta: <span className="font-semibold">{haftaEtiketi(kagit.weekStart)}</span>
            </p>
            <p>
              Sürüm: <span className="font-semibold">{s.version}</span>
              {!kagit.enYeni ? <span className="font-semibold"> — ESKİ SÜRÜM, yerine yenisi üretildi</span> : null}
            </p>
            <p>Üretildi: {anYazi(s.generatedAt)}</p>
          </div>
        </header>

        {/* Tablo yalnızca kendi kabında yatay kayar; sayfa gövdesi kaymaz. Kâğıtta zaten sığıyor. */}
        <div className="overflow-x-auto print:overflow-visible">
          <table className="mt-4 w-full min-w-[640px] border-collapse text-sm tabular-nums print:min-w-0">
            <thead>
              <tr className="text-left">
                {['Gün', 'Planlanan saat', 'Planlı mola', 'Planlı net', 'Bulunma', 'Mola', 'Net çalışma', 'Plan dışı mola'].map((b) => (
                  <th key={b} className="border border-black px-2 py-1.5 font-semibold">
                    {b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.days.map((d) => (
                <tr key={d.date}>
                  <td className="border border-black px-2 py-1.5">{gunKisa(d.date)}</td>
                  {/* "Plan yok" ile "0 saat plan" aynı şey değil: planı olmayan günde çizgi, sıfır değil. */}
                  <td className="border border-black px-2 py-1.5">{d.planned ? `${d.planned.start}–${d.planned.end}` : BOS}</td>
                  <td className="border border-black px-2 py-1.5">{d.planned ? ssdd(d.planned.breakMinutes) : BOS}</td>
                  <td className="border border-black px-2 py-1.5">{d.planned ? ssdd(d.planned.netMinutes) : BOS}</td>
                  <td className="border border-black px-2 py-1.5">{ssdd(d.actualPresenceMinutes)}</td>
                  <td className="border border-black px-2 py-1.5">
                    {ssdd(d.actualBreakMinutes)}
                    {d.retroEntryCount > 0 ? ' *' : ''}
                    {d.autoClosedCount > 0 ? ' **' : ''}
                  </td>
                  <td className="border border-black px-2 py-1.5 font-semibold">{ssdd(d.actualNetMinutes)}</td>
                  <td className="border border-black px-2 py-1.5">{d.excessBreakMinutes > 0 ? `+${ssdd(d.excessBreakMinutes)}` : BOS}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="border border-black px-2 py-1.5" colSpan={3}>
                  Hafta toplamı
                </td>
                <td className="border border-black px-2 py-1.5">{ssdd(s.plannedNetMinutes)}</td>
                <td className="border border-black px-2 py-1.5">{ssdd(s.days.reduce((a, d) => a + d.actualPresenceMinutes, 0))}</td>
                <td className="border border-black px-2 py-1.5">{ssdd(s.actualBreakMinutes)}</td>
                <td className="border border-black px-2 py-1.5">{ssdd(s.actualNetMinutes)}</td>
                <td className="border border-black px-2 py-1.5">{s.excessBreakMinutes > 0 ? `+${ssdd(s.excessBreakMinutes)}` : BOS}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-3 space-y-0.5 text-xs">
          <p>Süreler saat:dakika. Net çalışma = işyerinde bulunma − ara dinlenmesi.</p>
          {sonradan > 0 ? <p>* {sonradan} mola personel tarafından sonradan girilmiştir.</p> : null}
          {otomatik > 0 ? <p>** {otomatik} mola, gün sonunda açık kaldığı için sistem tarafından kapatılmıştır.</p> : null}
        </div>

        <section className="mt-10 grid grid-cols-2 gap-8 text-sm">
          {['Personel', 'İşyeri yetkilisi'].map((kim) => (
            <div key={kim} className="space-y-8">
              <p className="font-semibold">{kim}</p>
              <p className="border-t border-black pt-1">Ad soyad · imza · tarih</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  )
}
