'use client'

import { useEffect, useState } from 'react'
import { Loader2Icon, MinusIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { domainErrorMessage } from '@/lib/domain-error'
import { isStaleDeployment, STALE_DEPLOYMENT_MESSAGE } from '@/lib/stale-deployment'
import { listRetailProductsAction, sellRetailProductAction, type RetailProductRow } from '@/server/actions/retail'

// ── KAFE SATIŞI (owner, 2026-09-04) ─────────────────────────────────────────────────────────
//
// *"Stüdyoda kahve su içiyorlar ödemeden gidiyorlar. Biz bunları üyeye atayalım, gün saat olarak
// adet olarak hesabı burada görsün, isterse ödesin."*
//
// Ürün satış ekranı zaten vardı ama ÖDEME ZORUNLUYDU — nakit/havale/kart/cüzdan. Kahvenin sorunu tam
// olarak buydu: o an ödeme yok. Eksik olan yeni bir defter değil, var olan defterin "şimdi tahsil
// etme" seçeneğiydi (`sell`de `payment: null` zaten yasal, borç `balanceDue`ya düşer).
//
// AYRI BİR ADİSYON DEFTERİ AÇILMADI. İki defter, "üye ne kadar borçlu" sorusunun iki cevabı demektir
// ve bu üründe o hatanın bedeli bu hafta iki kez ödendi. Kafe borcu Cari Hesap'ta, panodaki
// "açık bakiye" listesinde ve üyenin telefonunda AYNI kayıttan okunuyor.
//
// Bu sekme, ürün satış ekranının üyeye sabitlenmiş hâli: masadaki soru "kim içti" değil, "AYŞE ne
// içti" — üyeyi her seferinde aramak, günde on kez yapılan bir işte on kez fazladan tıklamadır.

export function CafePanel({ memberId, memberName }: { memberId: string; memberName: string }) {
  const [products, setProducts] = useState<readonly RetailProductRow[]>([])
  const [qty, setQty] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void listRetailProductsAction()
      .then((r) => setProducts(r.filter((p) => p.active)))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false))
  }, [])

  const secili = Object.entries(qty).filter(([, n]) => n > 0)
  const toplam = secili.reduce((sum, [id, n]) => sum + (products.find((p) => p.id === id)?.priceInKurus ?? 0) * n, 0)
  const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`
  const artir = (id: string, d: number) => setQty((q) => ({ ...q, [id]: Math.max(0, (q[id] ?? 0) + d) }))

  async function sat(method: 'account' | 'cash' | 'credit_card' | 'wallet') {
    if (secili.length === 0) return
    setBusy(true)
    try {
      const r = await sellRetailProductAction({
        memberId,
        items: secili.map(([retailProductId, quantity]) => ({ retailProductId, quantity })),
        method,
      })
      if (r.ok) {
        toast.success(method === 'account' ? `${tl(toplam)} ${memberName} hesabına yazıldı.` : `${tl(toplam)} tahsil edildi.`)
        setQty({})
        // Stok düştü: raf sayıları ekranda kalmasın.
        void listRetailProductsAction().then((x) => setProducts(x.filter((p) => p.active)))
      } else {
        toast.error(domainErrorMessage(r.error))
      }
    } catch (e) {
      toast.error(isStaleDeployment(e) ? STALE_DEPLOYMENT_MESSAGE : 'Satış kaydedilemedi.')
    }
    setBusy(false)
  }

  if (loading) return <p className="py-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
  if (products.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
        Henüz ürün tanımlı değil. Ayarlar → Ürünler’den su, kahve gibi ürünleri ekleyin.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-1.5">
        {products.map((p) => {
          const n = qty[p.id] ?? 0
          return (
            <li key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {tl(p.priceInKurus)}
                  {/* Stok yalnızca TAKİP EDİLİYORSA yazılıyor: takip edilmeyen bir üründe "0 adet"
                      görmek, satılamaz sanmaya yeter. */}
                  {p.trackStock ? ` · stok ${p.stock}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon-sm" aria-label="Azalt" disabled={n === 0} onClick={() => artir(p.id, -1)}>
                  <MinusIcon />
                </Button>
                <span className="w-6 text-center text-sm tabular-nums">{n}</span>
                <Button variant="outline" size="icon-sm" aria-label="Artır" onClick={() => artir(p.id, 1)}>
                  <PlusIcon />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      {secili.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Toplam</span>
            <span className="text-lg font-semibold tabular-nums text-foreground">{tl(toplam)}</span>
          </div>
          {/* HESABA YAZ ÖNCE ve birincil: bu ekranın var olma sebebi o. Diğerleri, üye o an ödemek
              isterse diye duruyor — ürün satış ekranına gitmesi gerekmesin. */}
          <Button className="w-full" disabled={busy} onClick={() => void sat('account')}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Hesabına yaz
          </Button>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void sat('cash')}>
              Nakit
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void sat('credit_card')}>
              Kart
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void sat('wallet')}>
              Cüzdan
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Hesabına yazılan tutar Cari Hesap’ta ve üyenin uygulamasında görünür; nakit/kart açık kasaya işlenir.
          </p>
        </div>
      ) : null}
    </div>
  )
}
