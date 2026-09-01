import { checkStaffInvite } from '@/server/staff-invite'

import { StaffInviteForm } from './staff-invite-form'

// PERSONEL DAVETİ — herkese açık, zorunlu olarak: davet edilen kişinin henüz şifresi yok, yani
// kimlik doğrulanacak bir şey yok. URL'deki jetonun KENDİSİ kimliktir.
//
// Doğrulama SUNUCUDA, sayfa çizilmeden yapılır: geçersiz bir davet, şifre kutusunu hiç görmemeli.
// Bir formu gösterip sonra "olmadı" demek, kişiye kendi hatası gibi gelir.
export default async function StaffInvitePage({
  params,
}: {
  params: Promise<{ studioId: string; token: string }>
}) {
  const { studioId, token } = await params
  const check = await checkStaffInvite(studioId, token)

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      {check.ok ? (
        <StaffInviteForm studioId={studioId} token={token} displayName={check.displayName} email={check.email} />
      ) : (
        // TEK mesaj, ve bilerek: yanlış / süresi dolmuş / kullanılmış ayrımını söylemek, link deneyen
        // birine denemeye devam etmesi için ipucu vermektir. Ama kişiye NE YAPACAĞINI söylüyor —
        // Firebase'in İngilizce "try again" sayfasının söylemediği şey buydu.
        <div className="w-full max-w-sm space-y-3 rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <p className="text-2xl" aria-hidden>
            🌸
          </p>
          <h1 className="text-lg font-semibold text-foreground">Bu davet artık geçerli değil</h1>
          <p className="text-sm text-muted-foreground">
            Bağlantının süresi dolmuş ya da daha önce kullanılmış olabilir. Stüdyodan yeni bir davet
            bağlantısı isteyin — birkaç saniye sürer.
          </p>
        </div>
      )}
    </main>
  )
}
