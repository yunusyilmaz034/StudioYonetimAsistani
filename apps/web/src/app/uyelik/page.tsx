import type { Metadata } from 'next'
import { CheckCircle2Icon, ShieldCheckIcon, XCircleIcon } from 'lucide-react'

import { getPublicProductsAction } from '@/server/actions/payments'

import { UyelikForm } from './uyelik-form'

// The WhatsApp / Instagram link preview: the studio's real name + a reassuring line. Server-side, reads
// the same public action the page renders from.
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ s?: string }> }): Promise<Metadata> {
  const sp = await searchParams
  const studioId = sp.s ?? ''
  const res = studioId ? await getPublicProductsAction({ studioId }) : ({ ok: false, studioName: 'Stüdyo' } as const)
  const studio = res.studioName
  const title = `${studio} · Online Üyelik`
  const description = `${studio} paketlerini online al. Güvenli ödeme, hemen aktif üyelik.`
  return {
    title,
    description,
    openGraph: { title, description, siteName: studio, type: 'website' },
    twitter: { card: 'summary', title, description },
  }
}

// ONLINE ÜYELİK SATIŞI — the PUBLIC sales page. Outside the (staff) route group, so no staff shell and no
// auth ever runs. Anyone with the link (web homepage, WhatsApp, Instagram) opens it, picks a package, and
// pays by card via PAYTR. On success the member is created-or-found and the package granted by the
// verified callback; an app invite is sent by WhatsApp. `?s=` carries the studio; `?ok`/`?fail` are PAYTR's return.
export default async function UyelikPage({ searchParams }: { searchParams: Promise<{ s?: string; ok?: string; fail?: string }> }) {
  const sp = await searchParams
  const studioId = sp.s ?? ''
  const res = studioId ? await getPublicProductsAction({ studioId }) : ({ ok: false as const, studioName: 'Stüdyo', items: [] })

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <p className="text-lg font-semibold text-foreground">{res.studioName}</p>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <ShieldCheckIcon className="size-4" />
          <span className="text-sm font-medium">Online Üyelik · Güvenli Ödeme</span>
        </div>
      </div>

      {sp.ok ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-6 text-center">
          <CheckCircle2Icon className="size-10 text-emerald-600" />
          <p className="text-lg font-semibold text-foreground">Ödemen alındı, teşekkürler! 🌸</p>
          <p className="text-sm text-muted-foreground">
            Üyeliğin hazırlanıyor. Uygulamaya giriş bağlantısını birazdan WhatsApp&apos;tan sana göndereceğiz.
          </p>
        </div>
      ) : sp.fail ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-danger/40 bg-danger/10 p-6 text-center">
          <XCircleIcon className="size-10 text-danger" />
          <p className="text-lg font-semibold text-foreground">Ödeme tamamlanamadı</p>
          <p className="text-sm text-muted-foreground">Tekrar deneyebilirsin — kartından bir çekim yapılmadı.</p>
        </div>
      ) : null}

      {!res.ok || !studioId ? (
        <p className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Bu bağlantı geçersiz görünüyor. Lütfen stüdyodan güncel bağlantıyı iste.
        </p>
      ) : res.items.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Şu anda online satışa açık paket yok. Lütfen stüdyoyla iletişime geç.
        </p>
      ) : (
        <UyelikForm studioId={studioId} items={res.items} />
      )}

      <p className="text-center text-xs text-muted-foreground">
        Ödemeler PAYTR güvenli altyapısı ile alınır. Kart bilgilerin bizde saklanmaz.
      </p>
    </main>
  )
}
