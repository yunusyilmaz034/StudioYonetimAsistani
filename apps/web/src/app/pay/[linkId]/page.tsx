import { CheckCircle2Icon, ShieldCheckIcon, XCircleIcon } from 'lucide-react'

import { getPaymentLinkPublicAction } from '@/server/actions/payments'

import { PayForm } from './pay-form'

// PF-37 — the PUBLIC payment page. Outside the (staff) route group, so no staff shell and no auth ever
// runs. Anyone with the shared link opens it, sees the fixed amount, types her name + phone, and pays
// via PAYTR (installments allowed). The money lands as an unattributed kasa collection the studio
// reconciles later. `?s=` carries the studio; `?ok`/`?fail` are PAYTR's return.
export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ linkId: string }>
  searchParams: Promise<{ s?: string; ok?: string; fail?: string }>
}) {
  const { linkId } = await params
  const sp = await searchParams
  const studioId = sp.s ?? ''
  const link = studioId ? await getPaymentLinkPublicAction({ studioId, linkId }) : ({ ok: false } as const)

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex items-center justify-center gap-2 text-muted-foreground">
        <ShieldCheckIcon className="size-5" />
        <span className="text-sm font-medium">Güvenli Ödeme</span>
      </div>

      {sp.ok ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-6 text-center">
          <CheckCircle2Icon className="size-10 text-emerald-600" />
          <p className="text-lg font-semibold text-emerald-700">Ödemeniz alındı</p>
          <p className="text-sm text-muted-foreground">Teşekkür ederiz! Stüdyo en kısa sürede sizinle ilgilenecek.</p>
        </div>
      ) : !link.ok ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <XCircleIcon className="size-9 text-muted-foreground" />
          <p className="font-medium">Bu ödeme linki geçerli değil</p>
          <p className="text-sm text-muted-foreground">Bağlantının süresi dolmuş ya da kapatılmış olabilir. Lütfen stüdyoyla iletişime geçin.</p>
        </div>
      ) : (
        <>
          {sp.fail ? (
            <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-center text-sm text-rose-600">
              Ödeme tamamlanamadı. Bilgilerinizi kontrol edip tekrar deneyebilirsiniz.
            </p>
          ) : null}
          <PayForm
            studioId={studioId}
            linkId={linkId}
            label={link.value.label}
            amountKurus={link.value.amountKurus}
            maxInstallments={link.value.maxInstallments}
          />
        </>
      )}
    </main>
  )
}
