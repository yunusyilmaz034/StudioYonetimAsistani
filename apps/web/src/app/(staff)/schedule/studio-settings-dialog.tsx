'use client'

import { useEffect, useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { domainErrorMessage } from '@/lib/domain-error'
import { getStudioDefaultsAction, setStudioDefaultsAction } from '@/server/actions/scheduling'

// D14 — the studio default cancellation window: level 3 of the chain
// (session override → service → studio → refuse).
//
// The copy here has one job beyond collecting a number: it must make the *stamping* rule
// impossible to misunderstand. An owner who believes this field retroactively shortens the
// cancellation window on classes people have already booked would be wrong, and would find out
// the hard way — from a member.
export function StudioSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [hours, setHours] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    getStudioDefaultsAction()
      .then((s) => setHours(s.defaultCancellationWindowHours))
      .catch(() => toast.error('Ayarlar yüklenemedi.'))
      .finally(() => setLoading(false))
  }, [open])

  async function save() {
    setBusy(true)
    try {
      const res = await setStudioDefaultsAction({ defaultCancellationWindowHours: hours })
      if (res.ok) {
        toast.success('Stüdyo varsayılanı kaydedildi.')
        onClose()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Kaydedilemedi. Bu ayarı yalnızca sahip değiştirebilir.')
    }
    setBusy(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stüdyo Ayarları</DialogTitle>
          <DialogDescription>
            Varsayılan iptal süresi. Ders veya seans için özel bir süre belirtilmediğinde bu kullanılır.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
          </p>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor="studio-cancel" className="text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">
              Varsayılan iptal süresi (saat)
            </label>
            <Input
              id="studio-cancel"
              type="number"
              min={0}
              placeholder="Tanımsız"
              value={hours ?? ''}
              onChange={(e) => setHours(e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0))}
            />
            <p className="text-xs text-muted-foreground">
              Bu değişiklik <span className="font-medium text-foreground">yalnızca bundan sonra oluşturulacak
              seansları</span> etkiler. Mevcut seanslar, oluşturuldukları andaki iptal süresini korur — bir üyenin
              rezervasyon yaptığı şartlar sonradan değiştirilemez.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={save} disabled={busy || loading}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
