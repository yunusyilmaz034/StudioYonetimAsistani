'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDownIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { domainErrorMessage } from '@/lib/domain-error'
import { isStaleDeployment, STALE_DEPLOYMENT_MESSAGE } from '@/lib/stale-deployment'
import { listDrawersAction, withdrawCashAction } from '@/server/actions/finance'
import { Section } from '@/components/ui/section'
import { loadCashMovementsAction } from '@/server/actions/cash-movements'
import type { CashMovement } from '@/server/cash-movements'

// ── KASA HAREKETLERİ (owner, 2026-09-04) ────────────────────────────────────────────────────
//
// *"Nakit ne kadar, KK ne kadar diye ödeme tiplerine göre filtrelesin; günlük/haftalık/aylık/yıllık
// gruplasın; tıklayınca o gün kimden ne geldi gitti görelim."*
//
// Gruplama pencerenin İÇİNDE yapılıyor — her tıkta sunucuya gitmek, her tıkta beklemek demek.

const TZ = 'Europe/Istanbul'
const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`
type Period = 'day' | 'week' | 'month' | 'year'
const PERIOD_LABEL: Record<Period, string> = { day: 'Günlük', week: 'Haftalık', month: 'Aylık', year: 'Yıllık' }

/** Bir anın hangi gruba düştüğü — anahtar SIRALANABİLİR olmalı, çünkü liste ona göre diziliyor. */
function bucketKey(at: number, p: Period): string {
  const d = new Date(at)
  const iso = d.toLocaleDateString('en-CA', { timeZone: TZ }) // yyyy-mm-dd
  if (p === 'day') return iso
  if (p === 'month') return iso.slice(0, 7)
  if (p === 'year') return iso.slice(0, 4)
  // HAFTA PAZARTESİ BAŞLAR. Stüdyonun haftası pazartesi başlıyor; `getDay()`in pazar-başlangıcını
  // kullanmak, pazar günü gelen parayı bir önceki haftaya yazardı.
  const [y, m, day] = iso.split('-').map(Number)
  const utc = Date.UTC(y!, m! - 1, day!)
  const dow = (new Date(utc).getUTCDay() + 6) % 7
  return new Date(utc - dow * 86_400_000).toISOString().slice(0, 10)
}

function bucketLabel(key: string, p: Period): string {
  if (p === 'year') return key
  if (p === 'month') {
    const [y, m] = key.split('-')
    return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString('tr-TR', { timeZone: 'UTC', month: 'long', year: 'numeric' })
  }
  const d = new Date(`${key}T12:00:00Z`)
  const g = d.toLocaleDateString('tr-TR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })
  if (p === 'day') return g
  const son = new Date(d.getTime() + 6 * 86_400_000).toLocaleDateString('tr-TR', { timeZone: 'UTC', day: 'numeric', month: 'long' })
  return `${g.replace(/ \d{4}$/, '')} – ${son}`
}

export function MovementsPanel({ isOwner, onChanged }: { isOwner: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<readonly CashMovement[] | null>(null)
  const [period, setPeriod] = useState<Period>('day')
  const [kind, setKind] = useState<string>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [cikis, setCikis] = useState(false)

  const yenile = () => {
    const toMs = Date.now()
    void loadCashMovementsAction({ fromMs: toMs - 365 * 86_400_000, toMs }).then(setRows).catch(() => {})
  }

  useEffect(() => {
    // Varsayılan pencere: son 12 ay. Yıllık gruplama bunu iki takvim yılına bölebilir ve bu doğrudur —
    // "son 12 ay" bir takvim yılı değildir, ve ekran hangisini gösterdiğini başlıkta söylüyor.
    const toMs = Date.now()
    const fromMs = toMs - 365 * 86_400_000
    void loadCashMovementsAction({ fromMs, toMs })
      .then(setRows)
      .catch(() => setRows([]))
  }, [])

  const kinds = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows ?? []) m.set(r.kind, r.label)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'tr'))
  }, [rows])

  const gruplar = useMemo(() => {
    // İPTALLER LİSTEDE, TOPLAMDA DEĞİL (I-31): bir ödeme düzeltilmez, iptal edilir — ve hatayı
    // gizleyen bir liste kasayla karşılaştırılamaz.
    const filtered = (rows ?? []).filter((r) => kind === 'all' || r.kind === kind)
    const map = new Map<string, { girdi: number; cikti: number; satirlar: CashMovement[] }>()
    for (const r of filtered) {
      const k = bucketKey(r.at, period)
      const g = map.get(k) ?? { girdi: 0, cikti: 0, satirlar: [] }
      if (!r.voided) {
        if (r.direction === 'in') g.girdi += r.amountKurus
        else g.cikti += r.amountKurus
      }
      g.satirlar.push(r)
      map.set(k, g)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [rows, period, kind])

  const toplamGirdi = gruplar.reduce((n, [, g]) => n + g.girdi, 0)
  const toplamCikti = gruplar.reduce((n, [, g]) => n + g.cikti, 0)

  return (
    <Section title="Kasa Hareketleri" hint="Son 12 ay. Bir satıra dokun, o dönemde kimden ne geldi ve nereye ne gittiği açılır.">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {(['day', 'week', 'month', 'year'] as const).map((p) => (
            <Button key={p} size="sm" variant={period === p ? 'default' : 'outline'} onClick={() => { setPeriod(p); setOpen(null) }}>
              {PERIOD_LABEL[p]}
            </Button>
          ))}
        </div>
        {/* PARA ÇIKARMAK OWNER'A ÖZEL. Tahsilat resepsiyonun işi; kasadan para çıkarmak bir HARCAMA
            kararıdır ve o kararın sahibi stüdyonun sahibidir (AD-46 hattı). Server Action da aynı
            şeyi zorluyor — düğmeyi gizlemek yetki değil, nezakettir. */}
        {isOwner ? (
          <Button size="sm" variant="outline" onClick={() => setCikis(true)}>
            Kasadan para çıkar
          </Button>
        ) : null}
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
          aria-label="Ödeme tipi"
        >
          <option value="all">Tüm tipler</option>
          {kinds.map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
      </div>

      {rows === null ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
      ) : gruplar.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          Bu filtrede hareket yok.
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-border bg-card px-3 py-2 text-sm">
            <span className="text-muted-foreground">Giren <strong className="tabular-nums text-success">{tl(toplamGirdi)}</strong></span>
            {/* ÇIKIŞ SATIRI YALNIZCA VARSA. Sıfır bir çıkış toplamı, "hiç para çıkmıyor" diye okunur —
                oysa doğrusu "henüz kimse girmedi"dir, ve ikisi aynı şey değildir. */}
            {toplamCikti > 0 ? (
              <span className="text-muted-foreground">Çıkan <strong className="tabular-nums text-danger">{tl(toplamCikti)}</strong></span>
            ) : null}
            {toplamCikti > 0 ? (
              <span className="text-muted-foreground">Net <strong className="tabular-nums text-foreground">{tl(toplamGirdi - toplamCikti)}</strong></span>
            ) : null}
          </div>

          <ul className="space-y-1.5">
            {gruplar.map(([key, g]) => {
              const acik = open === key
              return (
                <li key={key} className="overflow-hidden rounded-xl border border-border bg-card">
                  <button type="button" onClick={() => setOpen(acik ? null : key)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{bucketLabel(key, period)}</span>
                    <span className="shrink-0 text-sm tabular-nums text-success">{tl(g.girdi)}</span>
                    {g.cikti > 0 ? <span className="shrink-0 text-sm tabular-nums text-danger">−{tl(g.cikti)}</span> : null}
                    <ChevronDownIcon className={`size-4 shrink-0 text-muted-foreground transition-transform ${acik ? 'rotate-180' : ''}`} />
                  </button>
                  {acik ? (
                    <ul className="divide-y divide-border/50 border-t border-border/50 bg-background/40">
                      {g.satirlar.map((r) => (
                        <li key={r.id} className={`flex flex-wrap items-baseline gap-x-2 px-3 py-2 text-sm ${r.voided ? 'opacity-55' : ''}`}>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {new Date(r.at).toLocaleString('tr-TR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-foreground">{r.who}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{r.label}</span>
                          <span className={`shrink-0 tabular-nums ${r.direction === 'in' ? 'text-success' : 'text-danger'}`}>
                            {r.direction === 'in' ? '' : '−'}{tl(r.amountKurus)}
                          </span>
                          {r.voided ? <span className="shrink-0 text-xs text-danger">İPTAL</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {cikis ? (
        <WithdrawDialog
          onClose={() => setCikis(false)}
          onDone={() => {
            setCikis(false)
            yenile()
            onChanged()
          }}
        />
      ) : null}
    </Section>
  )
}

// ── KASADAN PARA ÇIKARMA ────────────────────────────────────────────────────────────────────
//
// Dört kategori ve kapalı bir liste: serbest metin, altı ay sonra aynı şeyin dört yazımını
// ("eğitmen", "hoca ödemesi", "Buse", "maaş") ve toplanamayan bir raporu üretir.
//
// `owner_draw` ayrı duruyor ve gidere karışmıyor: owner'ın kasadan aldığı para stüdyonun MALİYETİ
// değildir, ve gidere yazılırsa işletme olduğundan pahalı görünür.
function WithdrawDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [drawers, setDrawers] = useState<readonly { id: string; name: string; status: string; expected: number }[]>([])
  const [drawerId, setDrawerId] = useState('')
  const [category, setCategory] = useState<'trainer_pay' | 'bank_deposit' | 'expense' | 'owner_draw'>('bank_deposit')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void listDrawersAction()
      .then((d) => {
        const acik = d.filter((x) => x.status === 'open')
        setDrawers(acik)
        setDrawerId(acik[0]?.id ?? '')
      })
      .catch(() => setDrawers([]))
  }, [])

  const secili = drawers.find((d) => d.id === drawerId)
  const kurus = Math.round(Number(amount.replace(',', '.')) * 100)
  const gecerli = Boolean(drawerId) && Number.isFinite(kurus) && kurus > 0 && reason.trim().length > 0
  // Kasada olandan fazlası ekranda da söyleniyor: domain zaten reddediyor (`drawer_insufficient`),
  // ama reddedilmeyi beklemek yerine önden söylemek bir tıkı ve bir hayal kırıklığını siliyor.
  const yetersiz = secili != null && Number.isFinite(kurus) && kurus > secili.expected

  async function cikar() {
    setBusy(true)
    try {
      const r = await withdrawCashAction({ drawerId, category, amountKurus: kurus, reason: reason.trim() })
      if (r.ok) {
        toast.success('Kasa çıkışı kaydedildi.')
        onDone()
      } else {
        toast.error(domainErrorMessage(r.error))
      }
    } catch (e) {
      toast.error(isStaleDeployment(e) ? STALE_DEPLOYMENT_MESSAGE : 'Kaydedilemedi.')
    }
    setBusy(false)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Kasadan para çıkar</DialogTitle>
          <DialogDescription>
            Bankaya yatırma, eğitmen ödemesi ya da gider. Kasa bu tutar kadar düşer ve hareket listesinde görünür.
          </DialogDescription>
        </DialogHeader>

        {drawers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Açık kasa yok. Önce kasayı açın.</p>
        ) : (
          <div className="space-y-3">
            {drawers.length > 1 ? (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Kasa</label>
                <select value={drawerId} onChange={(e) => setDrawerId(e.target.value)} className="w-full rounded-lg border border-border bg-card px-2 py-2 text-sm">
                  {drawers.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Ne için</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className="w-full rounded-lg border border-border bg-card px-2 py-2 text-sm">
                <option value="bank_deposit">Bankaya yatırma</option>
                <option value="trainer_pay">Eğitmen ödemesi</option>
                <option value="expense">Gider (kira, malzeme, fatura)</option>
                <option value="owner_draw">Sahip çekimi</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tutar (₺)</label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
              {secili ? (
                <p className={`text-xs ${yetersiz ? 'text-danger' : 'text-muted-foreground'}`}>
                  {secili.name} kasasında görünen: {tl(secili.expected)}
                  {yetersiz ? ' — bundan fazlası çıkarılamaz.' : ''}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Sebep</label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ör. Ziraat'e yatırıldı · Buse Hoca Ağustos" />
              {/* Sebep zorunlu ve sebebi yazılı: altı ay sonra "para nereye gitti" sorusunun tek
                  cevabı bu alan. Domain de boş sebebi reddediyor. */}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={busy || !gecerli || yetersiz || drawers.length === 0} onClick={() => void cikar()}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Çıkışı kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
