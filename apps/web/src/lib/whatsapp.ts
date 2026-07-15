// The one place WhatsApp messages are composed and opened (Plus Phase 2 §3). NOT the automated Meta
// integration — that is Phase 5. This is the manual path: it opens WhatsApp (web or app) at the
// member's number with a ready message, and a human presses send. Nothing is sent automatically, and
// no message leaves without the user's own tap.
//
// Every ready message lives HERE, so the wording is consistent wherever reception reaches for it — a
// reminder from the reservation row and a reminder from the member card read the same.

const digits = (phone: string): string => phone.replace(/\D/g, '')

// A Turkish mobile stored E.164 (+90…) becomes the wa.me digits directly; anything without digits is
// unreachable and callers disable the action rather than open a broken link.
export function isWhatsAppReachable(phone: string | null | undefined): boolean {
  return Boolean(phone && digits(phone).length >= 10)
}

export function openWhatsApp(phone: string, text = ''): void {
  const to = digits(phone)
  if (to.length < 10) return
  const url = `https://wa.me/${to}${text ? `?text=${encodeURIComponent(text)}` : ''}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

// The ready messages. A studio's voice: warm, short, and it never promises what the system did not do.
export const WA_TEMPLATES = {
  greeting: (name: string) => `Merhaba ${name} 🌸`,
  reminder: (name: string, classLabel: string, when: string) =>
    `Merhaba ${name} 🌸 ${when} ${classLabel} dersini hatırlatmak istedik. Görüşmek üzere!`,
  timeChange: (name: string, classLabel: string, when: string) =>
    `Merhaba ${name}, ${classLabel} dersinin saati ${when} olarak güncellendi. Uygun mudur?`,
  cancelInfo: (name: string, classLabel: string) =>
    `Merhaba ${name}, ${classLabel} dersin iptal edildi. Yeni bir gün için bize yazabilirsin.`,
  renewal: (name: string, daysLeft: number) =>
    `Merhaba ${name} 🌸 Paketinin bitmesine ${daysLeft} gün kaldı. Yenilemek istersen buradayız.`,
} as const
