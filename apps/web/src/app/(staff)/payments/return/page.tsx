import Link from 'next/link'
import { CheckCircle2Icon, ClockIcon, XCircleIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PaymentReturnTrack } from './payment-return-track'

// PAYTR dönüş sayfası (Plus Phase 6). Tarayıcı dönüşü ödemenin KANITI değildir — asıl doğrulama
// sunucu callback'iyle yapılır. Bu ekran yalnızca bilgilendirir; sonuç kısa sürede yansır.
export default async function PaymentReturnPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const { ok } = await searchParams
  const success = ok === '1'
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <PaymentReturnTrack success={success} />
      {success ? (
        <>
          <CheckCircle2Icon className="size-14 text-success" />
          <h1 className="text-h2 font-semibold">Ödemeniz alındı</h1>
          <p className="text-muted-foreground">Ödemeniz işleniyor. Paketiniz onay gelince otomatik olarak tanımlanacak — bu işlem birkaç saniye sürebilir.</p>
        </>
      ) : (
        <>
          <XCircleIcon className="size-14 text-danger" />
          <h1 className="text-h2 font-semibold">Ödeme tamamlanamadı</h1>
          <p className="text-muted-foreground">Ödemeniz alınamadı. Tekrar denemek için stüdyoyla iletişime geçebilirsiniz.</p>
        </>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ClockIcon className="size-3.5" /> Sonuç, güvenli sunucu doğrulamasıyla kesinleşir.
      </p>
      <Button render={<Link href="/portal" />}>Devam</Button>
    </main>
  )
}
