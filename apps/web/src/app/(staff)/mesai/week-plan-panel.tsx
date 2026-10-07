'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangleIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, Loader2Icon, PlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { minimumBreakMinutes } from '@studio/core'
import type { DomainError, ShiftBlock, WeekPlanEntries } from '@studio/core'

import { shiftDate } from '@/components/calendar/date-utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  approveWeekPlanAction,
  loadWeekPlanEditorAction,
  returnWeekPlanAction,
  saveWeekPlanDraftAction,
  setShiftPlanMembershipAction,
  submitWeekPlanAction,
  type WeekPlanEditorView,
} from '@/server/actions/week-plan'

// ── HAFTALIK VARDİYA PLANI (owner, 2026-09-14 · OR-77) ─────────────────────────────────────
//
// Owner'ın onayladığı taslak: masaüstünde satırlar personel, sütunlar günler; telefonda aynı veri gün
// gün açılır. Resepsiyon hücreye saat yazar, "Onaya gönder" der; owner "Onayla" ya da sebebiyle "Geri
// gönder". Personel yalnızca yayındaki planı görür — bu panel değil, Mesai'deki "Haftam" kartı.
//
// İZİNLİ GÜNE SAAT YAZILABİLİR, ama hücre uyarır (OR-77): karar resepsiyonun ve owner'ın.

const TUR: Record<string, string> = { izin: 'İzinli', rapor: 'Raporlu', egitim: 'Eğitimde', diger: 'Yok' }
const DURUM: Record<string, { label: string; className: string }> = {
  draft: { label: 'Taslak', className: 'bg-muted text-muted-foreground' },
  submitted: { label: 'Onay bekliyor', className: 'bg-warning/15 text-warning' },
  published: { label: 'Yayında', className: 'bg-success/10 text-success' },
}

const gunKisa = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
const gunUzun = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const haftaEtiketi = (w: string) => {
  const son = shiftDate(w, 6)
  const f = (d: string, ay: boolean) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('tr-TR', ay ? { day: 'numeric', month: 'long', timeZone: 'UTC' } : { day: 'numeric', timeZone: 'UTC' })
  return `${f(w, w.slice(5, 7) !== son.slice(5, 7))} – ${f(son, true)}`
}

const blokYazi = (b: ShiftBlock | undefined) => (b ? `${b.start}–${b.end}` : '—')
const ayni = (a: WeekPlanEntries, b: WeekPlanEntries) => JSON.stringify(sirala(a)) === JSON.stringify(sirala(b))
function sirala(e: WeekPlanEntries): WeekPlanEntries {
  return Object.fromEntries(
    Object.keys(e)
      .sort()
      .filter((s) => Object.keys(e[s] ?? {}).length > 0)
      .map((s) => [s, Object.fromEntries(Object.keys(e[s]!).sort().map((d) => [d, e[s]![d]!]))]),
  )
}

type Hucre = { staffId: string; date: string }

export function WeekPlanPanel({ initialWeek }: { initialWeek: string }) {
  const [weekStart, setWeekStart] = useState(initialWeek)
  const [view, setView] = useState<WeekPlanEditorView | null>(null)
  const [entries, setEntries] = useState<WeekPlanEntries>({})
  const [busy, setBusy] = useState(false)
  const [duzenlenen, setDuzenlenen] = useState<Hucre | null>(null)
  const [geriGonder, setGeriGonder] = useState(false)

  const yukle = useCallback(async (w: string) => {
    setView(null)
    try {
      const v = await loadWeekPlanEditorAction({ weekStart: w })
      setView(v)
      setEntries(v.draft)
    } catch {
      toast.error('Vardiya planı yüklenemedi.')
    }
  }, [])

  useEffect(() => {
    void yukle(weekStart)
  }, [weekStart, yukle])

  const kirli = view !== null && !ayni(entries, view.draft)
  const gecmis = view !== null && shiftDate(view.weekStart, 6) < view.today

  const setBlok = (h: Hucre, b: ShiftBlock | null) =>
    setEntries((prev) => {
      const kisi = { ...(prev[h.staffId] ?? {}) }
      if (b) kisi[h.date] = b
      else delete kisi[h.date]
      return { ...prev, [h.staffId]: kisi }
    })

  async function calistir(f: () => Promise<{ ok: true } | { ok: false; error: DomainError }>, basari: string) {
    setBusy(true)
    try {
      const r = await f()
      if (r.ok) {
        toast.success(basari)
        await yukle(weekStart)
        return true
      }
      toast.error(domainErrorMessage(r.error))
    } catch {
      toast.error('İşlem yapılamadı. Bağlantınızı kontrol edin.')
    } finally {
      setBusy(false)
    }
    return false
  }

  const kaydet = () => calistir(() => saveWeekPlanDraftAction({ weekStart, entries }), 'Taslak kaydedildi.')

  async function onayaGonder() {
    // Tek tıklama: kaydedilmemiş değişiklik varsa önce kaydeder, sonra gönderir.
    if (kirli) {
      const r = await saveWeekPlanDraftAction({ weekStart, entries }).catch(() => null)
      if (!r || !r.ok) {
        toast.error(r ? domainErrorMessage(r.error) : 'Taslak kaydedilemedi.')
        return
      }
    }
    await calistir(() => submitWeekPlanAction({ weekStart }), 'Plan onaya gönderildi.')
  }

  async function gecenHaftayiKopyala() {
    try {
      const onceki = await loadWeekPlanEditorAction({ weekStart: shiftDate(weekStart, -7) })
      const kaynak = onceki.published ?? onceki.draft
      const kopya: Record<string, Record<string, ShiftBlock>> = {}
      for (const [sid, gunler] of Object.entries(kaynak)) {
        kopya[sid] = Object.fromEntries(Object.entries(gunler).map(([d, b]) => [shiftDate(d, 7), b]))
      }
      if (Object.keys(kopya).length === 0) {
        toast.error('Geçen hafta için kayıtlı bir plan yok.')
        return
      }
      setEntries(kopya)
      toast.success('Geçen haftanın saatleri kopyalandı. Kontrol edip kaydedin.')
    } catch {
      toast.error('Geçen hafta yüklenemedi.')
    }
  }

  const hucre = (h: Hucre) => {
    if (!view) return null
    const b = entries[h.staffId]?.[h.date]
    const izin = view.leaveDays[h.staffId]?.[h.date]
    const yayinda = view.published?.[h.staffId]?.[h.date]
    const degisti = view.published !== null && blokYazi(b) !== blokYazi(yayinda)
    return (
      <button
        type="button"
        disabled={gecmis || busy}
        onClick={() => setDuzenlenen(h)}
        title={degisti ? `Yayındaki: ${blokYazi(yayinda)}` : undefined}
        className={`flex min-h-10 w-full flex-col items-center justify-center rounded-md border px-1.5 py-1 text-xs tabular-nums transition-colors disabled:cursor-default ${
          b ? 'border-border bg-card text-foreground hover:bg-muted' : 'border-dashed border-border text-muted-foreground hover:bg-muted'
        } ${degisti ? 'ring-2 ring-warning/60' : ''}`}
      >
        <span className="font-medium">{blokYazi(b)}</span>
        {izin ? (
          <span className={`inline-flex items-center gap-0.5 ${b ? 'text-danger' : 'text-muted-foreground'}`}>
            {b ? <AlertTriangleIcon className="size-3" /> : null}
            {TUR[izin] ?? 'İzinli'}
          </span>
        ) : null}
      </button>
    )
  }

  const durum = view?.status ? DURUM[view.status] : null
  const bekleyenDegisiklik = view !== null && view.published !== null && view.status !== 'published'

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Haftalık vardiya planı</h2>
          <p className="text-lg font-semibold text-foreground">{haftaEtiketi(weekStart)}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-9" aria-label="Önceki hafta" onClick={() => setWeekStart(shiftDate(weekStart, -7))}>
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button variant="outline" size="icon" className="size-9" aria-label="Sonraki hafta" onClick={() => setWeekStart(shiftDate(weekStart, 7))}>
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
      </div>

      {view === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {durum ? <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${durum.className}`}>{durum.label}</span> : null}
            {view.published !== null ? (
              <span className="text-xs text-muted-foreground">
                {bekleyenDegisiklik ? 'Personel yayındaki planı görüyor; değişiklikler onay bekliyor.' : `Personel bu planı görüyor · ${view.version}. sürüm`}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Henüz onaylanmadı — personel "plan onaylanmadı" görüyor.</span>
            )}
          </div>

          {view.status === 'draft' && view.returnReason ? (
            <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
              <span className="font-medium">Owner geri gönderdi:</span> {view.returnReason}
            </p>
          ) : null}
          {gecmis ? <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Bu hafta geçti; plan değiştirilemez.</p> : null}
          {view.staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">Planlanacak aktif resepsiyon ya da eğitmen yok.</p>
          ) : (
            <>
              {/* MASAÜSTÜ — satırlar personel, sütunlar günler. */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[720px] border-separate border-spacing-1 text-sm">
                  <thead>
                    <tr>
                      <th className="w-36" />
                      {view.dates.map((d) => (
                        <th
                          key={d}
                          className={`px-1 pb-1 text-center text-xs font-medium ${d === view.today ? 'text-primary' : 'text-muted-foreground'}`}
                        >
                          {gunKisa(d)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {view.staff.map((s) => (
                      <tr key={s.id}>
                        <td className="truncate pr-2 text-sm font-medium text-foreground">{s.displayName}</td>
                        {view.dates.map((d) => (
                          <td key={d}>{hucre({ staffId: s.id, date: d })}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* TELEFON — aynı veri, gün gün. */}
              <div className="space-y-2 md:hidden">
                {view.dates.map((d) => {
                  const calisan = view.staff.filter((s) => entries[s.id]?.[d]).length
                  const izinli = view.staff.filter((s) => view.leaveDays[s.id]?.[d]).length
                  return (
                    <details key={d} className="rounded-lg border border-border" open={d === view.today}>
                      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 text-sm">
                        <span className="font-medium text-foreground">{gunUzun(d)}</span>
                        <span className="text-xs text-muted-foreground">
                          {calisan} kişi{izinli > 0 ? ` · ${izinli} izinli` : ''}
                        </span>
                      </summary>
                      <ul className="divide-y divide-border border-t border-border">
                        {view.staff.map((s) => (
                          <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
                            <span className="min-w-0 truncate text-sm">{s.displayName}</span>
                            <div className="w-32 shrink-0">{hucre({ staffId: s.id, date: d })}</div>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )
                })}
              </div>
            </>
          )}

          {/* KİM PLANLANIR (owner, 2026-09-14): *"resepsiyon ve ışıl hocayı kaldıralım."* Yalnızca owner; ortak
              resepsiyon hesabı ya da owner'ın eğitmen hesabı gibi planlanmayanlar tablodan çıkar, burada geri eklenir. */}
          {view.canApprove && (view.staff.some((s) => s.inPlan) || view.hidden.length > 0) ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Planda:</span>
              {view.staff
                .filter((s) => s.inPlan)
                .map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2 pr-0.5 text-foreground">
                    {s.displayName}
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`${s.displayName} plandan çıkar`}
                      title="Plandan çıkar"
                      onClick={() =>
                        void calistir(() => setShiftPlanMembershipAction({ staffUserId: s.id, included: false }), `${s.displayName} planda artık gösterilmiyor.`)
                      }
                      className="inline-flex size-6 items-center justify-center rounded-full hover:bg-background disabled:opacity-50"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </span>
                ))}
              {view.hidden.length > 0 ? (
                <>
                  <span className="ml-2 text-muted-foreground">Gösterilmeyenler:</span>
                  {view.hidden.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={busy}
                      title="Plana geri ekle"
                      onClick={() =>
                        void calistir(() => setShiftPlanMembershipAction({ staffUserId: s.id, included: true }), `${s.displayName} plana eklendi.`)
                      }
                      className="inline-flex min-h-6 items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <PlusIcon className="size-3" />
                      {s.displayName}
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}

          {!gecmis ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void gecenHaftayiKopyala()}>
                <CopyIcon /> Geçen haftayı kopyala
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                {kirli ? <span className="text-xs text-warning">Kaydedilmemiş değişiklik var</span> : null}
                <Button variant="outline" disabled={busy || !kirli} onClick={() => void kaydet()}>
                  Kaydet
                </Button>
                {view.status === 'submitted' && !kirli ? (
                  view.canApprove ? (
                    <>
                      <Button variant="outline" disabled={busy} onClick={() => setGeriGonder(true)}>
                        Geri gönder
                      </Button>
                      <Button disabled={busy} onClick={() => void calistir(() => approveWeekPlanAction({ weekStart }), 'Plan onaylandı ve yayına çıktı.')}>
                        {busy ? <Loader2Icon className="animate-spin" /> : null} Onayla
                      </Button>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">Owner onayı bekleniyor.</span>
                  )
                ) : (
                  <Button disabled={busy || (!kirli && view.status !== 'draft')} onClick={() => void onayaGonder()}>
                    {busy ? <Loader2Icon className="animate-spin" /> : null} Onaya gönder
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </>
      )}

      <HucreDuzenle
        acik={duzenlenen}
        adi={duzenlenen && view ? (view.staff.find((s) => s.id === duzenlenen.staffId)?.displayName ?? '') : ''}
        blok={duzenlenen ? entries[duzenlenen.staffId]?.[duzenlenen.date] : undefined}
        izin={duzenlenen && view ? view.leaveDays[duzenlenen.staffId]?.[duzenlenen.date] : undefined}
        hafta={view?.dates ?? []}
        limits={view?.limits ?? null}
        digerNet={digerGunlerNet(entries, duzenlenen)}
        onKapat={() => setDuzenlenen(null)}
        onKaydet={(b, haftaIci) => {
          if (!duzenlenen || !view) return
          const hedef = haftaIci ? view.dates.slice(0, 5) : [duzenlenen.date]
          for (const date of hedef) setBlok({ staffId: duzenlenen.staffId, date }, b)
          setDuzenlenen(null)
        }}
      />

      <Dialog open={geriGonder} onOpenChange={(o) => !o && setGeriGonder(false)}>
        <GeriGonderIcerik
          busy={busy}
          onVazgec={() => setGeriGonder(false)}
          onGonder={async (sebep) => {
            const ok = await calistir(() => returnWeekPlanAction({ weekStart, reason: sebep }), 'Plan resepsiyona geri gönderildi.')
            if (ok) setGeriGonder(false)
          }}
        />
      </Dialog>
    </Card>
  )
}

// Canlı İPUCU hesabı (OR-119). Yetki çekirdekte: kaydetme yine `decideSaveWeekPlanDraft`'tan geçiyor
// ve reddi o veriyor. Buradaki tek iş, resepsiyonun sınırı KAYDETMEYE BASMADAN görmesi.
const dkSaat = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const blokNet = (b: ShiftBlock) => Math.max(0, dkSaat(b.end) - dkSaat(b.start) - (b.breakMinutes ?? 0))
const sureMetni = (dk: number) => `${String(Math.floor(dk / 60)).padStart(2, '0')}:${String(dk % 60).padStart(2, '0')}`

/** Düzenlenen gün HARİÇ, o personelin o haftaki net toplamı. */
function digerGunlerNet(entries: Readonly<Record<string, Readonly<Record<string, ShiftBlock>>>>, h: Hucre | null): number {
  if (!h) return 0
  let n = 0
  for (const [d, b] of Object.entries(entries[h.staffId] ?? {})) if (d !== h.date) n += blokNet(b)
  return n
}

function HucreDuzenle({
  acik,
  adi,
  blok,
  izin,
  hafta,
  limits,
  digerNet,
  onKapat,
  onKaydet,
}: {
  acik: Hucre | null
  adi: string
  blok: ShiftBlock | undefined
  izin: string | undefined
  hafta: readonly string[]
  limits: WeekPlanEditorView['limits']
  digerNet: number
  onKapat: () => void
  onKaydet: (b: ShiftBlock | null, haftaIci: boolean) => void
}) {
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('17:00')
  // BOŞ dizge = "mola yazılmamış", '0' = "sıfır mola planlandı". İkisi aynı şey değil ve bu ayrım
  // domain'e kadar korunuyor; boşsa alan hiç gönderilmiyor.
  const [mola, setMola] = useState('')

  useEffect(() => {
    if (acik) {
      setStart(blok?.start ?? '09:00')
      setEnd(blok?.end ?? '17:00')
      setMola(blok?.breakMinutes === undefined ? '' : String(blok.breakMinutes))
    }
  }, [acik, blok])

  const saatHatali = useMemo(() => !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || end <= start, [start, end])
  const brut = saatHatali ? 0 : dkSaat(end) - dkSaat(start)
  const molaDk = mola.trim() === '' ? 0 : Number(mola)
  const molaHatali = mola.trim() !== '' && (!Number.isInteger(molaDk) || molaDk < 0 || molaDk >= brut)
  const hatali = saatHatali || molaHatali
  const net = Math.max(0, brut - molaDk)
  // Kademe sorgusu AYARDAN gelen veriyle yapılıyor; kademeler burada yazılı değil (#4).
  const gerekli = limits ? minimumBreakMinutes(net, limits.breakTiers) : null
  const molaAz = gerekli !== null && mola.trim() !== '' && molaDk < gerekli
  const haftaNet = digerNet + net
  const haftaAsim = limits !== null && haftaNet > limits.legalNormalWeeklyMaxMinutes
  const gunAsim = limits !== null && net > limits.dailyNetMaxMinutes
  const blokKur = (): ShiftBlock => (mola.trim() === '' ? { start, end } : { start, end, breakMinutes: molaDk })
  const haftaIciMi = acik !== null && hafta.slice(0, 5).includes(acik.date)

  return (
    <Dialog open={acik !== null} onOpenChange={(o) => !o && onKapat()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{adi}</DialogTitle>
          <DialogDescription>{acik ? gunUzun(acik.date) : ''}</DialogDescription>
        </DialogHeader>
        {izin ? (
          <p className="flex items-start gap-2 rounded-lg bg-danger/10 p-3 text-sm text-danger">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            Bu gün onaylı izni var ({(TUR[izin] ?? 'izinli').toLocaleLowerCase('tr')}). Saat yazarsanız plan izinle çelişir.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Giriş
            <Input type="time" value={start} step={300} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Çıkış
            <Input type="time" value={end} step={300} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Mola (dakika)
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            step={5}
            value={mola}
            placeholder={gerekli === null ? 'Örn. 60' : `En az ${gerekli}`}
            onChange={(e) => setMola(e.target.value)}
          />
        </label>
        {saatHatali ? <p className="text-xs text-danger">Çıkış saati girişten sonra olmalı.</p> : null}
        {molaHatali ? <p className="text-xs text-danger">Mola tam dakika olmalı ve mesainin kendisinden kısa olmalı.</p> : null}
        {limits && !saatHatali ? (
          <div className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed">
            <p>
              Net çalışma <strong>{sureMetni(net)}</strong>
              {gerekli !== null ? <> · bu süre için en az <strong>{gerekli} dk</strong> mola</> : null}
            </p>
            <p className={haftaAsim ? 'text-danger' : 'text-muted-foreground'}>
              Bu haftanın net toplamı <strong>{sureMetni(haftaNet)}</strong> / {sureMetni(limits.legalNormalWeeklyMaxMinutes)}
            </p>
            {mola.trim() === '' ? <p className="text-muted-foreground">Mola yazılmadı — plan kaydedilirken reddedilir.</p> : null}
            {molaAz ? <p className="text-danger">Mola kademenin altında; plan kaydedilemez.</p> : null}
            {gunAsim ? <p className="text-danger">Günlük net sınır {sureMetni(limits.dailyNetMaxMinutes)} — aşıldı.</p> : null}
          </div>
        ) : null}
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => onKaydet(null, false)}>
            Çalışmıyor
          </Button>
          <div className="flex flex-wrap gap-2">
            {haftaIciMi ? (
              <Button variant="outline" disabled={hatali} onClick={() => onKaydet(blokKur(), true)}>
                Hafta içi her güne
              </Button>
            ) : null}
            <Button disabled={hatali} onClick={() => onKaydet(blokKur(), false)}>
              Tamam
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GeriGonderIcerik({ busy, onVazgec, onGonder }: { busy: boolean; onVazgec: () => void; onGonder: (sebep: string) => Promise<void> }) {
  const [sebep, setSebep] = useState('')
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Planı geri gönder</DialogTitle>
        <DialogDescription>Resepsiyon sebebi görecek, düzeltip yeniden gönderecek. Yayındaki plan değişmez.</DialogDescription>
      </DialogHeader>
      <Textarea value={sebep} onChange={(e) => setSebep(e.target.value)} placeholder="Ör. Pazartesi sabah resepsiyon eksik" maxLength={300} />
      <DialogFooter>
        <Button variant="outline" onClick={onVazgec} disabled={busy}>
          Vazgeç
        </Button>
        <Button disabled={busy || sebep.trim() === ''} onClick={() => void onGonder(sebep.trim())}>
          {busy ? <Loader2Icon className="animate-spin" /> : null} Geri gönder
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
