'use client'

import { ShieldAlertIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  eraseMemberAction,
  previewErasureAction,
  type ErasurePreview,
} from '@/server/actions/kvkk'

// KVKK — the erasure, from the product (v1.27 S5).
//
// **It is destructive and it is the only screen in this system that is.** Everything else here is a
// compensating event; this one takes information away and cannot give it back. So the flow is:
//
//   1. SHOW HER WHAT GOES — the reservations, the messages, the login. A number, not a promise.
//   2. Say plainly what STAYS, and why it is lawful that it does.
//   3. A closed-enum reason, and a note that never enters the log.
//   4. Then, and only then, the button.
//
// The screen is visible only to the platform admin (the founding owner). The domain refuses everyone
// else regardless — the guard here is the door, `decideErase` is the lock.

const REASON_LABEL: Record<string, string> = {
  kvkk_request: 'KVKK silme talebi',
  legal_requirement: 'Yasal yükümlülük',
  duplicate: 'Mükerrer kayıt',
  test_data: 'Test verisi',
  owner_request: 'Stüdyo sahibinin talebi',
}

export function ErasurePanel({ memberId, memberName }: { memberId: string; memberName: string }) {
  const router = useRouter()
  const [preview, setPreview] = useState<ErasurePreview | null>(null)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('kvkk_request')
  const [note, setNote] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    const p = await previewErasureAction({ memberId })
    setBusy(false)
    if (!p) {
      toast.error('Üye bulunamadı.')
      return
    }
    setPreview(p)
    setOpen(true)
  }

  const erase = async () => {
    setBusy(true)
    const res = await eraseMemberAction({ memberId, reason, note: note.trim() || null })
    setBusy(false)
    if (res.ok) {
      toast.success('Üye kaydı anonimleştirildi.')
      setOpen(false)
      router.refresh()
    } else {
      toast.error(domainErrorMessage(res.error))
    }
  }

  // Typing the name is not theatre. It is the difference between an erasure somebody meant and one
  // they performed on the wrong row of a list.
  const armed = confirmName.trim() === memberName.trim()

  return (
    <>
      <div className="rounded-xl border border-danger/30 bg-danger/5 p-4">
        <div className="flex items-start gap-3">
          <ShieldAlertIcon className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-danger">KVKK — üye kaydını anonimleştir</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Adı, telefonu, e-postası ve tüm kişisel bilgileri kalıcı olarak silinir.{' '}
              <strong>Geri alınamaz.</strong> Rezervasyonları, kredileri ve ödemeleri kayıtlarda
              kalır — artık kimseye çözülmeyen bir kimlikle.
            </p>
            <Button
              variant="outline"
              className="mt-3 min-h-11"
              disabled={busy}
              onClick={() => void start()}
            >
              Anonimleştirmeyi başlat
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{memberName} — kaydı anonimleştirilecek</DialogTitle>
          </DialogHeader>

          {preview?.alreadyErased ? (
            <p className="rounded-md bg-muted p-3 text-sm">
              Bu üye zaten anonimleştirilmiş. Yeniden çalıştırmak yeni bir kayıt oluşturmaz.
            </p>
          ) : null}

          {/* 1. What GOES. A number, not a promise. */}
          <section>
            <p className="text-sm font-medium">Silinecekler</p>
            <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
              <li>• Ad, telefon, e-posta, doğum tarihi, notlar, acil durum kişisi</li>
              <li>• Rezervasyonlarındaki adı: {preview?.reservationSnapshots ?? 0} kayıt</li>
              <li>• Bildirim kayıtları: {preview?.notificationIntents ?? 0}</li>
              <li>• Uygulama içi mesajları: {preview?.inboxMessages ?? 0}</li>
              <li>• Portal davetleri: {preview?.invites ?? 0}</li>
              <li>• İmzalı belgeleri (sözleşme, KVKK, rıza) ve görselleri: {preview?.memberDocuments ?? 0}</li>
              <li>
                • Portal hesabı: {preview?.hasPortalAccount ? 'silinecek' : 'yok'}
              </li>
            </ul>
          </section>

          {/* 2. What STAYS — and why that is lawful. The owner will be asked this one day. */}
          <section className="rounded-md bg-muted/50 p-3">
            <p className="text-sm font-medium">Kalacaklar</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Rezervasyon, kredi, satış ve ödeme kayıtları <strong>kalır</strong> — ticari saklama
              yükümlülüğü (TTK, 10 yıl). Bunlar artık kimseye çözülmeyen bir kimliğe bağlıdır.
              İşlem kayıtlarında (event log) hiçbir zaman kişisel bilgi tutulmadı, dolayısıyla orada
              silinecek bir şey yok.
            </p>
          </section>

          {/* 3. A closed-enum reason — free text is the last place PII hides in a permanent log. */}
          <div className="space-y-3">
            <Select value={reason} onValueChange={(v) => setReason(v ?? 'kvkk_request')}>
              <SelectTrigger>
                <SelectValue>{REASON_LABEL[reason]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REASON_LABEL).map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              placeholder="Açıklama (opsiyonel) — kayıtta tutulur, işlem geçmişine yazılmaz"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />

            <Input
              placeholder={`Onaylamak için üyenin adını yazın: ${memberName}`}
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button variant="destructive" disabled={busy || !armed} onClick={() => void erase()}>
              Anonimleştir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
