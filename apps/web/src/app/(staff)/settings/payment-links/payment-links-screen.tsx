'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeftIcon, CopyIcon, LinkIcon, Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  createPaymentLinkAction,
  deactivatePaymentLinkAction,
  type PaymentLinkRow,
} from '@/server/actions/payment-links'

const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} ₺`

export function PaymentLinksScreen({
  initial,
  studioId,
  canManage,
}: {
  initial: readonly PaymentLinkRow[]
  studioId: string
  canManage: boolean
}) {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('') // TL
  const [installments, setInstallments] = useState('3')
  const [busy, setBusy] = useState(false)

  // The public URL a member opens. Built on the client from the current origin, so it always matches
  // the domain the owner is on (no env needed).
  const publicUrl = (linkId: string) =>
    typeof window === 'undefined' ? '' : `${window.location.origin}/pay/${linkId}?s=${studioId}`

  async function copy(linkId: string) {
    await navigator.clipboard.writeText(publicUrl(linkId))
    toast.success('Link kopyalandı. Instagram/WhatsApp’ta paylaşabilirsiniz.')
  }

  async function create() {
    const amountKurus = Math.round(Number(amount.replace(',', '.')) * 100)
    if (label.trim().length === 0) return void toast.error('Bir etiket girin (ör. Fitness 3 Aylık).')
    if (!Number.isFinite(amountKurus) || amountKurus <= 0) return void toast.error('Geçerli bir tutar girin.')
    setBusy(true)
    try {
      const res = await createPaymentLinkAction({
        label: label.trim(),
        amountKurus,
        maxInstallments: Number(installments),
      })
      if (res.ok) {
        toast.success('Ödeme linki oluşturuldu.')
        setLabel('')
        setAmount('')
        router.refresh()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Link oluşturulamadı.')
    }
    setBusy(false)
  }

  async function deactivate(linkId: string) {
    setBusy(true)
    try {
      const res = await deactivatePaymentLinkAction({ linkId })
      if (res.ok) {
        toast.success('Link kapatıldı.')
        router.refresh()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusy(false)
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Ödeme Linkleri"
        description="Sabit tutarlı, taksitli ödeme linki oluşturun ve paylaşın. Ödeme geldiğinde kasaya düşer; üyeye siz eşleştirirsiniz."
        actions={
          <Button variant="outline" size="sm" render={<Link href="/settings" />}>
            <ArrowLeftIcon />
            Ayarlar
          </Button>
        }
      />

      {canManage ? (
        <Section title="Yeni Link" hint="Tutar ve taksit sayısını belirleyin; paylaşılabilir bir link üretilir.">
          <div className="grid gap-3 sm:grid-cols-[1fr_140px_120px_auto] sm:items-end">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Etiket</label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Fitness 3 Aylık" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tutar (₺)</label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="9000" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Taksit</label>
              <Input inputMode="numeric" value={installments} onChange={(e) => setInstallments(e.target.value)} />
            </div>
            <Button onClick={() => void create()} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Oluştur
            </Button>
          </div>
        </Section>
      ) : null}

      <Section title="Aktif Linkler">
        {initial.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
            <LinkIcon className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Henüz link yok.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {initial.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-xs"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{l.label}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {tl(l.amountKurus)} · {l.maxInstallments === 1 ? 'tek çekim' : `${l.maxInstallments} taksit`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => void copy(l.id)}>
                    <CopyIcon /> Kopyala
                  </Button>
                  {canManage ? (
                    <Button variant="ghost" size="icon-sm" aria-label="Linki kapat" disabled={busy} onClick={() => void deactivate(l.id)}>
                      <Trash2Icon className="text-destructive" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </main>
  )
}
