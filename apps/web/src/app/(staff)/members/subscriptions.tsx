'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDownIcon, Loader2Icon, PlusIcon, PrinterIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Timeline } from '@/components/activity/timeline'
import { packageTimelineAction } from '@/server/actions/activity'
import {
  freezeSubscriptionAction,
  unfreezeSubscriptionAction,
} from '@/server/actions/subscription'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { domainErrorMessage } from '@/lib/domain-error'
import { saveErrorMessage } from '@/lib/stale-deployment'
import type { ProductView } from '@/server/catalog-query'
import { PaytrCheckoutDialog, type PaytrCheckout } from '@/components/paytr-checkout'
import { createPackagePaymentAction } from '@/server/actions/payments'
import {
  adjustSubscriptionCreditsAction,
  amendSubscriptionAction,
  assignSubscriptionAction,
  cancelSubscriptionAction,
  createPackageLinkSaleAction,
  listMemberSubscriptionsAction,
  reactivateSubscriptionAction,
  type SubscriptionView,
} from '@/server/actions/subscription'

// "Fiziksel POS" = the studio's own card terminal, recorded by hand (no PAYTR). The two PAYTR options
// (Sanal POS, Linkle Ödeme) are added directly in the dropdown below.
const METHOD_LABEL: Record<string, string> = { cash: 'Nakit', credit_card: 'Fiziksel POS', bank_transfer: 'Havale / EFT' }
const STATUS_LABEL: Record<string, string> = { active: 'Aktif', frozen: 'Dondurulmuş', expired: 'Süresi doldu', cancelled: 'İptal' }

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} TL`
const toKurus = (s: string) => Math.round((Number(s) || 0) * 100)
const dateLabel = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })
const BUNDLE_CAT: Record<string, string> = { pilates_group: 'Pilates', fitness: 'Fitness', private: 'PT' }
// ms → 'yyyy-mm-dd' for a date input, never throwing: an open-ended subscription has a null validUntil,
// and `new Date(null/undefined).toISOString()` would crash the dialog on open.
const toDateInput = (ms: number | null | undefined): string => {
  if (ms == null) return ''
  const t = new Date(ms)
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10)
}
const studioToday = () => new Date(Date.now() + 180 * 60_000).toISOString().slice(0, 10)
const addDays = (d: string, days: number) => {
  // A `type="date"` input reports an EMPTY value for every intermediate keystroke until the whole
  // date is valid — so while reception types the start date, `d` is '' on each keypress. Without this
  // guard, `new Date('T00:00:00Z')` is Invalid and `.toISOString()` throws a RangeError, which React
  // turns into a full white-screen "client-side exception" mid-typing. Return '' instead of crashing.
  if (!d) return ''
  const t = new Date(`${d}T00:00:00Z`)
  if (Number.isNaN(t.getTime())) return ''
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}

// A HYBRID is ONE package the studio sold, but the domain stores it as one entitlement PER component
// (so the category wall holds — a pilates credit never opens fitness). The card must read as ONE thing,
// or two identical rows look like a duplicate (owner). Group a bundle's components by productId; the
// PRIMARY — the component carrying the price + the sale — is the card's money/date/receipt face.
type SubCard = { primary: SubscriptionView; components: SubscriptionView[] }
function toCards(subs: readonly SubscriptionView[]): SubCard[] {
  const bundles = new Map<string, SubscriptionView[]>()
  const cards: SubCard[] = []
  for (const s of subs) {
    if (s.isBundle) {
      const g = bundles.get(s.productId) ?? []
      g.push(s)
      bundles.set(s.productId, g)
    } else {
      cards.push({ primary: s, components: [s] })
    }
  }
  for (const g of bundles.values()) {
    const primary = g.reduce((a, b) => (b.priceAgreedKurus > a.priceAgreedKurus ? b : a), g[0]!)
    cards.push({ primary, components: g })
  }
  return cards.sort((a, b) => b.primary.validFrom - a.primary.validFrom)
}

// What the CATALOGUE says this component normally carries — the number the product was defined with,
// which is not always the number this member was given.
//
// Reception routinely and correctly grants fewer (owner, 2026-07-28): a member migrating from the
// old system had already used one of her eight, so she was entered with seven. Nothing is wrong with
// that — what was wrong is that afterwards nobody could tell "7/7" (a reduced package, complete) from
// "7/7" (a full package of seven). The standard is shown only when it DIFFERS, so the common case
// stays quiet and the exception explains itself.
const standardCreditsFor = (s: SubscriptionView, products: readonly ProductView[]): number | null => {
  const p = products.find((x) => x.id === s.productId)
  if (!p) return null
  if (!p.components?.length) return p.creditCount
  // A bundle: match the component by category — that is what makes it this member's pilates half.
  return p.components.find((c) => c.category === s.category)?.creditCount ?? null
}

// What ONE component holds — a credit count, a giriş allowance, or unlimited time.
const componentLine = (s: SubscriptionView, products: readonly ProductView[] = []): string => {
  if (s.type !== 'credit') {
    return s.entryAllowance != null
      ? `${Math.max(0, s.entryAllowance - s.entriesUsed)}/${s.entryAllowance} giriş`
      : 'sınırsız'
  }
  const std = standardCreditsFor(s, products)
  const note = std != null && s.creditsGranted != null && std !== s.creditsGranted ? ` (normalde ${std})` : ''
  // `X/Y` reads as "X left out of Y" — a ceiling. After a gift or a correction she can hold MORE
  // than she was granted, and "9/8 kredi" is then a sentence nobody can parse: there is no eight to
  // have nine of. In that case the denominator is not a ceiling and is dropped; the number that
  // matters — what she can actually book with — stands on its own.
  const av = s.creditsAvailable ?? 0
  const granted = s.creditsGranted
  return granted != null && av <= granted ? `${av}/${granted} kredi${note}` : `${av} kredi${note}`
}

// `isOwner` decides ONE thing here: whether the freeze dialog offers to go past the studio's own
// allowance (owner, 2026-07-31). It is not the authorization — the Server Action refuses anyone
// else regardless — it only decides whether the control is drawn, the same split the workspace
// already uses for training and refunds.
export function SubscriptionsPanel({ memberId, memberPhone = null, products, surchargeByProduct = {}, isOwner = false }: { memberId: string; memberPhone?: string | null; products: readonly ProductView[]; surchargeByProduct?: Record<string, number>; isOwner?: boolean }) {
  const [subs, setSubs] = useState<readonly SubscriptionView[] | null>(null)
  const [adding, setAdding] = useState(false)
  // Passive (expired/cancelled) packages are hidden by default — they clutter the card and confuse
  // (owner). A toggle reveals them when someone genuinely wants the history.
  const [showPast, setShowPast] = useState(false)

  const load = useCallback(async () => {
    setSubs(null)
    try {
      setSubs(await listMemberSubscriptionsAction({ memberId }))
    } catch {
      setSubs([])
      toast.error('Abonelikler yüklenemedi.')
    }
  }, [memberId])

  useEffect(() => {
    void load()
  }, [load])

  const active = subs?.filter((s) => s.status === 'active' || s.status === 'frozen') ?? []
  const past = subs?.filter((s) => s.status === 'expired' || s.status === 'cancelled') ?? []
  const activeProducts = products.filter((p) => p.active)

  return (
    <section className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Abonelikler</h3>
        {!adding ? (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} disabled={activeProducts.length === 0}>
            <PlusIcon />
            Yeni
          </Button>
        ) : null}
      </div>

      {adding ? (
        <AssignForm
          memberId={memberId}
          memberPhone={memberPhone}
          products={activeProducts}
          surchargeByProduct={surchargeByProduct}
          onCancel={() => setAdding(false)}
          onDone={() => {
            setAdding(false)
            void load()
          }}
        />
      ) : null}

      {subs === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
        </p>
      ) : subs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz abonelik yok.</p>
      ) : (
        <div className="space-y-2">
          {toCards(active).map((c) => (
            <SubscriptionRow key={c.primary.id} sub={c.primary} siblings={c.components} products={products} onChanged={load} isOwner={isOwner} />
          ))}
          {past.length > 0 ? (
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => setShowPast((v) => !v)}
                className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {showPast ? 'Pasif paketleri gizle' : `Pasif paketleri göster (${past.length})`}
              </button>
              {showPast
                ? toCards(past).map((c) => <SubscriptionRow key={c.primary.id} sub={c.primary} siblings={c.components} products={products} onChanged={load} isOwner={isOwner} />)
                : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

function SubscriptionRow({ sub, siblings, products, onChanged, isOwner = false }: { sub: SubscriptionView; siblings: readonly SubscriptionView[]; products: readonly ProductView[]; onChanged: () => void; isOwner?: boolean }) {
  const [open, setOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [dialog, setDialog] = useState<'amend' | 'credit' | 'status' | null>(null)
  // Freezing stops a paid membership. It fired on a single click with no confirmation and no summary
  // — the owner pressed it to see what it did and it simply did it (2026-07-28). An act that moves a
  // member's dates deserves a sentence about what is about to happen.
  const [freezeOpen, setFreezeOpen] = useState(false)
  const [freezeDays, setFreezeDays] = useState('')
  const [freezeReason, setFreezeReason] = useState<'tatil' | 'saglik' | 'is' | 'diger'>('tatil')
  const [freezeNote, setFreezeNote] = useState('')
  // The initiative, switched on for THIS dialog only (owner, 2026-07-31). It resets with the dialog,
  // because "the last freeze exceeded her allowance" must never be the reason the next one does.
  const [freezeOverride, setFreezeOverride] = useState(false)
  const [busy, setBusy] = useState(false)

  // Freeze and unfreeze are one click. The refusal — an upcoming booking, an exhausted budget — comes
  // back as a Turkish sentence, and NOTHING is fixed behind her back (owner, 2026-07-13).
  // A single act, whether it touches one entitlement or a bundle's several: run them in order, stop at
  // the first refusal (a Turkish sentence), and refresh once. NOTHING is fixed behind her back.
  const runAll = async (fns: (() => Promise<{ ok: boolean; error?: unknown }>)[], done: string) => {
    setBusy(true)
    try {
      for (const fn of fns) {
        const res = await fn()
        if (!res.ok) {
          toast.error(domainErrorMessage(res.error as never))
          return
        }
      }
      toast.success(done)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const expand = () => setOpen((o) => !o)

  // A bundle is shown as ONE card; `sub` is its primary (money/date/receipt face), `siblings` its parts.
  const bundle = siblings.length > 1
  const balance = sub.balanceDueKurus
  // Freeze lives on whichever part actually grants it (a Pilates part has none). Its state drives the
  // freeze UI; the action still fans out to every part that qualifies.
  const freezeSub = siblings.find((s) => (s.freezeEntitledDays ?? 0) > 0) ?? sub
  // ONE derivation for "may this be submitted", so the button and the explanation can never disagree
  // about it — the whole failure was a control that knew the answer and did not share it.
  const freezeNum = Number(freezeDays)
  const freezeMax = freezeSub.freezeDaysRemaining ?? 0
  const freezeOver = freezeDays.trim() !== '' && freezeNum > freezeMax
  // Only the owner is offered the initiative, and only where the product grants a freeze at all: a
  // Pilates package has no allowance to exceed, and giving it one is a catalogue change made once,
  // for everyone. The domain refuses it there too (`freeze_not_allowed`) whatever this says.
  const canOverride = isOwner && (freezeSub.freezeEntitledDays ?? 0) > 0
  // In force only when it is BOTH offered and ticked, and only while it is actually needed. So the
  // ordinary path cannot be reached through the exception, and an act stays an act.
  const overrideOn = canOverride && freezeOverride && freezeOver
  const overageDays = overrideOn ? freezeNum - freezeMax : 0
  // 365 is the Server Action's own ceiling. The screen names the same number so it can never offer
  // what the action will reject.
  const freezeCeiling = overrideOn ? 365 : freezeMax
  const freezeValid = Number.isInteger(freezeNum) && freezeNum >= 1 && freezeNum <= freezeCeiling
  // Which parts of a bundle stop. Normally those with budget left; under the initiative, every part
  // that HAS a freeze right at all — otherwise an approved fortnight would skip the exhausted half
  // of a hybrid and stop only one of two packages the member thinks of as one membership.
  const freezeTargets = siblings.filter(
    (x) =>
      x.status === 'active' &&
      (overrideOn ? (x.freezeEntitledDays ?? 0) > 0 : (x.freezeDaysRemaining ?? 0) > 0),
  )
  const groupFrozen = siblings.some((s) => s.status === 'frozen')
  const cardStatus = groupFrozen ? 'frozen' : siblings.every((s) => s.status === 'cancelled') ? 'cancelled' : 'active'
  const contentSummary = bundle
    ? siblings.map((s) => `${BUNDLE_CAT[s.category] ?? s.category} ${componentLine(s, products)}`).join(' · ')
    : componentLine(sub, products)

  return (
    <div className="rounded-xl border border-border">
      <button type="button" onClick={expand} className="flex w-full items-center justify-between gap-2 p-3 text-left">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{sub.productName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {dateLabel(sub.validFrom)} – {dateLabel(sub.validUntil)}
            {cardStatus === 'active' ? ` · ${Math.max(0, Math.ceil((sub.validUntil - Date.now()) / 86_400_000))} gün` : ''}
            {' · '}
            {contentSummary}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {balance > 0 ? <Badge className="bg-warning/10 text-warning">{tl(balance)} açık</Badge> : null}
          <Badge variant={cardStatus === 'cancelled' ? 'destructive' : 'outline'}>{STATUS_LABEL[cardStatus] ?? cardStatus}</Badge>
          <ChevronDownIcon className={`size-4 text-muted-foreground transition ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-border p-3">
          {/* A bundle's parts, each with what it holds — so ONE card still shows the pilates credit AND
              the fitness giriş, instead of two look-alike rows that read as a duplicate. */}
          {bundle ? (
            <div className="space-y-1 rounded-lg bg-muted/40 p-2 text-sm">
              {siblings.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{BUNDLE_CAT[s.category] ?? s.category}</span>
                  <span className="font-medium text-foreground">{componentLine(s, products)}</span>
                </div>
              ))}
            </div>
          ) : null}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Row label="Paket tutarı" value={tl(sub.priceAgreedKurus)} />
            <Row label="Tahsil edilen" value={tl(sub.paidKurus)} />
            <Row label="Kalan bakiye" value={tl(balance)} />
            <Row label="Ödeme yöntemi" value={sub.method ? (METHOD_LABEL[sub.method] ?? sub.method) : '—'} />
            {sub.note ? <Row label="Açıklama" value={sub.note} /> : null}
            {/* v1.27 S3 — her freeze budget. Shown only where it exists: a Pilates package has none,
                and a row that says "0 gün" would read as a right she has and cannot use. */}
            {freezeSub.freezeEntitledDays ? (
              <Row
                label="Dondurma hakkı"
                value={`${freezeSub.freezeDaysRemaining} / ${freezeSub.freezeEntitledDays} gün`}
              />
            ) : null}
            {freezeSub.frozenSince ? (
              <Row label="Donduruldu" value={`${freezeSub.frozenSince} tarihinden beri`} />
            ) : null}
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialog('amend')}>
              Düzenle
            </Button>
            {/* Hybrid → "Kredi/Giriş" opens ALL components (credit + giriş) in one screen. A plain credit
                package keeps "Kredi"; a fitness package with a giriş cap gets "Giriş hakkı". */}
            {bundle || sub.type === 'credit' || sub.entryAllowance != null ? (
              <Button variant="outline" size="sm" onClick={() => setDialog('credit')}>
                {bundle ? 'Kredi/Giriş' : sub.type === 'credit' ? 'Kredi' : 'Giriş hakkı'}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => setDialog('status')}>
              {cardStatus === 'cancelled' ? 'Aktifleştir' : 'Pasife Al'}
            </Button>

            {/* v1.27 S3 — the slip reception hands the member. Opens in a new tab, because she is
                about to print it and reception's screen must not go with her. The receipt is the sale,
                which lives on the primary. */}
            <a
              href={`/receipt/sale/${sub.id}`}
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
            >
              <PrinterIcon className="size-3.5" />
              Bilgi fişi
            </a>

            {/* FREEZE (v1.27 S3). Appears only where a part actually grants the right; freezing/unfreezing
                fans out to every part that qualifies, so the whole membership stops and resumes together. */}
        {/* ── Dondurma (owner, 2026-07-28) ───────────────────────────────────────────────────
          It fired on a single click: a paid membership stopped, with no confirmation and no way to
          know for how long. Now it asks the three things that make it a decision instead of a
          switch — how long, why, and (optionally) in whose words — and shows what will happen
          before it happens.

          THE DAYS ARE REAL. The nightly sweep resumes her on the planned day, so what this screen
          says is what the system will do. A number that only decorated a dialog would be worse than
          no number at all. */}
      <Dialog
        open={freezeOpen}
        onOpenChange={(o) => {
          setFreezeOpen(o)
          if (!o) {
            setFreezeDays('')
            setFreezeReason('tatil')
            setFreezeNote('')
            setFreezeOverride(false)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Üyeliği dondur</DialogTitle>
            <DialogDescription>
              {freezeSub.productName} · kalan dondurma hakkı {freezeSub.freezeDaysRemaining} gün
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="fz-days">
                Kaç gün dondurulacak?
              </label>
              <Input
                id="fz-days"
                type="number"
                min={1}
                max={canOverride ? 365 : freezeSub.freezeDaysRemaining ?? 1}
                value={freezeDays}
                onChange={(e) => setFreezeDays(e.target.value)}
                placeholder={`en fazla ${freezeSub.freezeDaysRemaining}`}
                autoFocus
              />
              {/* A DISABLED button that will not say why is indistinguishable from a broken one.
                  Reception typed 14 into a package that carries 7, the button greyed out in silence,
                  and the message that reached the owner was "dondur tuşu çalışmıyor" (2026-07-31).
                  The domain already refuses this — `freeze_days_exceed_budget`, never clamped — so
                  the screen's only job is to say so before she presses anything. */}
              {/* THE INITIATIVE (owner, 2026-07-31): *"admin yine de istediği kadar dondurabilsin,
                  bazı üyelere inisiyatif kullanabiliyoruz."* The allowance is the studio's standard,
                  not a wall — but exceeding it must be an ACT, so the refusal stays the default and
                  the tick is the only way past it. Reception sees the refusal, unchanged. */}
              {freezeOver && canOverride ? (
                <div className="mt-1.5 space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-2.5 text-sm">
                  <p className="text-warning">
                    Bu pakette {freezeMax} gün dondurma hakkı kaldı — {freezeDays} gün, hakkın{' '}
                    <strong>{freezeNum - freezeMax} gün üzerinde</strong>.
                  </p>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={freezeOverride}
                      onChange={(e) => setFreezeOverride(e.target.checked)}
                      className="mt-1 size-4 shrink-0 accent-warning"
                    />
                    <span className="text-foreground">
                      <strong>Hakkı aşarak dondur.</strong> Üyelik {freezeDays} gün durur ve süresi{' '}
                      {freezeDays} gün uzar. Kalan dondurma hakkı 0 güne iner ve bu istisna kayda
                      geçer.
                    </span>
                  </label>
                  {freezeMax >= 1 ? (
                    <button
                      type="button"
                      className="font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() => {
                        setFreezeDays(String(freezeMax))
                        setFreezeOverride(false)
                      }}
                    >
                      Vazgeç, {freezeMax} gün yap
                    </button>
                  ) : null}
                </div>
              ) : freezeOver ? (
                <p className="mt-1.5 text-sm text-danger">
                  Bu pakette {freezeSub.freezeDaysRemaining} gün dondurma hakkı kaldı — daha fazlası
                  girilemez.{' '}
                  {freezeMax >= 1 ? (
                    <button
                      type="button"
                      className="font-medium underline underline-offset-2"
                      onClick={() => setFreezeDays(String(freezeMax))}
                    >
                      {freezeMax} gün yap
                    </button>
                  ) : null}
                </p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="fz-reason">
                Sebep
              </label>
              {/* A closed list, not free text: the event log is permanent, and this is the field
                  that gets counted later ("kaç dondurma sağlık sebepli?"). */}
              <select
                id="fz-reason"
                value={freezeReason}
                onChange={(e) => setFreezeReason(e.target.value as typeof freezeReason)}
                className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="tatil">Tatil</option>
                <option value="saglik">Sağlık</option>
                <option value="is">İş / okul</option>
                <option value="diger">Diğer</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="fz-note">
                Not <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
              </label>
              <Input
                id="fz-note"
                value={freezeNote}
                onChange={(e) => setFreezeNote(e.target.value)}
                placeholder="Kendi notunuz — üye kaydında kalır"
              />
            </div>
          </div>

          {/* The summary. Everything here is computed from what she just typed, so there is no
              gap between what the screen promises and what the system does. */}
          {freezeValid ? (
            <div className="space-y-1 rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <Row label="Durma aralığı" value={`${studioToday()} → ${addDays(studioToday(), Number(freezeDays))}`} />
              <Row
                label="Bitiş tarihi"
                value={`${dateLabel(freezeSub.validUntil)} → ${addDays(toDateInput(freezeSub.validUntil), Number(freezeDays))}`}
              />
              {/* Never a negative number: under the initiative the allowance goes to zero and stops
                  there, which is exactly what her card will read afterwards. */}
              <Row label="Sonra kalan hak" value={`${Math.max(0, freezeMax - Number(freezeDays))} gün`} />
              {overageDays > 0 ? (
                <Row label="Hak dışı verilen" value={`${overageDays} gün`} />
              ) : null}
              {freezeTargets.length > 1 ? (
                <p className="pt-1 text-warning">
                  Bu demetteki {freezeTargets.length} paket birlikte dondurulacak.
                </p>
              ) : null}
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Üyelik durur ve durduğu gün sayısı kadar süresi uzar. Belirtilen günde sistem otomatik
            devam ettirir; daha erken açmak isterseniz “Dondurmayı kaldır” diyebilirsiniz.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFreezeOpen(false)} disabled={busy}>
              Vazgeç
            </Button>
            <Button
              disabled={busy || !freezeValid || freezeTargets.length === 0}
              onClick={async () => {
                const days = Number(freezeDays)
                // Read ONCE, here: the dialog closes immediately, and a flag re-read after the reset
                // would send the ordinary path under an approval the owner had already given.
                const override = overrideOn
                setFreezeOpen(false)
                await runAll(
                  freezeTargets.map(
                    (x) => () =>
                      freezeSubscriptionAction({
                        entitlementId: x.id,
                        plannedDays: days,
                        reason: freezeReason,
                        note: freezeNote.trim() || null,
                        override,
                      }),
                  ),
                  override ? 'Üyelik hak aşılarak donduruldu.' : 'Üyelik donduruldu.',
                )
              }}
            >
              {overrideOn ? 'Hakkı aşarak dondur' : 'Dondur'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

          {groupFrozen ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  runAll(
                    siblings.filter((s) => s.status === 'frozen').map((s) => () => unfreezeSubscriptionAction({ entitlementId: s.id })),
                    'Üyelik yeniden başladı.',
                  )
                }
              >
                Dondurmayı kaldır
              </Button>
            ) : freezeSub.status === 'active' &&
              // Reception sees the button while there is budget to spend. The owner sees it whenever
              // the package HAS a freeze right at all — an exhausted allowance is precisely the case
              // the initiative exists for, and a hidden button is a decision she cannot make.
              ((freezeSub.freezeDaysRemaining ?? 0) > 0 || (isOwner && (freezeSub.freezeEntitledDays ?? 0) > 0)) ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setFreezeOpen(true)}>
                Dondur
              </Button>
            ) : null}
          </div>

          {/* What the SWEEP will actually do, in a date. It used to say "hakkı N gün kaldı,
              dolduğunda sistem devam ettirir" — which stopped being true the day freezes got a
              planned end (a three-day freeze on a seven-day budget resumes on day three), and became
              actively misleading under an initiative, where the budget reads 7 and she returns on
              day 14. The date is read from the freeze, so the sentence cannot drift from the act. */}
          {groupFrozen ? (
            <p className="rounded-md bg-info/5 p-2 text-sm text-info">
              Üyelik durdu. Kaldırdığında, durduğu gün sayısı kadar süresi uzayacak.{' '}
              {freezeSub.freezeEndsOn ? (
                <>
                  Sistem <strong>{freezeSub.freezeEndsOn}</strong> tarihinde otomatik devam ettirir.
                </>
              ) : (
                <>
                  Dondurma hakkı <strong>{freezeSub.freezeDaysRemaining} gün</strong> kaldı,
                  dolduğunda sistem otomatik devam ettirir.
                </>
              )}
            </p>
          ) : null}

          {/* The PACKAGE TIMELINE (v1.22): purchased → credit held → consumed → extended →
              frozen → expired. Shown for the primary — the part that carries the sale. */}
          <div>
            {/* Collapsed by default — the timeline is dense and rarely needed during day-to-day use. */}
            <button
              type="button"
              onClick={() => setHistoryOpen((h) => !h)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Paket geçmişi
              <ChevronDownIcon className={`size-3.5 transition ${historyOpen ? 'rotate-180' : ''}`} />
            </button>
            {historyOpen ? (
              <div className="mt-1.5">
                <Timeline
                  key={sub.id}
                  lifecycle
                  load={() => packageTimelineAction({ entitlementId: sub.id })}
                  emptyLabel="Bu paket için henüz hareket yok."
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {dialog === 'amend' ? <AmendDialog sub={sub} siblings={siblings} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChanged() }} /> : null}
      {dialog === 'credit' ? <ContentDialog items={siblings} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChanged() }} /> : null}
      {dialog === 'status' ? <StatusDialog sub={sub} siblings={siblings} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChanged() }} /> : null}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </>
  )
}

// ── Assign a new subscription (the 10-step flow, inline) ──
function AssignForm({
  memberId,
  memberPhone = null,
  products,
  surchargeByProduct = {},
  onCancel,
  onDone,
}: {
  memberId: string
  memberPhone?: string | null
  products: readonly ProductView[]
  surchargeByProduct?: Record<string, number>
  onCancel: () => void
  onDone: () => void
}) {
  // No product pre-selected (owner): the dropdown starts on "Paket seç" so reception picks deliberately
  // instead of accidentally saving whatever happened to be first.
  const [productId, setProductId] = useState('')
  const product = products.find((p) => p.id === productId)
  // The non-cash surcharge for the SELECTED package (category rule, computed server-side). A default the
  // admin can override below — for a non-cash method it is added to what the member owes.
  const surchargeKurus = product ? surchargeByProduct[product.id] ?? 0 : 0
  // Hibrit demet: the admin edits each component's credit / entry count at the desk, pre-filled from the
  // catalogue. Index-aligned to product.components; sent as componentOverrides.
  const isBundle = (product?.components?.length ?? 0) > 0
  const [componentCounts, setComponentCounts] = useState<number[]>([])
  const [validFrom, setValidFrom] = useState(studioToday())
  const [validUntil, setValidUntil] = useState('')
  // Credit is a freely-editable STRING (owner): reception can clear it and type any number; it defaults
  // to the package's credit and is clamped to [0, packageCredit] only on save. `creditTouched` lets the
  // field go EMPTY while editing — before, clearing it snapped back to the package default ("sildirmiyor").
  const [creditInput, setCreditInput] = useState('')
  const [creditTouched, setCreditTouched] = useState(false)
  // Price is fixed to the package (read-only field), so this never changes — kept only so `effectivePrice`
  // and the collected default read from one place.
  const [priceTl] = useState('')
  const [collectedTl, setCollectedTl] = useState('')
  const [method, setMethod] = useState('cash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Sanal POS / Linkle Ödeme open the shared PAYTR checkout surface with this result.
  const [checkout, setCheckout] = useState<PaytrCheckout | null>(null)
  // A submit error is only meaningful for the inputs that produced it. The instant ANY field changes
  // (package, method, dates, amount, credit, bundle counts), the old "Geçerli bir tutar girin." is stale
  // — clear it in ONE place so no field can be forgotten (switching packages used to leave it lingering).
  useEffect(() => setError(null), [productId, method, validFrom, validUntil, collectedTl, creditInput, componentCounts])
  const paidRef = useRef(false) // set when a Sanal POS payment confirms — decides whether closing keeps the form

  const isPaytr = method === 'sanal_pos' || method === 'link'

  // Defaults follow the chosen product + start date.
  const autoUntil = useMemo(() => (product ? addDays(validFrom, product.durationDays) : ''), [product, validFrom])
  const effectiveUntil = validUntil || autoUntil
  const effectivePrice = priceTl !== '' ? priceTl : product ? (product.priceInKurus / 100).toString() : ''
  // The amount field defaults to the FULL amount owed — a normal sale is fully paid, so no phantom debt,
  // for ANY method. Non-cash (incl. Sanal POS / Link) adds the studio surcharge to what is owed. This is
  // the ONE editable amount the admin always controls (kontrol her zaman admin'de): for manual methods it
  // is what was COLLECTED (a lower value = real debt); for PAYTR it is what is CHARGED (and, for Link, the
  // debt the link collects).
  const owedKurus = (toKurus(effectivePrice) || 0) + (method !== 'cash' ? surchargeKurus : 0)
  const effectiveCollected = collectedTl !== '' ? collectedTl : owedKurus ? (owedKurus / 100).toString() : ''
  const effectiveCredit = creditInput !== '' ? creditInput : product?.creditCount != null ? String(product.creditCount) : ''
  const amountKurus = toKurus(effectiveCollected)
  const creditOverride =
    product?.type === 'credit'
      ? Math.min(product.creditCount ?? Infinity, Math.max(0, Math.trunc(Number(effectiveCredit) || 0)))
      : null

  function paytrError(res: { error: { code?: string } | unknown; providerError?: string } | { error: unknown }): string {
    const detail = 'providerError' in res && res.providerError ? ` — PAYTR: ${res.providerError}` : ''
    return domainErrorMessage((res as { error: Parameters<typeof domainErrorMessage>[0] }).error) + detail
  }

  async function submit() {
    if (!product) return
    setBusy(true)
    setError(null)
    try {
      if (method === 'sanal_pos') {
        const res = await createPackagePaymentAction({
          memberId,
          productId,
          flow: 'pos',
          priceAgreedKurus: amountKurus, // admin's charge, used verbatim (no re-surcharge)
          validFrom,
          validUntil: effectiveUntil || null,
          creditOverride,
          componentOverrides: isBundle ? componentCounts : null,
          note: '',
        })
        if (res.ok) setCheckout({ flow: 'pos', redirectUrl: res.value.redirectUrl, intentId: res.value.intentId })
        else setError(paytrError(res))
      } else if (method === 'link') {
        const res = await createPackageLinkSaleAction({
          memberId,
          productId,
          validFrom,
          validUntil: effectiveUntil || null,
          creditOverride,
          componentOverrides: isBundle ? componentCounts : null,
          note: '',
          amountKurus,
        })
        // Grant already happened (member is now borçlu); show the link to share.
        if (res.ok) setCheckout({ flow: 'link', redirectUrl: res.value.redirectUrl, intentId: res.value.intentId })
        else setError(paytrError(res))
      } else {
        const res = await assignSubscriptionAction({
          memberId,
          productId,
          validFrom,
          validUntil: effectiveUntil || null,
          priceAgreedKurus: toKurus(effectivePrice),
          creditOverride,
          componentOverrides: isBundle ? componentCounts : null,
          collectedKurus: amountKurus,
          method,
          note: '',
        })
        if (res.ok) {
          toast.success('Abonelik oluşturuldu.')
          onDone()
        } else {
          setError(domainErrorMessage(res.error))
        }
      }
    } catch (e) {
      setError(saveErrorMessage(e))
    }
    setBusy(false)
  }

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <Labeled label="Paket">
        <Select
          value={productId}
          onValueChange={(v) => {
            setProductId(v ?? '')
            // A new package resets the credit to that package's default (and re-enables the default view).
            setCreditInput('')
            setCreditTouched(false)
            // Seed the bundle component counts from the newly-picked package's catalogue defaults.
            const np = products.find((x) => x.id === v)
            setComponentCounts(np?.components?.map((c) => c.creditCount ?? c.entryAllowance ?? 0) ?? [])
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Paket seç" />
          </SelectTrigger>
          {/* Wider popup + no truncation: package names (esp. hybrids) are long and were getting cut. */}
          <SelectContent className="max-h-[60vh] min-w-[min(28rem,88vw)]">
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id} className="whitespace-nowrap py-2.5">
                {p.name} · {tl(p.priceInKurus)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Labeled>

      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Başlangıç">
          <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </Labeled>
        <Labeled label="Bitiş">
          <Input type="date" value={effectiveUntil} onChange={(e) => setValidUntil(e.target.value)} />
          {!product ? <p className="mt-1 text-xs text-muted-foreground">Paket seçince otomatik hesaplanır.</p> : null}
        </Labeled>
        {isBundle ? (
          <div className="col-span-2 space-y-1.5">
            <p className="text-sm font-medium text-foreground">İçerik (düzenlenebilir)</p>
            {product!.components!.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-28 text-sm text-muted-foreground">{BUNDLE_CAT[c.category] ?? c.category}</span>
                <Input
                  type="number"
                  min={0}
                  className="w-24"
                  value={componentCounts[i] ?? 0}
                  onChange={(e) =>
                    setComponentCounts((cs) => cs.map((x, idx) => (idx === i ? Math.max(0, Number(e.target.value) || 0) : x)))
                  }
                />
                <span className="text-sm text-muted-foreground">{c.creditCount != null ? 'kredi' : 'giriş'}</span>
              </div>
            ))}
          </div>
        ) : product?.type === 'credit' ? (
          <Labeled label="Kredi">
            {/* Freely editable (owner): a raw string so reception can clear and retype any number.
                Before touch, shows the package default; after touch, shows exactly what's typed (may be
                empty). Empty still SAVES as the package default (never an accidental 0). */}
            <Input
              type="number"
              min={0}
              value={creditTouched ? creditInput : effectiveCredit}
              onChange={(e) => {
                setCreditInput(e.target.value)
                setCreditTouched(true)
              }}
            />
          </Labeled>
        ) : null}
        <Labeled label="Paket tutarı (TL)">
          {/* Fixed to the package price (owner): reception records how much was COLLECTED, never edits
              what the package costs. A different agreed price is a discount decision, not a data-entry one. */}
          <Input type="number" value={effectivePrice} disabled readOnly />
        </Labeled>
        <Labeled label={isPaytr ? 'Tahsil edilecek tutar (TL)' : 'Tahsilat (TL)'}>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={effectiveCollected}
            onChange={(e) => setCollectedTl(e.target.value)}
            placeholder="0"
          />
        </Labeled>
        <Labeled label="Ödeme yöntemi">
          <Select
            value={method}
            onValueChange={(v) => setMethod(v ?? 'cash')}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(METHOD_LABEL).map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
              <SelectItem value="sanal_pos">Sanal POS</SelectItem>
              <SelectItem value="link">Linkle Ödeme</SelectItem>
            </SelectContent>
          </Select>
        </Labeled>
        {method === 'credit_card' || method === 'bank_transfer' ? (
          surchargeKurus > 0 ? (
            <p className="col-span-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
              Kart/havale farkı +{tl(surchargeKurus)} · üyeye toplam{' '}
              <strong className="text-foreground">{tl((toKurus(effectivePrice) || 0) + surchargeKurus)}</strong>
            </p>
          ) : null
        ) : null}
        {isPaytr ? (
          <p className="col-span-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            {method === 'sanal_pos'
              ? 'Kart formu (taksit + 3D) panelde açılır; ödeme onaylanınca paket atanır.'
              : 'Paket hemen atanır (üye borçlu görünür); link ödenince borç otomatik kapanır ve kasaya işlenir.'}
            {surchargeKurus > 0 ? ' Tutar kart farkını içerir; düzenleyebilirsiniz.' : ''}
          </p>
        ) : null}
      </div>

      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel} disabled={busy}>
          Vazgeç
        </Button>
        <Button className="flex-1" onClick={submit} disabled={busy || !product}>
          {busy ? <Loader2Icon className="animate-spin" /> : null}
          {method === 'sanal_pos' ? 'Ödemeyi Başlat' : method === 'link' ? 'Link Oluştur' : 'Kaydet'}
        </Button>
      </div>

      <PaytrCheckoutDialog
        checkout={checkout}
        memberId={memberId}
        memberPhone={memberPhone}
        title="PAYTR ile Paket Sat"
        onPaid={() => {
          paidRef.current = true
        }}
        onClose={() => {
          // Close the form (and reload) ONLY when something actually landed: a confirmed Sanal POS
          // payment, or a Link sale (the package was already granted). A Sanal POS closed BEFORE payment
          // must keep the form exactly as reception filled it — she may retry or switch method.
          const settled = paidRef.current || checkout?.flow === 'link'
          paidRef.current = false
          setCheckout(null)
          if (settled) onDone()
        }}
      />
    </div>
  )
}

function ReasonDialogShell({
  title,
  description,
  children,
  reason,
  setReason,
  busy,
  onClose,
  onSubmit,
  submitLabel = 'Kaydet',
  destructive = false,
}: {
  title: string
  description?: string
  children?: React.ReactNode
  reason: string
  setReason: (v: string) => void
  busy: boolean
  onClose: () => void
  onSubmit: () => void
  submitLabel?: string
  destructive?: boolean
}) {
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        <Textarea placeholder="Sebep (opsiyonel)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={onSubmit} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Editing a package changes DATES and PRICE. It does not take money.
//
// It used to (Alpha Review): a "Tahsilat" box here wrote a payment onto the entitlement — the second
// money model, invisible to the till, the reports and the cari hesap. Money is taken in ONE place now,
// the Cari Hesap tab, where it lands in the ledger and in the kasa. Two ways to record a payment are
// two answers to "has she paid?", and reception would have had no way to know which one was believed.
function AmendDialog({ sub, siblings, onClose, onDone }: { sub: SubscriptionView; siblings: readonly SubscriptionView[]; onClose: () => void; onDone: () => void }) {
  const [validFrom, setValidFrom] = useState(toDateInput(sub.validFrom))
  const [validUntil, setValidUntil] = useState(toDateInput(sub.validUntil))
  // The package's original length in days, taken from what it was sold as. While reception hasn't
  // hand-edited the end, changing the START shifts the END by this same length — so moving a start date
  // keeps the package's duration ("paket özelliğine göre") instead of leaving a stale end behind.
  const originalDurationDays =
    sub.validUntil && sub.validFrom ? Math.round((sub.validUntil - sub.validFrom) / 86_400_000) : null
  const [endPinned, setEndPinned] = useState(false)
  const autoUntil = originalDurationDays && originalDurationDays > 0 ? addDays(validFrom, originalDurationDays) : ''
  const effectiveUntil = endPinned ? validUntil : autoUntil || validUntil
  const [priceTl, setPriceTl] = useState((sub.priceAgreedKurus / 100).toString())
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      // Dates apply to EVERY part so a bundle stays in sync; the price sits on the primary alone (the
      // other parts are priced 0 — the bundle's whole price is on the one that carries the sale).
      for (const s of siblings) {
        const res = await amendSubscriptionAction({
          entitlementId: s.id,
          reason: reason.trim(),
          validFrom,
          validUntil: effectiveUntil,
          ...(s.id === sub.id ? { priceAgreedKurus: toKurus(priceTl) } : {}),
        })
        if (!res.ok) {
          toast.error(domainErrorMessage(res.error))
          setBusy(false)
          return
        }
      }
      toast.success('Güncellendi.')
      onDone()
    } catch {
      toast.error('Kaydedilemedi.')
      setBusy(false)
    }
  }

  return (
    <ReasonDialogShell title="Aboneliği düzenle" reason={reason} setReason={setReason} busy={busy} onClose={onClose} onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Başlangıç">
          <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </Labeled>
        <Labeled label="Bitiş">
          <Input
            type="date"
            value={effectiveUntil}
            onChange={(e) => {
              setValidUntil(e.target.value)
              setEndPinned(true)
            }}
          />
        </Labeled>
        <Labeled label="Paket tutarı (TL)">
          <Input type="number" min={0} step="0.01" value={priceTl} onChange={(e) => setPriceTl(e.target.value)} />
        </Labeled>
      </div>
      {!endPinned && originalDurationDays && originalDurationDays > 0 ? (
        <p className="text-xs text-muted-foreground">
          Bitiş, başlangıca göre paketin süresi ({originalDurationDays} gün) kadar otomatik hesaplanır. Elle
          değiştirebilirsiniz.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Tahsilat burada yapılmaz. Ödeme almak için <strong>Cari Hesap</strong> sekmesini kullanın —
        para orada kasaya ve raporlara işler.
      </p>
    </ReasonDialogShell>
  )
}

// Editing a package's grant — ABSOLUTE (owner): the field shows the CURRENT amount and reception types
// the NEW total ("17 → 4"), never a delta. Handles ONE or MANY components in a single screen: a HYBRID
// (demet) grants a credit part AND a giriş part, and the desk edits both here. A credit component moves
// through the credit ledger (adjust); a fitness giriş moves the granted allowance (amend the snapshot).
// Each value is a raw STRING so the box can be cleared and retyped (a number-bound value locked "04").
function ContentDialog({ items, onClose, onDone }: { items: readonly SubscriptionView[]; onClose: () => void; onDone: () => void }) {
  // Only components with something to edit: a credit count, or a fitness giriş cap. A pure-unlimited
  // period part (no cap) has no number to change and is left out.
  const editable = items.filter((s) => s.type === 'credit' || s.entryAllowance != null)
  const currentOf = (s: SubscriptionView) => (s.type === 'credit' ? (s.creditsAvailable ?? 0) : (s.entryAllowance ?? 0))
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((s) => [s.id, String(currentOf(s))])),
  )
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const multi = editable.length > 1
  const unitOf = (s: SubscriptionView) => (s.type === 'credit' ? 'kredi' : 'giriş')

  async function submit() {
    // A credit component adjusts by the signed delta; a giriş re-grants the absolute allowance. Skip the
    // ones that did not change; refuse a no-op so a blank save is not mistaken for success.
    const ops: Promise<{ ok: boolean; error?: unknown }>[] = []
    for (const s of editable) {
      const target = Math.max(0, Math.trunc(Number(values[s.id]) || 0))
      const current = currentOf(s)
      if (target === current) continue
      ops.push(
        s.type === 'credit'
          ? adjustSubscriptionCreditsAction({ entitlementId: s.id, delta: target - current, note: reason.trim() })
          : amendSubscriptionAction({ entitlementId: s.id, entryAllowance: target, reason: reason.trim() }),
      )
    }
    if (ops.length === 0) {
      toast.error('Değişiklik yok.')
      return
    }
    setBusy(true)
    try {
      const results = await Promise.all(ops)
      const bad = results.find((r) => !r.ok)
      if (bad && !bad.ok) {
        toast.error(domainErrorMessage((bad as { error: Parameters<typeof domainErrorMessage>[0] }).error))
        setBusy(false)
        return
      }
      toast.success('Güncellendi.')
      onDone()
    } catch {
      toast.error('Kaydedilemedi.')
      setBusy(false)
    }
  }

  const single = editable[0]
  return (
    <ReasonDialogShell
      title={multi ? 'Kredi/Giriş düzenle' : single?.type === 'credit' ? 'Krediyi düzelt' : 'Giriş hakkını düzelt'}
      description={
        multi || !single
          ? 'Paketin her bölümünü ayrı ayrı düzenleyin.'
          : `Mevcut ${unitOf(single)}: ${currentOf(single)}. Yeni ${unitOf(single)} sayısını girin.`
      }
      reason={reason}
      setReason={setReason}
      busy={busy}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="space-y-2">
        {editable.map((s) => (
          <div key={s.id} className="flex items-center gap-2">
            {multi ? <span className="w-24 shrink-0 text-sm text-muted-foreground">{BUNDLE_CAT[s.category] ?? s.category}</span> : null}
            <Input
              type="number"
              min={0}
              value={values[s.id] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [s.id]: e.target.value }))}
            />
            <span className="w-12 shrink-0 text-sm text-muted-foreground">{unitOf(s)}</span>
          </div>
        ))}
      </div>
    </ReasonDialogShell>
  )
}

function StatusDialog({ sub, siblings, onClose, onDone }: { sub: SubscriptionView; siblings: readonly SubscriptionView[]; onClose: () => void; onDone: () => void }) {
  const reactivating = sub.status === 'cancelled'
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      // A bundle is one membership: pasife al/ aktifleştir fans out to every part, or half the package
      // would be live and half not. Stop at the first refusal so nothing is half-done silently.
      for (const s of siblings) {
        const res = reactivating
          ? await reactivateSubscriptionAction({ entitlementId: s.id, reason: reason.trim() })
          : await cancelSubscriptionAction({ entitlementId: s.id, reason: reason.trim() })
        if (!res.ok) {
          toast.error(domainErrorMessage(res.error))
          setBusy(false)
          return
        }
      }
      toast.success(reactivating ? 'Aktifleştirildi.' : 'Pasife alındı.')
      onDone()
    } catch {
      toast.error('İşlem tamamlanamadı.')
      setBusy(false)
    }
  }

  return (
    <ReasonDialogShell
      title={reactivating ? 'Aboneliği aktifleştir' : 'Aboneliği pasife al'}
      reason={reason}
      setReason={setReason}
      busy={busy}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={reactivating ? 'Aktifleştir' : 'Pasife Al'}
      destructive={!reactivating}
    />
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </div>
  )
}
