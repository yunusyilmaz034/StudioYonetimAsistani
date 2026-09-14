'use client'

import { useCallback, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CameraIcon, CheckCircle2Icon, ChevronLeftIcon, ChevronRightIcon, LogInIcon, LogOutIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { shiftDate } from '@/components/calendar/date-utils'
import { PageHeader } from '@/components/ui/page-header'
import { QrScanner } from '@/components/qr-scanner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { domainErrorMessage } from '@/lib/domain-error'
import { endShiftAction, staffCrossTurnstileAction, startShiftAction } from '@/server/actions/shift'
import { IzinPanel } from './izin-panel'
import type { ShiftView } from '@/server/shift-query'

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
      </Card>

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
              {view.gunluk.map((p) => (
                <li key={p.staffUserId} className="space-y-1.5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                    <span className="truncate font-medium">{p.displayName}</span>
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
                  ) : (
                    <p className="text-xs text-muted-foreground">Turnike geçişi yok — mesai elle açılmış.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </main>
  )
}
