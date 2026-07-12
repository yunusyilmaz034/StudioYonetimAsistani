'use client'

import { useState } from 'react'
import { CopyIcon, Loader2Icon, LinkIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { domainErrorMessage } from '@/lib/domain-error'
import { issueMemberInviteAction } from '@/server/actions/portal-auth'

const dt = (ms: number) =>
  new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'medium', timeStyle: 'short' })

// D1/D2/D17 — reception issues the link; the MEMBER sets the password. Reception never knows it.
//
// The raw token is shown ONCE and is not retrievable afterwards: we store only its hash. If it
// is lost, issue a new one — which supersedes the old link and revokes her existing sessions.
// That is also the password-reset flow: there is no separate one, and therefore no second way
// to get it wrong.
export function InvitePanel({ memberId, studioId }: { memberId: string; studioId: string }) {
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)

  async function issue() {
    setBusy(true)
    try {
      const res = await issueMemberInviteAction({ memberId })
      if (res.ok) {
        const origin = typeof window === 'undefined' ? '' : window.location.origin
        setLink(`${origin}/invite/${encodeURIComponent(studioId)}/${res.value.token}`)
        setExpiresAt(res.value.expiresAt)
        toast.success('Davet bağlantısı oluşturuldu.')
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Bağlantı oluşturulamadı.')
    }
    setBusy(false)
  }

  async function copy() {
    if (!link) return
    await navigator.clipboard.writeText(link)
    toast.success('Bağlantı kopyalandı. WhatsApp ile gönderebilirsiniz.')
  }

  return (
    <div className="space-y-2">
      <h3 className="text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">
        Üye portalı
      </h3>
      <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
        {link ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Davet bağlantısı hazır</p>
            <p className="break-all rounded-lg bg-muted px-3 py-2 text-xs text-foreground">{link}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={copy}>
                <CopyIcon /> Kopyala
              </Button>
              <Button size="sm" variant="ghost" onClick={issue} disabled={busy}>
                Yeni bağlantı
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {expiresAt ? `Son geçerlilik: ${dt(expiresAt)} · ` : ''}Tek kullanımlıktır ve bir daha
              görüntülenemez. Kaybolursa yeni bir bağlantı oluşturun — eskisi geçersiz olur.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Davet bağlantısı oluştur</p>
              <p className="text-xs text-muted-foreground">
                Üye kendi şifresini belirler; 72 saat geçerlidir. Şifre unutulduğunda da aynı yol
                kullanılır — yeni bağlantı, eski oturumları sonlandırır.
              </p>
            </div>
            <Button size="sm" variant="outline" className="shrink-0" onClick={issue} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <LinkIcon />}
              Davet Linki
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
