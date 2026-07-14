'use server'

import { headers } from 'next/headers'

import { adminAuth } from '../firebase-admin'

// ── "Şifremi unuttum" — for STAFF (2026-07-14, production). ──────────────────────────────────
//
// Two holes, and they only matter together. There was no reset flow on the staff login at all: the
// owner or reception, on the morning she forgets her password, could not get in without someone
// running a script. And the obvious fix — Firebase's own `sendPasswordResetEmail` — does not work
// here: Firebase sends from `noreply@<project>.firebaseapp.com`, a domain with no SPF, no DKIM and
// no reputation. We watched Gmail swallow one silently. A reset flow whose mail never arrives is a
// reset flow that does not exist.
//
// So we generate the link with the Admin SDK and send it through the SAME verified sender the studio
// uses for everything else. Not the notification pipeline: that is tenant-scoped and event-driven,
// and at the login screen we do not yet know who this is — which is exactly the point of the screen.
//
// **It never says whether the address exists.** Always the same answer, always `ok`. Anything else
// turns the login page into a tool for discovering who works at this studio.
export async function requestPasswordReset(email: string): Promise<{ ok: true }> {
  const address = email.trim().toLowerCase()
  if (address === '') return { ok: true }

  try {
    const origin = (await headers()).get('origin') ?? ''
    const link = await adminAuth().generatePasswordResetLink(address, {
      url: `${origin}/login`,
    })
    await sendResetEmail(address, link)
  } catch {
    // An unknown address, a rate limit, a transport failure: the caller learns nothing from any of
    // them. Silence here is the feature.
  }

  return { ok: true }
}

async function sendResetEmail(to: string, link: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  // Better to send nothing than to pretend. Without a key this throws, the caller swallows it, and
  // the person sees the same neutral message — but the failure is in the logs, and the alarm reads
  // the logs. It does not fall back to a console provider: that is the bug we shipped once already.
  if (!apiKey || !from) throw new Error('email transport not configured')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Şifre sıfırlama',
      html: `<p>Merhaba,</p>
        <p>Panel şifreni sıfırlamak için aşağıdaki bağlantıya tıkla ve yeni şifreni belirle.</p>
        <p><a href="${link}">Şifremi belirle</a></p>
        <p style="color:#888;font-size:13px">Bağlantı tek kullanımlıktır ve bir süre sonra geçersiz
        olur. Bu isteği sen yapmadıysan bu e-postayı yok say — hesabında hiçbir şey değişmedi.</p>`,
    }),
  })
  if (!res.ok) throw new Error(`resend ${res.status}`)
}
