import { Fragment, type ReactNode } from 'react'

// A tiny, dependency-free markdown renderer for the Bilgi Merkezi — headings (##/###), bullet and
// numbered lists, **bold**, and paragraphs. It parses into React nodes (no dangerouslySetInnerHTML),
// so owner-authored text can never inject HTML. Anything it doesn't recognise renders as plain text.

function inline(text: string, keyBase: string): ReactNode[] {
  // Split on **bold** spans.
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={`${keyBase}-b${i}`} className="font-semibold text-foreground">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={`${keyBase}-t${i}`}>{part}</Fragment>
    ),
  )
}

export function Markdown({ children }: { children: string }) {
  const lines = children.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let key = 0

  const flushList = () => {
    if (!list) return
    const L = list
    const Tag = L.ordered ? 'ol' : 'ul'
    blocks.push(
      <Tag key={`l${key++}`} className={`ml-5 space-y-1 ${L.ordered ? 'list-decimal' : 'list-disc'}`}>
        {L.items.map((it, i) => (
          <li key={i} className="text-sm leading-relaxed text-muted-foreground">
            {inline(it, `li${key}-${i}`)}
          </li>
        ))}
      </Tag>,
    )
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    const numbered = /^\d+\.\s+(.*)$/.exec(line)
    if (bullet) {
      if (list && list.ordered) flushList()
      list = list && !list.ordered ? list : { ordered: false, items: [] }
      list.items.push(bullet[1]!)
      continue
    }
    if (numbered) {
      if (list && !list.ordered) flushList()
      list = list && list.ordered ? list : { ordered: true, items: [] }
      list.items.push(numbered[1]!)
      continue
    }
    flushList()
    if (line.trim() === '') continue
    const h3 = /^###\s+(.*)$/.exec(line)
    const h2 = /^##\s+(.*)$/.exec(line)
    if (h2 || h3) {
      blocks.push(
        <p key={`h${key++}`} className={`font-semibold text-foreground ${h2 ? 'text-h3 mt-2' : 'text-sm mt-1'}`}>
          {inline((h2 ?? h3)![1]!, `h${key}`)}
        </p>,
      )
      continue
    }
    blocks.push(
      <p key={`p${key++}`} className="text-sm leading-relaxed text-muted-foreground">
        {inline(line, `p${key}`)}
      </p>,
    )
  }
  flushList()
  return <div className="space-y-2.5">{blocks}</div>
}
