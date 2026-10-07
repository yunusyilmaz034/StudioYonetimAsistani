'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangleIcon, ChevronLeftIcon, ChevronRightIcon, FileTextIcon, PrinterIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { domainErrorMessage } from '@/lib/domain-error'
import { generateWeekTimesheetsAction } from '@/server/actions/timesheet'
import type { SheetContent, TimesheetRow, TimesheetWeekView } from '@/server/timesheet-query'

import { anYazi, gunKisa, haftaEtiketi, ssdd } from './format'

// HAFTALIK RAPOR (OR-119 · Faz 6).
//
// Ekranda görünen sayılar CANLI hesaptır: plan, vardiya ve molalardan şu an çıkan şey. Kâğıt ise
// "Çizelgeleri üret"e basıldığı anda DONAR ve bir daha hesaplanmaz. İkisi ayrıldığında ekran bunu
// söyler; yeniden üretmek eski kâğıdı silmez, yeni bir sürüm verir.
//
// YALNIZCA GÖRÜNÜRLÜK VE KAYIT: buradaki hiçbir sayı bir kesintiye ya da bordroya gitmiyor.
//
// Tablo değil liste, bilerek: yedi sütunlu bir tablo 375 px'e sığmıyor ve yatay kaydırılan bir
// rapor, sağdaki sütunu hiç okunmayan bir rapordur.

export function CizelgeScreen({
  view,
  oncekiHafta,
  sonrakiHafta,
  buHafta,
}: {
  view: TimesheetWeekView
  oncekiHafta: string
  sonrakiHafta: string | null
  buHafta: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState(false)
  const git = (w: string) => start(() => router.push(w === buHafta ? '/mesai/cizelge' : `/mesai/cizelge?hafta=${w}`))

  const uretilecek = view.rows.filter((r) => !r.bos && !r.guncel).length

  async function uret() {
    setBusy(true)
    try {
      const res = await generateWeekTimesheetsAction({ weekStart: view.weekStart })
      if (res.ok) {
        const { uretilen, degismeyen } = res.value
        toast.success(
          uretilen > 0
            ? `${uretilen} çizelge üretildi${degismeyen > 0 ? `, ${degismeyen} tanesi zaten günceldi` : ''}.`
            : 'Bütün çizelgeler zaten güncel; yeni sürüm üretilmedi.',
        )
        start(() => router.refresh())
      } else {
        toast.error(domainErrorMessage(res.error as Parameters<typeof domainErrorMessage>[0]))
      }
    } catch {
      toast.error('Çizelgeler üretilemedi. Bağlantınızı kontrol edin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <PageHeader title="Haftalık çizelge" description="Çalışma ve ara dinlenme süreleri: plan ile gerçekleşen." />

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-foreground">{haftaEtiketi(view.weekStart)}</p>
            <Link href="/mesai" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
              Mesai ekranına dön
            </Link>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="size-9" aria-label="Önceki hafta" disabled={pending} onClick={() => git(oncekiHafta)}>
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-9"
              aria-label="Sonraki hafta"
              disabled={pending || sonrakiHafta === null}
              onClick={() => sonrakiHafta && git(sonrakiHafta)}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </div>

        {!view.planYayinda ? (
          <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            Bu haftanın onaylanmış bir planı yok. Gerçekleşen süreler yazılır, plana göre fazla ya da eksik hesaplanmaz.
          </p>
        ) : null}

        {/* Pazardan önce düğme KİLİTLİ DEĞİL, yalnızca uyarıyor: hafta ortasında kâğıda ihtiyaç duyan
            bir masa olabilir, ve erken üretilen kâğıt hiçbir şeyi bozmaz — pazar günü yeniden üretmek
            yeni bir sürüm verir, eskisi durur. */}
        {!view.haftaKapandi ? (
          <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-sm text-warning">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <span>Hafta henüz bitmedi. Şimdi üretilen çizelge yarım haftayı dondurur; pazar günü yeniden üretmeniz gerekir.</span>
          </p>
        ) : null}

        <Button size="lg" className="min-h-12 w-full" disabled={busy || pending || uretilecek === 0} onClick={() => void uret()}>
          <FileTextIcon className="size-5" />
          {uretilecek === 0 ? 'Bütün çizelgeler güncel' : `Çizelgeleri üret (${uretilecek})`}
        </Button>
      </Card>

      {view.rows.length === 0 ? (
        <Card className="p-5">
          <p className="text-sm text-muted-foreground">Bu hafta planlanan ya da mesai kaydı olan personel yok.</p>
        </Card>
      ) : (
        view.rows.map((r) => <KisiKarti key={r.staffUserId} row={r} weekStart={view.weekStart} />)
      )}
    </main>
  )
}

function KisiKarti({ row, weekStart }: { row: TimesheetRow; weekStart: string }) {
  const s = row.canli
  const k = row.kayitli
  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-foreground">{row.displayName}</h2>
          {/* KAYDIN DURUMU: üretilmedi · sürüm n (imzasız / imzalı) · kayıt artık güncel değil. */}
          <p className="text-xs text-muted-foreground">
            {k === null ? (
              row.bos ? 'Planı ve mesai kaydı yok — çizelge üretilmez.' : 'Çizelge henüz üretilmedi.'
            ) : (
              <>
                Sürüm {k.version} · {anYazi(k.generatedAt)} ·{' '}
                {k.signedAt === null ? <span className="font-medium text-warning">imzasız</span> : <span className="font-medium text-success">imzalı</span>}
              </>
            )}
          </p>
          {k !== null && !row.guncel ? (
            <p className="text-xs font-medium text-warning">
              Kayıt sonradan değişti. Yeniden üretilirse sürüm {k.version + 1} olur ve imzasız başlar.
            </p>
          ) : null}
        </div>
        {k !== null ? (
          <Link
            href={`/mesai/cizelge/yazdir?hafta=${weekStart}&kisi=${row.staffUserId}`}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted"
          >
            <PrinterIcon className="size-4" />
            Yazdır
          </Link>
        ) : null}
      </div>

      {row.acikMola || row.acikVardiya ? (
        <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-xs text-warning">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            {row.acikVardiya ? 'Kapanmamış bir mesai var; son turnike geçişine kadar sayıldı. ' : ''}
            {row.acikMola ? 'Kapanmamış bir mola var; süresi bilinmediği için sayılmadı.' : ''}
          </span>
        </p>
      ) : null}

      <GunListesi sheet={s} />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border pt-3 text-sm">
        <dt className="text-muted-foreground">Gerçekleşen net çalışma</dt>
        <dd className="text-right font-semibold tabular-nums">
          {ssdd(s.actualNetMinutes)}
          {s.plannedNetMinutes > 0 ? <span className="font-normal text-muted-foreground"> / {ssdd(s.plannedNetMinutes)}</span> : null}
        </dd>
        <dt className="text-muted-foreground">Kullanılan mola</dt>
        <dd className="text-right font-medium tabular-nums">{ssdd(s.actualBreakMinutes)}</dd>
        {s.excessBreakMinutes > 0 ? (
          <>
            <dt className="text-warning">Plan dışı mola</dt>
            <dd className="text-right font-medium tabular-nums text-warning">+{ssdd(s.excessBreakMinutes)}</dd>
          </>
        ) : null}
        {/* Sözleşme süresi bir HEDEF değil, bir satır (OR-119): altında ya da üstünde kalmak hiçbir şeyi
            reddetmez ve burada renk de almaz. */}
        {row.contractWeeklyMinutes !== null ? (
          <>
            <dt className="text-muted-foreground">Sözleşmedeki haftalık süre</dt>
            <dd className="text-right tabular-nums text-muted-foreground">{ssdd(row.contractWeeklyMinutes)}</dd>
          </>
        ) : null}
      </dl>
    </Card>
  )
}

function GunListesi({ sheet }: { sheet: SheetContent }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {sheet.days.map((d) => {
        const hareket = d.actualPresenceMinutes > 0 || d.actualBreakMinutes > 0
        return (
          <li key={d.date} className="space-y-0.5 px-3 py-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-foreground">{gunKisa(d.date)}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {d.planned ? `Plan ${d.planned.start}–${d.planned.end} · net ${ssdd(d.planned.netMinutes)}` : 'Plan yok'}
              </span>
            </div>
            {hareket ? (
              <p className="text-xs tabular-nums text-muted-foreground">
                <span className="font-medium text-foreground">Net {ssdd(d.actualNetMinutes)}</span>
                <span className="ml-1">· bulunma {ssdd(d.actualPresenceMinutes)}</span>
                <span className="ml-1">
                  · mola {ssdd(d.actualBreakMinutes)}
                  {d.planned ? ` / ${ssdd(d.planned.breakMinutes)}` : ''}
                </span>
                {d.excessBreakMinutes > 0 ? <span className="ml-1 font-medium text-warning">· plan dışı +{ssdd(d.excessBreakMinutes)}</span> : null}
                {d.netDeficitMinutes > 0 ? <span className="ml-1">· plandan {ssdd(d.netDeficitMinutes)} az</span> : null}
                {d.netSurplusMinutes > 0 ? <span className="ml-1">· plandan {ssdd(d.netSurplusMinutes)} fazla</span> : null}
              </p>
            ) : d.planned ? (
              <p className="text-xs text-muted-foreground">Mesai kaydı yok.</p>
            ) : null}
            {/* NASIL KAYDEDİLDİĞİ ayrı görünür (#11): o an basılan mola ile sonradan beyan edilen ya da
                gece kapatılan mola aynı şey değil. */}
            {d.retroEntryCount > 0 || d.autoClosedCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                {d.retroEntryCount > 0 ? `${d.retroEntryCount} mola sonradan girildi. ` : ''}
                {d.autoClosedCount > 0 ? `${d.autoClosedCount} mola gece otomatik kapatıldı.` : ''}
              </p>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
