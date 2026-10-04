'use client'

import { useState } from 'react'
import { Loader2Icon, TriangleAlertIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { domainErrorMessage } from '@/lib/domain-error'
import { bookReservationAction, type ExemptionOption } from '@/server/actions/reservations'

// ── ENGELE RAĞMEN REZERVASYON (owner, 2026-10-02) ───────────────────────────────────────────
//
// *"Üyenin paketinin tarihi bitiyor, biz bitse de inisiyatif kullanıp süre dışındaki bir yere
// rezervasyon yapmak istiyoruz. Paketi yok ya da başka engeli varsa uyarı olarak çıkarsın, yine de
// 'kabul et rezervasyon yap' derse rezervasyon yapsın."*
//
// Bu diyalog bir ONAY ekranı değil, bir UYARI ekranı: engeli adıyla söyler, ne olacağını önceden
// yazar, ve sebebi ZORUNLU tutar. Sebep alanı nezaket değil — istisnanın tek kalıcı izi o, ve
// olmadığı gün "kuralımızı neden esnettik" sorusu cevapsız kalıyor (#9).
//
// GENİŞLETİLDİ (owner, 2026-10-04): *"bu tür şeylerde adminin dediğini her türlü yap, logla sadece
// — bu esnekliğimizi azaltıyor."* Artık kontenjan, kategori duvarı, hizmet kapsamı ve paketin
// durumu (iptal/dondurulmuş dahil) da aşılabiliyor. Her satır paketin DURUMUNU yazıyor, çünkü
// masanın neyin üstüne yazdığını görmeden seçmesi esneklik değil körlük olurdu.
//
// Hâlâ aşılmayan iki şey var ve ikisi de esneklik değil kayıt hatası olurdu: aynı kişiyi aynı derse
// iki kez yazmak (`already_booked`), ve geçmiş ders — onun kendi kapısı var (backdating, OR-24).

const gun = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })

// Paketin durumu ekranda ADIYLA yazılı. İzin artık iptal edilmiş ve dondurulmuş paketleri de açıyor
// (owner, 2026-10-04); masanın neyin üstüne yazdığını görmeden seçmesi esneklik değil körlük olurdu.
const DURUM: Record<ExemptionOption['status'], string> = {
  active: 'Aktif',
  expired: 'Süresi doldu',
  cancelled: 'İPTAL EDİLMİŞ',
  frozen: 'DONDURULMUŞ',
}

export function CreditExemptionDialog({
  memberId,
  sessionId,
  memberName,
  options,
  refusal,
  onDone,
  onClose,
}: {
  memberId: string
  sessionId: string
  memberName: string
  options: readonly ExemptionOption[]
  /** Rezervasyonu durduran engel — ekranda adıyla gösteriliyor. */
  refusal: unknown
  onDone: () => void
  onClose: () => void
}) {
  const [chosen, setChosen] = useState<string | null>(
    options.length === 1 ? (options[0]?.entitlementId ?? null) : null,
  )
  const [sebep, setSebep] = useState('')
  const [busy, setBusy] = useState(false)
  const [hata, setHata] = useState<string | null>(null)

  const secili = options.find((o) => o.entitlementId === chosen) ?? null
  const hazir = chosen !== null && sebep.trim().length > 0

  async function onayla() {
    if (!hazir || !chosen) return
    setBusy(true)
    setHata(null)
    try {
      const res = await bookReservationAction({
        memberId,
        sessionId,
        entitlementId: chosen,
        creditExemptionReason: sebep.trim(),
      })
      if (res.ok) onDone()
      // Burada da reddedilebilir: mükerrer rezervasyon ve geçmiş ders izinle açılmıyor. Engelin
      // kendi mesajını gösteriyoruz, "bir şeyler ters gitti" demiyoruz.
      else setHata(domainErrorMessage(res.error as never))
    } catch {
      setHata('İşlem tamamlanamadı. Sayfayı yenileyip tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Engel var — yine de rezervasyon yapılsın mı?</DialogTitle>
          <DialogDescription>
            {memberName} için bu ders normal kurallarla açılamıyor. İnisiyatif kullanıp yine de
            rezerve edebilirsin; işlem sebebiyle birlikte kayda geçer.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/5 px-3.5 py-3">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-sm text-foreground">{domainErrorMessage(refusal as never)}</p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Hangi paketin üstüne yazılsın?</p>
          {options.map((o) => (
            <label
              key={o.entitlementId}
              className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors ${
                chosen === o.entitlementId
                  ? 'border-primary bg-primary-soft/40'
                  : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              <input
                type="radio"
                name="istisna-paket"
                checked={chosen === o.entitlementId}
                onChange={() => setChosen(o.entitlementId)}
                className="size-4 shrink-0 accent-[var(--color-primary)]"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{o.productName}</div>
                <div className="text-xs text-muted-foreground">
                  {DURUM[o.status]} · {gun(o.validUntil)}
                  {o.kalanKredi !== null ? ` · ${o.kalanKredi} kredi` : ' · süreli paket'}
                </div>
              </div>
              {/* Owner'ın iki kuralı tam olarak bu etiket: *"kredisi varsa düşsün her zaman"* ve
                  *"kredisi 0 ise eksiye gitmesin"*. Masa tıklamadan önce hangisi olduğunu görüyor. */}
              <span
                className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  o.krediDusecek ? 'bg-primary-soft text-primary' : 'bg-muted text-muted-foreground'
                }`}
              >
                {o.krediDusecek ? '1 ders düşecek' : 'kredi düşmeyecek'}
              </span>
            </label>
          ))}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="istisna-sebep" className="text-xs font-medium text-muted-foreground">
            Sebep (zorunlu)
          </label>
          <Textarea
            id="istisna-sebep"
            value={sebep}
            onChange={(e) => setSebep(e.target.value)}
            rows={2}
            placeholder="Örn. paket dün bitti, telafi dersi için patron onayı verdi"
          />
        </div>

        {secili ? (
          <p className="text-xs text-muted-foreground">
            {secili.krediDusecek ? (
              <>
                Bu rezervasyon için <b className="text-foreground">bir ders</b> düşülecek. Paketin
                süresi uzamaz.
              </>
            ) : (
              <>
                Paketin alınacak hakkı kalmadığı için{' '}
                <b className="text-foreground">kredi düşülmeyecek</b>; bakiye eksiye gitmez.
              </>
            )}{' '}
            Üye rezervasyonu kendi uygulamasında görecek.
          </p>
        ) : null}
        {hata ? <p className="text-sm text-danger">{hata}</p> : null}

        <DialogFooter className="flex-row justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={() => void onayla()} disabled={busy || !hazir}>
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Yine de rezerve et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
