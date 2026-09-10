'use client'

import { useEffect, useState } from 'react'
import { CopyIcon, KeyRoundIcon, Loader2Icon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  createTurnstileDeviceAction,
  listTurnstilesAction,
  rotateTurnstileSecretAction,
  setTurnstileDeviceActiveAction,
} from '@/server/actions/turnstile'

// ── KAPI CİHAZLARI (owner onayı, 2026-09-11 — ikinci stüdyo hazırlığı) ──────────────────────
//
// İlk iki cihaz ELLE oluşturulmuştu: bu ekran yoktu, sır `secrets.h`e yazılıp flash'lanıyordu.
// Yani her yeni kapı bir Mac, bir yazılımcı ve bir gece demekti — ve `TURNSTILE-HARDWARE.md` §5
// bunu ikinci stüdyodan önce kapatılacak üç işten biri sayıyordu.
//
// SIR BİR KEZ GÖSTERİLİR ve bir daha hiçbir yerden okunamaz; veritabanında yalnızca özeti duruyor.
// Kaybolursa üretilmez, DÖNDÜRÜLÜR. Bunu ekranda yazıyoruz, çünkü "sonra bakarım" diyen biri
// pencereyi kapattığında geri dönüşü yok.

type Cihaz = Awaited<ReturnType<typeof listTurnstilesAction>>[number]

export function TurnstileDevicesPanel({ branchId, canManage }: { branchId: string | null; canManage: boolean }) {
  const [rows, setRows] = useState<readonly Cihaz[]>([])
  const [busy, setBusy] = useState(false)
  const [yeni, setYeni] = useState(false)
  const [ad, setAd] = useState('')
  const [side, setSide] = useState<'in' | 'out'>('in')
  // Eşleştirme dizesi EKRANDA tutulur, state'te bir kez. Sunucu onu bir daha veremez.
  const [pairing, setPairing] = useState<{ ad: string; deger: string } | null>(null)
  const [rotating, setRotating] = useState<Cihaz | null>(null)
  const [sebep, setSebep] = useState('')

  const yukle = () => listTurnstilesAction().then(setRows).catch(() => setRows([]))
  useEffect(() => {
    void yukle()
  }, [])

  async function ekle() {
    if (!branchId || ad.trim() === '') return
    setBusy(true)
    try {
      const r = await createTurnstileDeviceAction({ name: ad.trim(), branchId, side })
      if (r.ok) {
        setYeni(false)
        setAd('')
        setPairing({ ad: ad.trim(), deger: r.pairing })
        await yukle()
      } else toast.error(domainErrorMessage(r.error))
    } catch {
      toast.error('Cihaz eklenemedi.')
    }
    setBusy(false)
  }

  async function dondur() {
    if (!rotating || sebep.trim() === '') return
    setBusy(true)
    try {
      const r = await rotateTurnstileSecretAction({ deviceId: rotating.id, reason: sebep.trim() })
      if (r.ok) {
        const isim = rotating.name
        setRotating(null)
        setSebep('')
        setPairing({ ad: isim, deger: r.pairing })
      } else toast.error(domainErrorMessage(r.error))
    } catch {
      toast.error('Sır döndürülemedi.')
    }
    setBusy(false)
  }

  async function aktiflik(d: Cihaz) {
    setBusy(true)
    try {
      const r = await setTurnstileDeviceActiveAction({ deviceId: d.id, active: !d.active })
      if (r.ok) await yukle()
      else toast.error(domainErrorMessage(r.error))
    } catch {
      toast.error('Değiştirilemedi.')
    }
    setBusy(false)
  }

  const gorulme = (ms: number | null) =>
    ms === null
      ? 'hiç bağlanmadı'
      : Date.now() - ms < 120_000
        ? 'şu an bağlı'
        : `son görülme ${new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`

  return (
    <Section
      title="Kapı Cihazları"
      hint="Turnikedeki her ekran ayrı bir cihazdır: kendi kimliği, kendi sırrı, kendi yönü. Sır bir kez gösterilir."
    >
      {canManage ? (
        <div className="mb-3">
          <Button variant="outline" disabled={!branchId || busy} onClick={() => setYeni(true)}>
            <PlusIcon />
            Cihaz ekle
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz kapı cihazı yok.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {rows.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {d.name}
                  {d.side ? <span className="ml-2 text-xs text-muted-foreground">{d.side === 'in' ? 'giriş' : 'çıkış'}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {d.active ? gorulme(d.lastSeenAt) : 'devre dışı'} · <span className="font-mono">{d.id}</span>
                </p>
              </div>
              {canManage ? (
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRotating(d)}>
                    <KeyRoundIcon />
                    Sırrı döndür
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void aktiflik(d)}>
                    {d.active ? 'Devre dışı bırak' : 'Aktifleştir'}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-xs text-muted-foreground">
        Bir cihaz <strong>silinmez</strong>, devre dışı bırakılır: geçmişi durur, yalnızca kapıyı artık açmaz.
      </p>

      <Dialog open={yeni} onOpenChange={(o) => (o ? null : setYeni(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kapı cihazı ekle</DialogTitle>
            <DialogDescription>Sır bir kez gösterilecek — cihaza yazmadan pencereyi kapatma.</DialogDescription>
          </DialogHeader>
          <Input placeholder="Ad (örn. Giriş turnikesi)" value={ad} onChange={(e) => setAd(e.target.value)} autoFocus />
          <Select value={side} onValueChange={(v) => setSide((v as 'in' | 'out') ?? 'in')}>
            <SelectTrigger>
              <SelectValue>{side === 'in' ? 'Giriş tarafı' : 'Çıkış tarafı'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="in">Giriş tarafı</SelectItem>
              <SelectItem value="out">Çıkış tarafı</SelectItem>
            </SelectContent>
          </Select>
          {/* Yön bir OLGUDUR, tercih değil: hangi taraftan okutulduğu geçişin yönünü belirliyor ve
              yanlışsa doluluk ters döner. Ekran bunu soruyor ki kimse tahmin etmesin. */}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setYeni(false)} disabled={busy}>
              Vazgeç
            </Button>
            <Button onClick={() => void ekle()} disabled={busy || ad.trim() === ''}>
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              Ekle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rotating !== null} onOpenChange={(o) => (o ? null : setRotating(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sırrı döndür</DialogTitle>
            <DialogDescription>
              {rotating?.name} — eski sır bu anda ölür. Cihaz yeni sırrı alana kadar kapıyı açmaz.
            </DialogDescription>
          </DialogHeader>
          <Input placeholder="Sebep (zorunlu)" value={sebep} onChange={(e) => setSebep(e.target.value)} autoFocus />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRotating(null)} disabled={busy}>
              Vazgeç
            </Button>
            <Button variant="destructive" onClick={() => void dondur()} disabled={busy || sebep.trim() === ''}>
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              Döndür
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pairing !== null} onOpenChange={(o) => (o ? null : setPairing(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pairing?.ad} — eşleştirme anahtarı</DialogTitle>
            <DialogDescription>
              Bu değer <strong>bir daha gösterilmeyecek</strong>. Veritabanında yalnızca özeti duruyor; kaybolursa
              yeniden üretilmez, sır döndürülür.
            </DialogDescription>
          </DialogHeader>
          <code className="block w-full break-all rounded-lg border border-border bg-muted/40 p-3 text-xs">
            {pairing?.deger}
          </code>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(pairing?.deger ?? '')
                toast.success('Kopyalandı.')
              }}
            >
              <CopyIcon />
              Kopyala
            </Button>
            <Button onClick={() => setPairing(null)}>Yazdım, kapat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  )
}
