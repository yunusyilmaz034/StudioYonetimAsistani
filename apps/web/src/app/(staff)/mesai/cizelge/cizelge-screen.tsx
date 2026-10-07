'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangleIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, FileTextIcon, PencilIcon, PrinterIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/ui/page-header'
import { domainErrorMessage } from '@/lib/domain-error'
import { correctBreakAction } from '@/server/actions/shift'
import { generateWeekTimesheetsAction, signTimesheetAction } from '@/server/actions/timesheet'
import type { BreakRow, SheetContent, TimesheetRow, TimesheetWeekView } from '@/server/timesheet-query'

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
        view.rows.map((r) => (
          <KisiKarti key={r.staffUserId} row={r} weekStart={view.weekStart} onDegisti={() => start(() => router.refresh())} />
        ))
      )}
    </main>
  )
}

const saat = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })

const KAYNAK: Record<BreakRow['source'], string | null> = {
  live: null,
  retro_entry: 'sonradan girildi',
  auto_closed: 'otomatik kapatıldı',
}

function KisiKarti({ row, weekStart, onDegisti }: { row: TimesheetRow; weekStart: string; onDegisti: () => void }) {
  const s = row.canli
  const k = row.kayitli
  const [duzeltilen, setDuzeltilen] = useState<BreakRow | null>(null)
  // İMZA GERİ ALINAMAZ; o yüzden tek dokunuşla değil, iki adımda. Yanlış işaretlenmiş bir imzanın
  // çaresi yeni bir sürüm üretmek olurdu — bir parmak kayması için fazla pahalı.
  const [imzaOnay, setImzaOnay] = useState(false)
  const [busy, setBusy] = useState(false)

  async function imzala() {
    setBusy(true)
    try {
      const res = await signTimesheetAction({ weekStart, staffUserId: row.staffUserId })
      if (res.ok) {
        toast.success(`${row.displayName}: imza alındı olarak işaretlendi.`)
        setImzaOnay(false)
        onDegisti()
      } else {
        toast.error(domainErrorMessage(res.error as Parameters<typeof domainErrorMessage>[0]))
      }
    } catch {
      toast.error('İşaretlenemedi. Bağlantınızı kontrol edin.')
    } finally {
      setBusy(false)
    }
  }
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

      <GunListesi sheet={s} molalar={row.molalar} onDuzelt={setDuzeltilen} />

      {/* ISLAK İMZA (OR-119 · Faz 7): kâğıt dosyada, burada yalnızca ALINDIĞI işaretlenir — böylece
          "hangi hafta imzalanmadı" sorulabilir. İşaret kayıtlı en yeni sürüme konur. */}
      {k !== null && k.signedAt === null ? (
        imzaOnay ? (
          <div className="space-y-2 rounded-lg bg-muted p-3">
            <p className="text-sm text-foreground">
              Sürüm {k.version} kâğıdı {row.displayName} tarafından imzalandı mı? Bu işaret geri alınamaz.
            </p>
            {!row.guncel ? (
              <p className="text-xs font-medium text-warning">
                Dikkat: kayıt bu sürümden sonra değişti. İmzalanan kâğıt güncel sayıları göstermiyor olabilir.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-11" disabled={busy} onClick={() => void imzala()}>
                <CheckIcon className="size-4" />
                Evet, imzalandı
              </Button>
              <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setImzaOnay(false)}>
                Vazgeç
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="min-h-11 w-full" onClick={() => setImzaOnay(true)}>
            <CheckIcon className="size-4" />
            İmza alındı olarak işaretle
          </Button>
        )
      ) : null}

      <MolaDuzeltDialog
        mola={duzeltilen}
        kisi={row.displayName}
        onKapat={() => setDuzeltilen(null)}
        onDuzeltildi={() => {
          setDuzeltilen(null)
          onDegisti()
        }}
      />

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

function GunListesi({
  sheet,
  molalar,
  onDuzelt,
}: {
  sheet: SheetContent
  molalar: readonly BreakRow[]
  onDuzelt: (m: BreakRow) => void
}) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {sheet.days.map((d) => {
        const hareket = d.actualPresenceMinutes > 0 || d.actualBreakMinutes > 0
        const gununMolalari = molalar.filter((m) => m.date === d.date)
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
            {/* TEK TEK MOLALAR — masanın düzeltebildiği şey. Her biri kendi kaydı; düzeltme sebep ister
                ve öncesi/sonrası kayda geçer. Açık kalmış mola da buradan kapatılır. */}
            {gununMolalari.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5 pt-1">
                {gununMolalari.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => onDuzelt(m)}
                      aria-label={`Molayı düzelt: ${saat(m.startedAt)}–${m.endedAt === null ? 'açık' : saat(m.endedAt)}`}
                      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs tabular-nums ${
                        m.endedAt === null ? 'bg-warning/10 font-medium text-warning' : 'bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {saat(m.startedAt)}–{m.endedAt === null ? 'açık' : saat(m.endedAt)}
                      {KAYNAK[m.source] ? <span>· {KAYNAK[m.source]}</span> : null}
                      <PencilIcon className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
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

/**
 * Masadan mola düzeltmesi (OR-119): patron ve resepsiyon, SEBEP ZORUNLU. Saat değişir, gün
 * değişmez — hangi günün o saati olduğunu sunucu molanın kendisinden biliyor.
 *
 * Çizelge üretildiyse düzeltme onu DEĞİŞTİRMEZ: kart "kayıt sonradan değişti" der ve yeniden
 * üretmek yeni, imzasız bir sürüm verir.
 */
function MolaDuzeltDialog({
  mola,
  kisi,
  onKapat,
  onDuzeltildi,
}: {
  mola: BreakRow | null
  kisi: string
  onKapat: () => void
  onDuzeltildi: () => void
}) {
  return (
    <Dialog open={mola !== null} onOpenChange={(o) => !o && onKapat()}>
      {/* İçerik molaya göre ANAHTARLANIYOR: başka bir mola açıldığında alanlar öncekinin saatleriyle kalmasın. */}
      {mola ? <MolaDuzeltIcerik key={mola.id} mola={mola} kisi={kisi} onKapat={onKapat} onDuzeltildi={onDuzeltildi} /> : null}
    </Dialog>
  )
}

function MolaDuzeltIcerik({
  mola,
  kisi,
  onKapat,
  onDuzeltildi,
}: {
  mola: BreakRow
  kisi: string
  onKapat: () => void
  onDuzeltildi: () => void
}) {
  const ilkBas = saat(mola.startedAt)
  const ilkBit = mola.endedAt === null ? '' : saat(mola.endedAt)
  const [bas, setBas] = useState(ilkBas)
  const [bit, setBit] = useState(ilkBit)
  const [sebep, setSebep] = useState('')
  const [busy, setBusy] = useState(false)
  const degisti = bas !== ilkBas || bit !== ilkBit
  // Kapanmış bir mola buradan yeniden AÇILAMAZ: bitişi silmek, gözlenmiş bir bitişi yok saymak olurdu.
  const eksik = bas === '' || (mola.endedAt !== null && bit === '')

  async function kaydet() {
    setBusy(true)
    try {
      const res = await correctBreakAction({ breakId: mola.id, startTime: bas, endTime: bit === '' ? null : bit, reason: sebep.trim() })
      if (res.ok) {
        toast.success('Mola düzeltildi.')
        onDuzeltildi()
      } else {
        const code = (res.error as { code?: string }).code
        toast.error(
          code === 'invalid_time_range'
            ? 'Bitiş saati başlangıçtan sonra olmalı.'
            : code === 'no_open_break'
              ? 'Bu mola kaydı bulunamadı. Sayfayı yenileyin.'
              : domainErrorMessage(res.error as Parameters<typeof domainErrorMessage>[0]),
        )
      }
    } catch {
      toast.error('Düzeltilemedi. Bağlantınızı kontrol edin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Molayı düzelt</DialogTitle>
        <DialogDescription>
          {kisi} · {gunKisa(mola.date)}. Eski ve yeni saat, kimin ve neden değiştirdiği kayda geçer.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Başlangıç
          <Input type="time" value={bas} onChange={(e) => setBas(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Bitiş
          <Input type="time" value={bit} onChange={(e) => setBit(e.target.value)} />
        </label>
      </div>
      {mola.endedAt === null ? (
        <p className="text-xs text-muted-foreground">Bu mola açık kalmış. Bitiş saatini yazarsanız kapanır.</p>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        Sebep
        <Textarea value={sebep} onChange={(e) => setSebep(e.target.value)} placeholder="Ör. Molayı bitirmeyi unutmuş, 14:00'te dönmüştü" maxLength={300} />
      </label>
      <DialogFooter>
        <Button variant="outline" onClick={onKapat} disabled={busy}>
          Vazgeç
        </Button>
        <Button disabled={busy || eksik || !degisti || sebep.trim() === ''} onClick={() => void kaydet()}>
          Kaydet
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
