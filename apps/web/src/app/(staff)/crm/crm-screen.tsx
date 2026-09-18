'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { HistoryIcon, Loader2Icon, MegaphoneIcon, PhoneIcon, PlusIcon, UserPlusIcon } from 'lucide-react'
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
  listOlderLeadsAction,
  loadFunnelAction,
  logInteractionAction,
  loseLeadAction,
  moveLeadAction,
  startAdPeriodAction,
} from '@/server/actions/crm'

type Funnel = Awaited<ReturnType<typeof loadFunnelAction>>
type Lead = Funnel['leads'][number]

// Sütun adları, owner'ın A kararı (2026-09-01). Her biri SIRADAKİ ADIMI söylüyor — "sıcak/ılık"
// gibi bir ilgi ölçüsü değil. Bir etiket ne yapılacağını söylemiyorsa, ona bakan kişi kararı yine
// kendi vermek zorunda kalır.
const STAGES = [
  { id: 'new', label: 'Yeni' },
  { id: 'contacted', label: 'Bilgi alıyor' },
  { id: 'offer', label: 'Fiyat verildi' },
  { id: 'visit_booked', label: 'Randevulu' },
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
export function CrmScreen({ initial }: { initial: Funnel }) {
  const [leads, setLeads] = useState<readonly Lead[]>(initial.leads)
  const [period, setPeriod] = useState(initial.period)
  // Eski adaylar yalnızca istenince yüklenir (owner, 2026-09-15). `null` = henüz istenmedi.
  const [older, setOlder] = useState<readonly Lead[] | null>(null)
  const [olderDone, setOlderDone] = useState(false)
  const [olderBusy, setOlderBusy] = useState(false)
  const [startingPeriod, setStartingPeriod] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [losing, setLosing] = useState<Lead | null>(null)
  const [interacting, setInteracting] = useState<Lead | null>(null)
  const [pending, start] = useTransition()

  const router = useRouter()
  const reload = () =>
    start(async () => {
      const f = await loadFunnelAction()
      setLeads(f.leads)
      setPeriod(f.period)
      // Açılmış eski liste de tazelenir: oradan ilerletilen bir aday eski yerinde kalmasın.
      if (older !== null && f.period) setOlder(await listOlderLeadsAction({ before: f.period.startedAt }))
    })

  const loadOlder = async () => {
    if (!period) return
    setOlderBusy(true)
    try {
      const before = older && older.length > 0 ? older[older.length - 1]!.createdAt : period.startedAt
      const page = await listOlderLeadsAction({ before })
      setOlder([...(older ?? []), ...page])
      if (page.length < 100) setOlderDone(true)
    } catch {
      toast.error('Eski adaylar yüklenemedi.')
    }
    setOlderBusy(false)
  }

  const cardProps = {
    pending,
    onInteract: (l: Lead) => setInteracting(l),
    onLose: (l: Lead) => setLosing(l),
    onConvert: (l: Lead) => void convert(l),
    onMove: (l: Lead) =>
      start(async () => {
        const res = await moveLeadAction({ leadId: l.id, stage: nextStage(l.stage)! })
        if (res.ok) reload()
        else toast.error(domainErrorMessage(res.error))
      }),
  }

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

  const open = leads.filter((l) => ['new', 'contacted', 'offer', 'visit_booked'].includes(l.stage))
  const won = leads.filter((l) => l.stage === 'won')
  const lost = leads.filter((l) => l.stage === 'lost')
  const conversion = won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Satış Hunisi"
        description={
          period
            ? `${period.label} · ${formatDateTime(period.startedAt).slice(0, 10)} tarihinden beri · ${open.length} açık aday · dönüşüm %${conversion}`
            : `${open.length} açık aday · dönüşüm %${conversion}`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {initial.canStartPeriod ? (
              <Button variant="outline" onClick={() => setStartingPeriod(true)}>
                <MegaphoneIcon />
                Yeni reklam dönemi
              </Button>
            ) : null}
            <Button onClick={() => setCapturing(true)}>
              <PlusIcon />
              Yeni Aday
            </Button>
          </div>
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
                  rows.map((l) => <LeadCard key={l.id} l={l} {...cardProps} />)
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

      {/* ESKİ ADAYLAR (owner, 2026-09-15): dönemden önce gelenler silinmedi, kaybedildi de sayılmadı —
          yalnızca bu dönemin hunisinden ayrıldı. İstenince buradan görünür ve yine ilerletilebilir. */}
      {period ? (
        <section className="space-y-2">
          {older !== null ? (
            <>
              <h2 className="text-sm font-semibold text-foreground">
                {period.label} öncesi adaylar <span className="text-xs tabular-nums text-muted-foreground">{older.length}</span>
              </h2>
              {older.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">Eski aday yok</p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {older.map((l) => (
                    <LeadCard key={l.id} l={l} {...cardProps} showStage />
                  ))}
                </div>
              )}
            </>
          ) : null}
          {!olderDone ? (
            <div className="flex justify-center">
              <Button variant="outline" disabled={olderBusy} onClick={() => void loadOlder()}>
                {olderBusy ? <Loader2Icon className="animate-spin" /> : <HistoryIcon />}
                {older === null ? 'Eski adayları getir' : 'Daha eski adayları getir'}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <StartPeriodDialog
        open={startingPeriod}
        onClose={() => setStartingPeriod(false)}
        onDone={() => {
          setStartingPeriod(false)
          setOlder(null)
          setOlderDone(false)
          reload()
        }}
      />

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

const STAGE_LABEL: Record<string, string> = {
  ...Object.fromEntries(STAGES.map((st) => [st.id, st.label])),
  won: 'Üye oldu',
  lost: 'Kaybedildi',
}

function LeadCard({
  l,
  pending,
  showStage = false,
  onInteract,
  onMove,
  onConvert,
  onLose,
}: {
  l: Lead
  pending: boolean
  showStage?: boolean
  onInteract: (l: Lead) => void
  onMove: (l: Lead) => void
  onConvert: (l: Lead) => void
  onLose: (l: Lead) => void
}) {
  const acik = ['new', 'contacted', 'offer', 'visit_booked'].includes(l.stage)
  return (
    <article className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm">
      <div>
        <p className="truncate text-sm font-medium text-foreground">{l.fullName}</p>
        <p className="truncate text-xs tabular-nums text-muted-foreground">{l.phone}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {showStage ? <Badge className="bg-primary/10 text-primary">{STAGE_LABEL[l.stage] ?? l.stage}</Badge> : null}
        <Badge className="bg-muted text-muted-foreground">{SOURCES[l.source] ?? l.source}</Badge>
        <span className="text-[0.6875rem] tabular-nums text-muted-foreground">{formatDateTime(l.createdAt).slice(0, 10)}</span>
      </div>
      {l.note ? <p className="truncate text-xs text-muted-foreground">{l.note}</p> : null}
      {/* SON GÖRÜŞME (owner, 2026-09-19): panodaki tik notu o güne aittir ve ertesi sabah listeyle
          birlikte gider. Kalıcı olan bu: adayla en son ne konuşulduğu, sorulduğu yerde. */}
      {l.lastNote ? (
        <p className="text-xs text-primary">
          <span className="tabular-nums text-muted-foreground">{formatDateTime(l.lastNote.at).slice(0, 10)}</span>{' '}
          {l.lastNote.text}
        </p>
      ) : null}

      {acik ? (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => onInteract(l)}>
            <PhoneIcon />
            Görüşme
          </Button>
          {nextStage(l.stage) ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => onMove(l)}>
              İlerlet
            </Button>
          ) : null}
          {/* One press. The lead already holds her name and her phone; asking reception to retype them
              into another screen is asking her to forget the second half (Alpha Review). */}
          <Button size="sm" variant="outline" onClick={() => onConvert(l)}>
            <UserPlusIcon />
            Üye Yap
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onLose(l)}>
            Kaybedildi
          </Button>
        </div>
      ) : null}
    </article>
  )
}

/** İstanbul günü → o günün 00:00'ı (UTC+3, stüdyonun saat dilimi). */
const gunBasi = (ymd: string): number => new Date(`${ymd}T00:00:00+03:00`).getTime()
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

function StartPeriodDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const bugun = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10)
  const [gun, setGun] = useState(bugun)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const oneri = (() => {
    const [, m, d] = gun.split('-').map(Number)
    return m && d ? `${d} ${AYLAR[m - 1]} reklamı` : ''
  })()

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Yeni reklam dönemi</DialogTitle>
          <DialogDescription>
            Huni bu günden itibaren gelen adaylarla yeniden başlar; WhatsApp listesinde bu dönemde gelenler ayrı görünür.
            Eski adaylar silinmez ve kaybedildi sayılmaz — &quot;Eski adayları getir&quot; ile görünür.
          </DialogDescription>
        </DialogHeader>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Reklamın başladığı gün</span>
          <Input type="date" value={gun} max={bugun} onChange={(e) => setGun(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Dönemin adı</span>
          <Input placeholder={oneri} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button
            disabled={busy || !gun}
            onClick={async () => {
              setBusy(true)
              const res = await startAdPeriodAction({ label: label.trim() || oneri, startedAt: gunBasi(gun) })
              setBusy(false)
              if (res.ok) {
                toast.success('Yeni reklam dönemi başladı.')
                setLabel('')
                onDone()
              } else toast.error(domainErrorMessage(res.error))
            }}
          >
            {busy ? <Loader2Icon className="animate-spin" /> : <MegaphoneIcon />}
            Dönemi başlat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// İleri sıra. `visit_booked` en sağda: bu stüdyoda satış kapıda kapanır, o yüzden "gelmeye söz
// verdi" fiyat vermekten SONRAKİ adımdır.
const nextStage = (s: string): 'contacted' | 'offer' | 'visit_booked' | null =>
  s === 'new' ? 'contacted' : s === 'contacted' ? 'offer' : s === 'offer' ? 'visit_booked' : null

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
