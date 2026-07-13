'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2Icon, PhoneIcon, PlusIcon, UserPlusIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
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
import { PageHeader } from '@/components/ui/page-header'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDateTime } from '@/lib/datetime'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  captureLeadAction,
  convertLeadToMemberAction,
  listLeadsAction,
  logInteractionAction,
  loseLeadAction,
  moveLeadAction,
} from '@/server/actions/crm'

type Lead = Awaited<ReturnType<typeof listLeadsAction>>[number]

const STAGES = [
  { id: 'new', label: 'Yeni' },
  { id: 'contacted', label: 'İletişim kuruldu' },
  { id: 'trial', label: 'Deneme dersi' },
  { id: 'offer', label: 'Teklif' },
] as const

const SOURCES: Record<string, string> = {
  instagram: 'Instagram',
  walk_in: 'Kapıdan',
  referral: 'Tavsiye',
  google: 'Google',
  phone: 'Telefon',
  event: 'Etkinlik',
  other: 'Diğer',
}

const LOST_REASONS: Record<string, string> = {
  price: 'Fiyat',
  schedule: 'Program uymadı',
  location: 'Konum',
  competitor: 'Rakibe gitti',
  not_interested: 'İlgilenmedi',
  unreachable: 'Ulaşılamadı',
  other: 'Diğer',
}

// The pipeline. Four open stages, and two ways out: won (an explicit conversion) or lost (with a
// reason — the enum makes the loss analysable, the note makes it true).
export function CrmScreen({ initial }: { initial: readonly Lead[] }) {
  const [leads, setLeads] = useState<readonly Lead[]>(initial)
  const [capturing, setCapturing] = useState(false)
  const [losing, setLosing] = useState<Lead | null>(null)
  const [interacting, setInteracting] = useState<Lead | null>(null)
  const [pending, start] = useTransition()

  const router = useRouter()
  const reload = () => start(async () => setLeads(await listLeadsAction()))

  const convert = async (lead: Lead) => {
    const res = await convertLeadToMemberAction({ leadId: lead.id })
    if (!res.ok) {
      // The commonest refusal is the honest one: that phone already belongs to a member. She is not a
      // lead, she is a customer, and reception should not be allowed to create a second her (I-21).
      toast.error(domainErrorMessage(res.error))
      return
    }
    toast.success(`${lead.fullName} üye oldu.`)
    router.push(`/members/${res.value.memberId}`)
  }

  const open = leads.filter((l) => ['new', 'contacted', 'trial', 'offer'].includes(l.stage))
  const won = leads.filter((l) => l.stage === 'won')
  const lost = leads.filter((l) => l.stage === 'lost')
  const conversion = won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Satış Hunisi"
        description={`${open.length} açık aday · dönüşüm %${conversion}`}
        actions={
          <Button onClick={() => setCapturing(true)}>
            <PlusIcon />
            Yeni Aday
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((stage) => {
          const rows = open.filter((l) => l.stage === stage.id)
          return (
            <section key={stage.id} className="space-y-2">
              <h2 className="flex items-baseline gap-2 px-1 text-sm font-semibold text-foreground">
                {stage.label}
                <span className="text-xs tabular-nums text-muted-foreground">{rows.length}</span>
              </h2>
              <div className="space-y-2">
                {rows.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                    Aday yok
                  </p>
                ) : (
                  rows.map((l) => (
                    <article key={l.id} className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm">
                      <div>
                        <p className="truncate text-sm font-medium text-foreground">{l.fullName}</p>
                        <p className="truncate text-xs tabular-nums text-muted-foreground">{l.phone}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge className="bg-muted text-muted-foreground">{SOURCES[l.source] ?? l.source}</Badge>
                        <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
                          {formatDateTime(l.createdAt).slice(0, 10)}
                        </span>
                      </div>
                      {l.note ? <p className="truncate text-xs text-muted-foreground">{l.note}</p> : null}

                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setInteracting(l)}>
                          <PhoneIcon />
                          Görüşme
                        </Button>
                        {nextStage(l.stage) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              start(async () => {
                                const res = await moveLeadAction({ leadId: l.id, stage: nextStage(l.stage)! })
                                if (res.ok) reload()
                                else toast.error(domainErrorMessage(res.error))
                              })
                            }
                          >
                            İlerlet
                          </Button>
                        ) : null}
                        {/* One press. The lead already holds her name and her phone; asking reception
                            to retype them into another screen is asking her to forget the second half
                            — which is exactly what happened: this used to link to a query parameter
                            nothing read (Alpha Review). */}
                        <Button size="sm" variant="outline" onClick={() => void convert(l)}>
                          <UserPlusIcon />
                          Üye Yap
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setLosing(l)}>
                          Kaybedildi
                        </Button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          )
        })}
      </div>

      {lost.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Kaybedilen adaylar</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {lost.slice(0, 10).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
                <span className="truncate font-medium text-foreground">{l.fullName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {l.lostReason ? (LOST_REASONS[l.lostReason] ?? l.lostReason) : '—'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <CaptureDialog open={capturing} onClose={() => setCapturing(false)} onDone={() => { setCapturing(false); reload() }} />

      <LoseDialog
        lead={losing}
        onClose={() => setLosing(null)}
        onDone={() => {
          setLosing(null)
          reload()
        }}
      />

      <InteractionDialog
        lead={interacting}
        onClose={() => setInteracting(null)}
        onDone={() => {
          setInteracting(null)
          reload()
        }}
      />
    </main>
  )
}

const nextStage = (s: string): 'contacted' | 'trial' | 'offer' | null =>
  s === 'new' ? 'contacted' : s === 'contacted' ? 'trial' : s === 'trial' ? 'offer' : null

function CaptureDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [source, setSource] = useState('instagram')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Yeni aday</DialogTitle>
          <DialogDescription>
            Adayın kaynağı sonradan kurtarılamaz — kampanya ölçümü buna bağlı.
          </DialogDescription>
        </DialogHeader>
        <Input placeholder="Ad soyad" value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
        <Input placeholder="Telefon" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Select value={source} onValueChange={(v) => setSource(v ?? 'other')}>
          <SelectTrigger>
            <SelectValue>{(v: unknown) => SOURCES[String(v)] ?? 'Kaynak'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SOURCES).map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input placeholder="Not (opsiyonel)" value={note} onChange={(e) => setNote(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button
            disabled={busy || !fullName.trim() || !phone.trim()}
            onClick={async () => {
              setBusy(true)
              const res = await captureLeadAction({
                fullName: fullName.trim(),
                phone: phone.trim(),
                source,
                note: note.trim() || null,
              })
              setBusy(false)
              if (res.ok) {
                toast.success('Aday kaydedildi.')
                setFullName('')
                setPhone('')
                setNote('')
                onDone()
              } else {
                toast.error(domainErrorMessage(res.error))
              }
            }}
          >
            {busy ? <Loader2Icon className="animate-spin" /> : null}
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// The enum makes the loss analysable; the note makes it true. The domain requires both.
function LoseDialog({ lead, onClose, onDone }: { lead: Lead | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('price')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Dialog open={lead !== null} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Aday kaybedildi</DialogTitle>
          <DialogDescription>
            {lead?.fullName} — neden kaybettiğimizi yazmazsak, bir daha aynı sebeple kaybederiz.
          </DialogDescription>
        </DialogHeader>
        <Select value={reason} onValueChange={(v) => setReason(v ?? 'other')}>
          <SelectTrigger>
            <SelectValue>{(v: unknown) => LOST_REASONS[String(v)] ?? 'Sebep'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(LOST_REASONS).map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input placeholder="Açıklama (zorunlu)" value={note} onChange={(e) => setNote(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={busy || note.trim() === ''}
            onClick={async () => {
              setBusy(true)
              const res = await loseLeadAction({ leadId: lead!.id, reason, note: note.trim() })
              setBusy(false)
              if (res.ok) {
                toast.success('Kaydedildi.')
                setNote('')
                onDone()
              } else {
                toast.error(domainErrorMessage(res.error))
              }
            }}
          >
            {busy ? <Loader2Icon className="animate-spin" /> : null}
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InteractionDialog({ lead, onClose, onDone }: { lead: Lead | null; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState('call')
  const [text, setText] = useState('')
  const [outcome, setOutcome] = useState<string | null>('reached')
  const [busy, setBusy] = useState(false)

  const KINDS: Record<string, string> = {
    call: 'Telefon',
    whatsapp: 'WhatsApp',
    sms: 'SMS',
    email: 'E-posta',
    meeting: 'Görüşme',
    note: 'Not',
    trial: 'Deneme dersi',
  }

  return (
    <Dialog open={lead !== null} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Görüşme kaydı</DialogTitle>
          <DialogDescription>{lead?.fullName}</DialogDescription>
        </DialogHeader>
        <Select value={kind} onValueChange={(v) => setKind(v ?? 'call')}>
          <SelectTrigger>
            <SelectValue>{(v: unknown) => KINDS[String(v)] ?? 'Tür'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(KINDS).map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input placeholder="Ne konuşuldu?" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        <div className="flex gap-1.5">
          {[
            { id: 'reached', label: 'Ulaşıldı' },
            { id: 'no_answer', label: 'Cevap yok' },
            { id: 'callback', label: 'Geri aranacak' },
          ].map((o) => (
            <Button
              key={o.id}
              size="sm"
              variant={outcome === o.id ? 'default' : 'outline'}
              onClick={() => setOutcome(o.id)}
            >
              {o.label}
            </Button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button
            disabled={busy || text.trim() === ''}
            onClick={async () => {
              setBusy(true)
              const res = await logInteractionAction({
                kind,
                leadId: lead!.id,
                text: text.trim(),
                outcome,
              })
              setBusy(false)
              if (res.ok) {
                toast.success('Görüşme kaydedildi.')
                setText('')
                onDone()
              } else {
                toast.error(domainErrorMessage(res.error))
              }
            }}
          >
            {busy ? <Loader2Icon className="animate-spin" /> : null}
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
