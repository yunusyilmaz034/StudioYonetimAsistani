import { InviteForm } from './invite-form'

// D1/D2 — the invite link. PUBLIC by necessity: the member has no account yet, so there is
// nothing to authenticate. The token in the URL is the credential, and every failure it can
// produce collapses to one message (see `invite_invalid`).
export default async function InvitePage({
  params,
}: {
  params: Promise<{ studioId: string; token: string }>
}) {
  const { studioId, token } = await params
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <InviteForm studioId={studioId} token={token} />
    </main>
  )
}
