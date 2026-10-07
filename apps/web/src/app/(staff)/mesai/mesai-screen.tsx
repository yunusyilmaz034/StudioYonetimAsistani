'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CameraIcon, CheckCircle2Icon, ChevronLeftIcon, ChevronRightIcon, CoffeeIcon, LogInIcon, LogOutIcon, PlayIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { shiftDate } from '@/components/calendar/date-utils'
import { PageHeader } from '@/components/ui/page-header'
import { QrScanner } from '@/components/qr-scanner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { domainErrorMessage } from '@/lib/domain-error'
import { endBreakAction, endShiftAction, staffCrossTurnstileAction, startBreakAction, startShiftAction } from '@/server/actions/shift'
import { IzinPanel } from './izin-panel'
import type { ShiftView, StaffDayRow } from '@/server/shift-query'

// Tek ekran. Turnikesi olan stüdyoda tek bir eylem var — kapıdaki kodu okut — ve mesai ondan
// türetiliyor (OR-74). Turnikesi olmayan stüdyoda eski iki düğme duruyor: başlat / bitir.
//
// İKİSİ BİRDEN GÖSTERİLMİYOR, bilerek: 17:00'de elle biten bir mesai 17:02'deki çıkış geçişiyle
// yeniden açılır ve gün sonunda 0 dakikalık hayalet bir vardiya bırakırdı.

const saat = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })

const sure = (bas: number, bit: number | null): string => {
  const dk = Math.max(0, Math.floor(((bit ?? Date.now()) - bas) / 60_000))
  return dk < 60 ? `${dk} dk` : `${Math.floor(dk / 60)} sa ${dk % 60} dk`
}

/** Dakika → `SS:DD`. Plan ve toplam sayılar böyle okunuyor. */
const ssdd = (dk: number) => `${Math.floor(Math.max(0, dk) / 60)}:${String(Math.max(0, dk) % 60).padStart(2, '0')}`

/** Milisaniye → `SS:DD:SS`. Yalnızca CANLI mola sayacı için — saniye orada anlamlı. */
const sayac = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000))
  const s2 = (n: number) => String(n).padStart(2, '0')
  return `${s2(Math.floor(t / 3600))}:${s2(Math.floor((t % 3600) / 60))}:${s2(t % 60)}`
}

/**
 * MOLA VE NET HESABI — tek yerde, çünkü iki ekran aynı soruyu soruyor: eğitmenin kendi kartı ve
 * yöneticinin canlı listesi. İkisi ayrı ayrı hesaplasaydı aynı kişi için iki farklı net görünürdü.
 *
 * Mola çalışma süresine EKLENMEZ (OR-119): net = bulunma − mola, ve eksiye düşmez. Planlı süre
 * aşılırsa fark gizlenmez, "plan dışı" olarak ayrı yazılır.
 */
const molaHesabi = (bulunmaDk: number, kapanmisMolaDk: number, acikMolaMs: number, planliMolaDk: number | null) => {
  const kullanilanDk = kapanmisMolaDk + Math.floor(Math.max(0, acikMolaMs) / 60_000)
  return {
    kullanilanDk,
    netDk: Math.max(0, bulunmaDk - kullanilanDk),
    kalanPlanliDk: planliMolaDk === null ? null : Math.max(0, planliMolaDk - kullanilanDk),
    planDisiDk: planliMolaDk === null ? 0 : Math.max(0, kullanilanDk - planliMolaDk),
  }
}

/** Kod hataları üye ekranı için yazılmış ("üyeden kodu yenilemesini isteyin"); burada okutan kişi kendisi. */
const kodHatasi = (code: string | undefined): string | null => {
  switch (code) {
    case 'qr_invalid':
      return 'Bu bir turnike kodu değil. Kapıdaki ekranın kodunu okutun.'
    case 'qr_expired':
      return 'Kodun süresi doldu. Ekrandaki yeni kodu okutun.'
    case 'qr_used':
      return 'Bu kod az önce kullanıldı. Ekrandaki yeni kodu okutun.'
    default:
      return null
  }
}

/** 'YYYY-MM-DD' → "14 Eylül Pazartesi". Öğlen UTC: hiçbir saat dilimi günü kaydıramaz. */
const gunBasligi = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC' })

export function MesaiScreen({ view, ownerMu, bugun }: { view: ShiftView; ownerMu: boolean; bugun: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [sonuc, setSonuc] = useState<{ ok: boolean; text: string } | null>(null)
  // jsQR aynı kareyi saniyede birkaç kez çözüyor; ilk istek dönmeden ikincisi gitmesin.
  const busyRef = useRef(false)
  const acik = view.benimAcik
  const molam = view.molam

  // ── CANLI SAYAÇ (owner §11) ────────────────────────────────────────────────────────────────
  //
  // Saniye TARAYICIDA dönüyor; sunucuya saniyede bir ne yazılıyor ne okunuyor. Sunucudan gelen tek
  // şey başlangıç zamanları — geri kalanı buradan hesaplanıyor. Açık mesai yoksa sayaç hiç dönmüyor:
  // sayacak bir şey olmadığında her saniye yeniden render etmek bedava değil.
  const [simdi, setSimdi] = useState<number>(() => Date.now())
  //
  // Yöneticinin listesi de aynı saati kullanıyor (OR-119): owner'ın kendi mesaisi olmasa da, bugün
  // sayan bir vardiya ya da açık bir mola varsa saat dönmeli. Geçmiş bir gün hiç saymıyor.
  const canliListe =
    ownerMu && view.tarih === bugun && view.gunluk.some((p) => p.bulunmaAcikBaslangic !== null || p.molaAcikBaslangic !== null)
  const saatDonsun = acik !== null || canliListe
  useEffect(() => {
    if (!saatDonsun) return
    setSimdi(Date.now())
    const iv = window.setInterval(() => setSimdi(Date.now()), 1000)
    return () => window.clearInterval(iv)
  }, [saatDonsun])

  const molada = molam.acikBaslangic !== null
  const acikMolaMs = molada ? Math.max(0, simdi - molam.acikBaslangic!) : 0
  const bulunmaDk = acik ? Math.max(0, Math.floor((simdi - acik.startedAt) / 60_000)) : 0
  const { kullanilanDk, netDk, kalanPlanliDk, planDisiDk } = molaHesabi(bulunmaDk, molam.kapanmisDk, acikMolaMs, molam.planliDk)

  /**
   * YÖNETİCİ CANLI DURUMU (OR-119) — bir satırın o anki hâli. Yalnızca görünürlük: buradaki hiçbir
   * sayı bir kesintiye, bir cezaya ya da bordroya gitmiyor.
   *
   * Geçmiş bir günde açık kalmış mola SAYILMIYOR: bitişi gözlenmemiş bir molanın uzunluğu
   * bilinmiyor, ve bilinmeyen bir süreyi kullanılmış gibi yazmak #11'in yasakladığı şey. Bugün
   * ise geçen süre gözlemin kendisi — eğitmenin kendi kartı da aynısını sayıyor.
   */
  const canli = (p: StaffDayRow) => {
    const bugunMu = view.tarih === bugun
    const molaMs = bugunMu && p.molaAcikBaslangic !== null ? Math.max(0, simdi - p.molaAcikBaslangic) : 0
    const akanDk = p.bulunmaAcikBaslangic === null ? 0 : Math.max(0, Math.floor((simdi - p.bulunmaAcikBaslangic) / 60_000))
    const durum: 'molada' | 'disarida' | 'calisiyor' | 'cikti' | null = !bugunMu
      ? null
      : p.molaAcikBaslangic !== null
        ? 'molada'
        : p.disarida
          ? 'disarida'
          : p.bulunmaAcikBaslangic !== null
            ? 'calisiyor'
            : p.shifts.length > 0
              ? 'cikti'
              : null
    return { durum, molaMs, ...molaHesabi(p.bulunmaKapaliDk + akanDk, p.molaKapanmisDk, molaMs, p.planliMolaDk) }
  }

  /** Molanın kendi çalıştırıcısı: vardiyanın toast metinleri ("Mesai başladı") moladakiyle aynı değil. */
  async function molaCalistir(f: () => Promise<{ ok: boolean; error?: unknown }>, basarili: string) {
    setBusy(true)
    try {
      const res = await f()
      if (res.ok) {
        toast.success(basarili)
        start(() => router.refresh())
      } else {
        toast.error(domainErrorMessage(res.error as Parameters<typeof domainErrorMessage>[0]))
      }
    } catch {
      toast.error('İşlem yapılamadı. Bağlantınızı kontrol edin.')
    } finally {
      setBusy(false)
    }
  }

  async function calistir(f: () => Promise<{ ok: boolean; error?: unknown }>) {
    setBusy(true)
    try {
      const res = await f()
      if (res.ok) {
        toast.success(acik ? 'Mesai bitti. İyi akşamlar!' : 'Mesai başladı. Kolay gelsin!')
        start(() => router.refresh())
      } else {
        toast.error(domainErrorMessage(res.error as Parameters<typeof domainErrorMessage>[0]))
      }
    } catch {
      toast.error('İşlem yapılamadı. Bağlantınızı kontrol edin.')
    } finally {
      setBusy(false)
    }
  }

  const okut = useCallback(
    async (value: string) => {
      if (busyRef.current) return
      busyRef.current = true
      try {
        const res = await staffCrossTurnstileAction({ code: value.trim() })
        if (res.ok) {
          setScanning(false)
          setSonuc({
            ok: true,
            text: res.value.shiftStarted
              ? `Kapı açıldı. Mesain ${saat(res.value.shiftStartedAt)}'de başladı — kolay gelsin!`
              : 'Kapı açıldı. Geçişin kaydedildi.',
          })
          start(() => router.refresh())
        } else {
          const code = (res.error as { code?: string }).code
          setSonuc({ ok: false, text: kodHatasi(code) ?? domainErrorMessage(res.error as Parameters<typeof domainErrorMessage>[0]) })
        }
      } catch {
        setSonuc({ ok: false, text: 'Geçiş kaydedilemedi. İnternet bağlantınızı kontrol edin.' })
      } finally {
        // Bir ret aynı kodu yeniden denemeye değer (ekran yenilenmiş olabilir); başarı kamerayı kapattı.
        window.setTimeout(() => {
          busyRef.current = false
        }, 2500)
      }
    },
    [router],
  )

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <PageHeader title="Mesai" description="Kendi giriş ve çıkış saatin." />

      <Card className="space-y-4 p-5">
        {acik ? (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Mesain sürüyor</p>
            <p className="text-2xl font-semibold tabular-nums">{saat(acik.startedAt)}&apos;den beri</p>
            <p className="text-sm text-muted-foreground">
              {sure(acik.startedAt, null)}
              {acik.lastCrossingAt !== null ? ` · son geçiş ${saat(acik.lastCrossingAt)}` : ''}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {view.turnikeVar ? 'Bugün henüz turnikeden geçmedin.' : 'Şu an açık bir mesain yok.'}
          </p>
        )}

        {view.turnikeVar ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Kapıdaki ekranın kodunu okut. Günün ilk geçişi mesaini başlatır; gün içinde istediğin kadar
              girip çıkabilirsin, son geçişin mesai çıkışın sayılır.
            </p>

            {sonuc ? (
              <div
                role="status"
                className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
                  sonuc.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                }`}
              >
                {sonuc.ok ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" /> : <XIcon className="mt-0.5 size-4 shrink-0" />}
                <span>{sonuc.text}</span>
              </div>
            ) : null}

            {scanning ? (
              <>
                <QrScanner
                  active
                  onScan={(v) => void okut(v)}
                  className="aspect-square w-full rounded-lg bg-black object-cover"
                  fallbackHint="Kamera açılmıyorsa resepsiyondan kapıyı açmasını isteyin."
                />
                <Button
                  variant="outline"
                  className="min-h-11 w-full"
                  onClick={() => {
                    setScanning(false)
                    busyRef.current = false
                  }}
                >
                  Kamerayı Kapat
                </Button>
              </>
            ) : (
              <Button
                size="lg"
                className="min-h-12 w-full"
                disabled={pending}
                onClick={() => {
                  setSonuc(null)
                  setScanning(true)
                }}
              >
                <CameraIcon className="size-5" />
                Turnike kodunu okut
              </Button>
            )}
          </div>
        ) : (
          <Button
            size="lg"
            className="min-h-12 w-full"
            variant={acik ? 'destructive' : 'default'}
            disabled={busy || pending}
            onClick={() => void calistir(acik ? endShiftAction : () => startShiftAction({}))}
          >
            {acik ? <LogOutIcon className="size-5" /> : <LogInIcon className="size-5" />}
            {acik ? 'Mesaiyi bitir' : 'Mesaiye başla'}
          </Button>
        )}

        {/* ── ARA DİNLENMESİ (owner, 2026-10-06/07 · OR-119) ──────────────────────────────────
            Turnike dalının DIŞINDA, bilerek: mola fiziksel giriş/çıkıştan ayrı bir kavram ve
            personelin kendi panelinden yönetiliyor (owner §10). Kapıdan geçmek bir gözlem,
            molaya çıkmak bir karar. */}
        <div className="space-y-3 border-t border-border pt-4">
          {molada ? (
            <div className="space-y-1">
              <p className="text-sm font-medium text-warning">MOLADASIN</p>
              <p className="text-3xl font-semibold tabular-nums" aria-live="off">
                {sayac(acikMolaMs)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {acik ? 'Çalışıyorsun.' : 'Mola için açık bir mesain olması gerekiyor.'}
            </p>
          )}

          {acik ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Gerçek net çalışma</dt>
              <dd className="text-right font-medium tabular-nums">{ssdd(netDk)}</dd>

              <dt className="text-muted-foreground">Kullanılan mola</dt>
              <dd className="text-right font-medium tabular-nums">
                {ssdd(kullanilanDk)}
                {molam.planliDk !== null ? <span className="text-muted-foreground"> / {ssdd(molam.planliDk)}</span> : null}
              </dd>

              {/* "Plan yok" ile "0 saat plan" aynı şey DEĞİL — biri bilgi eksikliği, öbürü bir karar. */}
              <dt className="text-muted-foreground">Kalan planlı mola</dt>
              <dd className="text-right font-medium tabular-nums">
                {kalanPlanliDk === null ? <span className="text-muted-foreground">plan yok</span> : ssdd(kalanPlanliDk)}
              </dd>

              {planDisiDk > 0 ? (
                <>
                  <dt className="text-warning">Plan dışı mola</dt>
                  <dd className="text-right font-medium tabular-nums text-warning">+{ssdd(planDisiDk)}</dd>
                </>
              ) : null}

              {molam.planNetDk !== null ? (
                <>
                  <dt className="text-muted-foreground">Planlanan net çalışma</dt>
                  <dd className="text-right tabular-nums text-muted-foreground">{ssdd(molam.planNetDk)}</dd>
                </>
              ) : null}

              {molam.planCikis !== null ? (
                <>
                  <dt className="text-muted-foreground">Planlanan çıkış</dt>
                  <dd className="text-right tabular-nums text-muted-foreground">{molam.planCikis}</dd>
                </>
              ) : null}
            </dl>
          ) : null}

          {/* Planlı süre dolsa da düğme KİLİTLENMİYOR (owner §5): gerçeği gizlemek için olay
              oluşmasını engellemek, ihlali kayıttan silmek olurdu. Fazlası "plan dışı" yazılıyor. */}
          <Button
            size="lg"
            className="min-h-12 w-full"
            variant={molada ? 'default' : 'outline'}
            disabled={busy || pending || !acik}
            onClick={() =>
              void molaCalistir(
                molada ? endBreakAction : startBreakAction,
                molada ? 'Mola bitti. Kolay gelsin!' : 'Mola başladı.',
              )
            }
          >
            {molada ? <PlayIcon className="size-5" /> : <CoffeeIcon className="size-5" />}
            {molada ? 'Molayı bitir' : 'Molaya başla'}
          </Button>
        </div>
      </Card>

      {/* HAFTAM (owner, 2026-09-14 · OR-77): *"personel de kendi ekranında bu mesai tablosunu görüp ben
          şu gün şu saatte gelip gitmeliyim diye bilsin."* Yalnızca YAYINDAKİ plan; taslak gösterilmez. */}
      {view.benimHaftam ? (
        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Haftam</h2>
          {view.benimHaftam.map((h, i) => (
            <div key={h.weekStart} className="space-y-2">
              <p className="text-sm font-medium text-foreground">{i === 0 ? 'Bu hafta' : 'Önümüzdeki hafta'}</p>
              {!h.published ? (
                <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Plan henüz onaylanmadı.</p>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {h.days.map((d) => (
                    <li
                      key={d.date}
                      className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${d.date === bugun ? 'bg-primary/5' : ''}`}
                    >
                      <span className={d.date === bugun ? 'font-semibold text-foreground' : 'text-foreground'}>{gunBasligi(d.date)}</span>
                      {d.block ? (
                        <span className="shrink-0 font-medium tabular-nums text-foreground">
                          {d.block.start}–{d.block.end}
                        </span>
                      ) : (
                        <span className="shrink-0 text-muted-foreground">{d.leave ? 'İzinli' : 'Çalışmıyorsun'}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </Card>
      ) : null}

      {/* İZİN, MESAİNİN YANINDA (owner onayı, 2026-09-11): ikisi de "kim ne zaman burada" sorusunun
          parçası. Ayrı bir ekrana koymak, izin isteyeni üçüncü bir yeri hatırlamaya zorlardı. */}
      <IzinPanel ownerMu={ownerMu} />

      {/* Günün listesi yalnızca owner'a. Bir hocanın bir başkasının saatini görmesi için sebep yok.
          GÜNLÜK GİRİŞ-ÇIKIŞLAR (owner, 2026-09-14 · OR-77): vardiya özetinin altında o günkü her geçiş.
          Özet "kaçta geldi, kaçta gitti"yi, geçişler "arada ne oldu"yu söyler. */}
      {ownerMu ? (
        <Card className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {view.tarih === bugun ? 'Bugün' : gunBasligi(view.tarih)}
            </h2>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-9"
                aria-label="Önceki gün"
                disabled={pending}
                onClick={() => start(() => router.push(`/mesai?gun=${shiftDate(view.tarih, -1)}`))}
              >
                <ChevronLeftIcon className="size-4" />
              </Button>
              <input
                type="date"
                aria-label="Gün seç"
                value={view.tarih}
                max={bugun}
                onChange={(e) => {
                  const d = e.target.value
                  if (d) start(() => router.push(d === bugun ? '/mesai' : `/mesai?gun=${d}`))
                }}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm tabular-nums text-foreground"
              />
              <Button
                variant="outline"
                size="icon"
                className="size-9"
                aria-label="Sonraki gün"
                // Gelecek gün yok: geçişi olmamış bir gün boş görünür ve "kimse gelmedi" diye okunur.
                disabled={pending || view.tarih >= bugun}
                onClick={() => {
                  const d = shiftDate(view.tarih, 1)
                  start(() => router.push(d === bugun ? '/mesai' : `/mesai?gun=${d}`))
                }}
              >
                <ChevronRightIcon className="size-4" />
              </Button>
            </div>
          </div>
          {view.gunluk.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {view.tarih === bugun ? 'Bugün henüz mesai kaydı yok.' : 'Bu gün mesai kaydı yok.'}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {view.gunluk.map((p) => {
                const c = canli(p)
                return (
                <li key={p.staffUserId} className="space-y-1.5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{p.displayName}</span>
                      {/* ŞU AN NE YAPIYOR (OR-119). `PRESENT + WORKING` ile `PRESENT + ON_BREAK` iki ayrı
                          durum; "dışarıda" ise yalnızca cihaz yönü bildirdiyse söyleniyor. */}
                      {c.durum === 'molada' ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium tabular-nums text-warning">
                          <CoffeeIcon className="size-3" />
                          Molada {sayac(c.molaMs)}
                        </span>
                      ) : c.durum === 'disarida' ? (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Dışarıda</span>
                      ) : c.durum === 'calisiyor' ? (
                        <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">Çalışıyor</span>
                      ) : c.durum === 'cikti' ? (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Çıktı</span>
                      ) : null}
                    </span>
                    {p.shifts.map((s) => (
                      <span key={s.id} className="shrink-0 text-sm tabular-nums text-muted-foreground">
                        {saat(s.startedAt)} → {s.endedAt === null ? 'sürüyor' : saat(s.endedAt)}
                        <span className="ml-2 text-xs">({sure(s.startedAt, s.endedAt)})</span>
                        {/* Açıkken son geçiş: gece 23:00'te mesai TAM BU SAATE kapanacak. Owner bunu gün
                            içinde görebilmeli, sabah şaşırmamalı. */}
                        {s.endedAt === null && s.lastCrossingAt !== null ? (
                          <span className="ml-2 text-xs">· son geçiş {saat(s.lastCrossingAt)}</span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                  {/* PLAN İLE GERÇEKLEŞEN (OR-77): yalnızca görünür — kesinti, ceza, puantaj yok. */}
                  {p.planned ? (
                    <p className="text-xs tabular-nums text-muted-foreground">
                      Plan {p.planned.start}–{p.planned.end}
                      {p.absent ? <span className="ml-1 font-medium text-danger">· gelmedi</span> : null}
                      {p.lateMinutes ? <span className="ml-1 font-medium text-warning">· {p.lateMinutes} dk geç</span> : null}
                      {p.earlyMinutes ? <span className="ml-1 font-medium text-warning">· {p.earlyMinutes} dk erken çıktı</span> : null}
                    </p>
                  ) : null}
                  {/* NET VE MOLA (OR-119): plan varsa yanında, yoksa yalnızca gerçekleşen. Plan aşılırsa
                      sistem engellemez, farkı yazar. Hiç vardiyası olmayanın sayacak bir şeyi yok. */}
                  {p.shifts.length > 0 ? (
                    <p className="text-xs tabular-nums text-muted-foreground">
                      Net {ssdd(c.netDk)}
                      {p.planNetDk !== null ? ` / ${ssdd(p.planNetDk)}` : ''}
                      <span className="ml-1">
                        · Mola {ssdd(c.kullanilanDk)}
                        {p.planliMolaDk !== null ? ` / ${ssdd(p.planliMolaDk)}` : ''}
                      </span>
                      {c.planDisiDk > 0 ? <span className="ml-1 font-medium text-warning">· plan dışı +{ssdd(c.planDisiDk)}</span> : null}
                      {view.tarih !== bugun && p.molaAcikBaslangic !== null ? (
                        <span className="ml-1 font-medium text-warning">
                          · {saat(p.molaAcikBaslangic)}&apos;de başlayan mola kapanmamış, sayılmadı
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  {p.crossings.length > 0 ? (
                    <ol className="flex flex-wrap gap-1.5" aria-label={`${p.displayName} turnike geçişleri`}>
                      {p.crossings.map((c, i) => (
                        <li
                          key={`${c.at}-${i}`}
                          title={c.deviceName ?? undefined}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs tabular-nums ${
                            c.direction === 'out'
                              ? 'bg-danger/10 text-danger'
                              : c.direction === 'in'
                                ? 'bg-success/10 text-success'
                                : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {c.direction === 'out' ? (
                            <LogOutIcon className="size-3" aria-label="çıkış" />
                          ) : c.direction === 'in' ? (
                            <LogInIcon className="size-3" aria-label="giriş" />
                          ) : null}
                          {saat(c.at)}
                        </li>
                      ))}
                    </ol>
                  ) : p.shifts.length > 0 ? (
                    <p className="text-xs text-muted-foreground">Turnike geçişi yok — mesai elle açılmış.</p>
                  ) : null}
                </li>
                )
              })}
            </ul>
          )}
        </Card>
      ) : null}
    </main>
  )
}
