'use client'

import { useState, type FormEvent, type ReactNode } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { domainErrorMessage } from '@/lib/domain-error'
import { createProductAction, updateProductAction } from '@/server/actions/catalog'
import type { ProductView, ServiceOption } from '@/server/catalog-query'

export const CATEGORY_LABEL: Record<string, string> = {
  pilates_group: 'Pilates (Grup)',
  fitness: 'Fitness',
  private: 'Özel / PT',
}

const tl = (kurus: number) => (kurus / 100).toString()
const toKurus = (t: string) => Math.round((Number(t) || 0) * 100)

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

export function ProductForm({
  product,
  services,
  onDone,
}: {
  product: ProductView | null
  services: readonly ServiceOption[]
  onDone: () => void
}) {
  const [name, setName] = useState(product?.name ?? '')
  const [category, setCategory] = useState(product?.category ?? 'pilates_group')
  const [type, setType] = useState<'credit' | 'period'>(product?.type ?? 'credit')
  const [durationDays, setDurationDays] = useState(product?.durationDays ?? 30)
  const [creditCount, setCreditCount] = useState(product?.creditCount ?? 8)
  const [priceTl, setPriceTl] = useState(product ? tl(product.priceInKurus) : '')
  const [freezeDays, setFreezeDays] = useState(product?.freezeAllowanceDays ?? 0)
  const [dailyLimit, setDailyLimit] = useState<number | null>(product?.dailyReservationLimit ?? null)
  const [cancelCount, setCancelCount] = useState<number | null>(product?.cancellationAllowanceCount ?? null)
  const [description, setDescription] = useState(product?.description ?? '')
  const [serviceIds, setServiceIds] = useState<string[]>([...(product?.serviceIds ?? [])])
  const [active, setActive] = useState(product?.active ?? true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleService = (id: string) =>
    setServiceIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const fields = {
      name: name.trim(),
      category,
      serviceIds,
      type,
      durationDays,
      creditCount: type === 'credit' ? creditCount : null,
      priceInKurus: toKurus(priceTl),
      freezeAllowanceDays: freezeDays,
      dailyReservationLimit: dailyLimit,
      cancellationAllowanceCount: cancelCount,
      description: description.trim(),
    }
    try {
      const res = product
        ? await updateProductAction({ ...fields, productId: product.id, active })
        : await createProductAction(fields)
      if (res.ok) {
        toast.success(product ? 'Paket güncellendi.' : 'Paket oluşturuldu.')
        onDone()
      } else {
        setError(domainErrorMessage(res.error))
        setLoading(false)
      }
    } catch {
      setError('Kaydedilemedi. Lütfen tekrar deneyin.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field id="p-name" label="Paket adı">
        <Input id="p-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Reformer 8 Ders" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field id="p-cat" label="Kategori">
          <Select value={category} onValueChange={(v) => setCategory(v ?? 'pilates_group')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CATEGORY_LABEL).map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="p-type" label="Tür">
          <Select value={type} onValueChange={(v) => setType((v as 'credit' | 'period') ?? 'credit')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="credit">Kredi (ders sayısı)</SelectItem>
              <SelectItem value="period">Süreli (sınırsız)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field id="p-dur" label="Süre (gün)">
          <Input id="p-dur" type="number" min={1} value={durationDays} onChange={(e) => setDurationDays(Math.max(1, Number(e.target.value) || 1))} />
        </Field>
        {type === 'credit' ? (
          <Field id="p-credit" label="Kredi (ders)">
            <Input id="p-credit" type="number" min={1} value={creditCount} onChange={(e) => setCreditCount(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
        ) : (
          <Field id="p-unlim" label="Erişim">
            <Input id="p-unlim" value="Sınırsız" disabled />
          </Field>
        )}
        <Field id="p-price" label="Fiyat (TL)">
          <Input id="p-price" type="number" min={0} step="0.01" required value={priceTl} onChange={(e) => setPriceTl(e.target.value)} />
        </Field>
        <Field id="p-freeze" label="Dondurma hakkı (gün)">
          <Input id="p-freeze" type="number" min={0} value={freezeDays} onChange={(e) => setFreezeDays(Math.max(0, Number(e.target.value) || 0))} />
        </Field>
        <Field id="p-daily" label="Günlük rez. limiti (ops.)">
          <Input
            id="p-daily"
            type="number"
            min={1}
            value={dailyLimit ?? ''}
            onChange={(e) => setDailyLimit(e.target.value ? Math.max(1, Number(e.target.value)) : null)}
          />
        </Field>
        <Field id="p-cancel" label="İptal hakkı adedi (ops.)">
          <Input
            id="p-cancel"
            type="number"
            min={0}
            value={cancelCount ?? ''}
            onChange={(e) => setCancelCount(e.target.value ? Math.max(0, Number(e.target.value)) : null)}
          />
        </Field>
      </div>

      {/* D12 — the services a package covers are now the RIGHT it grants, not a label. At
          least one is required, and the list is frozen onto every purchase made afterwards. */}
      {services.length > 0 ? (
        <Field id="p-services" label="Kapsadığı dersler">
          <div className="flex flex-wrap gap-2">
            {services.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleService(s.id)}
                className={`rounded-lg border px-3 py-1 text-sm transition-colors ${
                  serviceIds.includes(s.id) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {serviceIds.length === 0
              ? 'En az bir ders seçin — paket yalnızca seçtiğiniz dersleri kapsar.'
              : 'Bu paketle bu dersler rezerve edilebilir. Sonradan yapılan değişiklik, daha önce satılmış paketleri etkilemez.'}
          </p>
        </Field>
      ) : (
        <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
          Önce bir ders (hizmet) tanımlamalısınız — paket, kapsadığı dersleri belirtmeden oluşturulamaz.
        </p>
      )}

      <Field id="p-desc" label="Açıklama">
        <Textarea id="p-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      {product ? (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} />
          Aktif
        </label>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Button type="submit" className="min-h-11 w-full" disabled={loading || serviceIds.length === 0}>
        {loading ? <Loader2Icon className="animate-spin" /> : null}
        {product ? 'Değişiklikleri Kaydet' : 'Paketi Oluştur'}
      </Button>
    </form>
  )
}
