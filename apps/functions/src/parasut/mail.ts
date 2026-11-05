// FT-2 · the e-Arşiv PDF by e-mail (owner, 2026-11-05: "fatura kesilince pdf gitsin mi gitmesin mi diye tik
// olsun ve hangi mail adresine gideceğini yazabilelim"). Sent through our own Resend account (the same key and
// sender as every other studio e-mail), with OUR copy of the PDF attached — Paraşüt's own sharing endpoint is
// documented for offers, not e-Arşiv, so we do not lean on it. Idempotent on the request id: a redelivery is
// the same e-mail to Resend, never a second one in the member's inbox.

export interface PdfMail {
  readonly to: string
  readonly requestId: string
  readonly documentNo: string
  readonly studioName: string | null
  readonly pdf: Buffer
}

export type MailResult = { ok: true } | { ok: false; permanent: boolean; message: string }

export async function sendPdfMail(m: PdfMail, f: typeof fetch = fetch): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.EMAIL_FROM?.trim()
  if (!apiKey || !from) return { ok: false, permanent: false, message: 'e-posta servisi tanımlı değil' }
  const who = m.studioName ?? 'Stüdyomuz'
  const res = await f('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `e-archive-pdf-${m.requestId}` },
    body: JSON.stringify({
      from,
      to: [m.to],
      subject: `e-Arşiv faturanız${m.documentNo ? ` — ${m.documentNo}` : ''}`,
      text: `Merhaba,\n\n${who} için kesilen e-Arşiv faturanız ektedir${m.documentNo ? ` (${m.documentNo})` : ''}.\n\nİyi günler dileriz.\n${who}`,
      attachments: [{ filename: `${m.documentNo || 'e-arsiv-fatura'}.pdf`, content: m.pdf.toString('base64') }],
    }),
  })
  if (res.ok) return { ok: true }
  const message = (await res.text().catch(() => `HTTP ${res.status}`)).slice(0, 300)
  return { ok: false, permanent: res.status !== 429 && res.status < 500, message }
}
