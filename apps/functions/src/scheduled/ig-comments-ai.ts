// IG-3 — PURE parts of the comment poll: which comments are new, what the AI is asked, how its answer is
// read. Tested. The AI sees the comment TEXT and the post's caption — never the username.
import type { CommentCategory } from '@studio/core'

export interface RawComment {
  readonly id: string
  readonly text: string
  readonly username: string
  readonly timestamp: string // ISO from Graph
  readonly mediaId: string
}

/** Comments that are not ours and not yet recorded. */
export function pickNew(all: readonly RawComment[], ownUsername: string, existing: ReadonlySet<string>): RawComment[] {
  // Instagram usernames are ASCII and case-insensitive: plain lower-casing, NOT Turkish ('I' must stay 'i').
  const own = ownUsername.toLowerCase()
  const seen = new Set<string>()
  return all.filter((c) => {
    if (!c.id || existing.has(c.id) || seen.has(c.id)) return false
    if (c.username.toLowerCase() === own) return false
    seen.add(c.id)
    return true
  })
}

export const CLASSIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['n', 'category', 'draft'],
        properties: { n: { type: 'integer' }, category: { type: 'string', enum: ['question', 'praise', 'complaint', 'spam', 'other'] }, draft: { type: 'string' } },
      },
    },
  },
} as const

export function classifyPrompt(items: readonly { readonly text: string; readonly post: string }[]): string {
  const list = items.map((c, i) => `${i + 1}) [gönderi: ${c.post.slice(0, 80) || '—'}] "${c.text.slice(0, 500)}"`).join('\n')
  return `Kadınlara özel bir pilates & fitness stüdyosunun (Çayırova) Instagram hesabısın. Aşağıdaki yorumların her birini sınıflandır ve stüdyo adına kısa bir cevap TASLAĞI yaz. Cevabı bir insan okuyup gönderecek.

Sınıflar: question (fiyat, saat, yer, ders sorusu) · praise (övgü, kalp, beğeni) · complaint (şikâyet, memnuniyetsizlik, olumsuz) · spam (reklam, takipçi, alakasız link) · other.

Taslak kuralları:
- Türkçe, sıcak, kısa (en fazla 300 karakter), emoji ölçülü.
- ASLA fiyat, rakamla ücret, indirim yazma. Fiyat/paket sorusunu DM ya da WhatsApp'a davet et.
- Saat/ders sorusunda "DM'den güncel programı iletelim" de; uydurma saat yazma.
- complaint: özür dile, savunmaya geçme, söz/iade vaat etme; DM'den numarasını bırakırsa bugün aranacağını söyle.
- praise: teşekkür et, derse davet edebilirsin.
- spam: draft boş ("").
- Kişinin adını ya da kullanıcı adını yazma.

YORUMLAR:
${list}

items: her yorum için {n: sıra numarası, category, draft}.`
}

export function parseClassification(text: string, count: number): { category: CommentCategory; draft: string }[] {
  const out = Array.from({ length: count }, () => ({ category: 'other' as CommentCategory, draft: '' }))
  try {
    const d = JSON.parse(text) as { items?: { n?: number; category?: string; draft?: string }[] }
    for (const it of d.items ?? []) {
      const i = Number(it.n) - 1
      if (!Number.isInteger(i) || i < 0 || i >= count) continue
      const category = (['question', 'praise', 'complaint', 'spam', 'other'] as const).find((c) => c === it.category) ?? 'other'
      out[i] = { category, draft: category === 'spam' ? '' : String(it.draft ?? '').slice(0, 600) }
    }
  } catch {
    /* every comment stays "other" with no draft — a person still sees it */
  }
  return out
}
