'use client'

import type { ReactNode } from 'react'

// Shared lean markdown renderer for Kairos surfaces (briefing, chat).
// Block-level: # ## ### / - / > / ---  +  inline **bold** and **!critical!**.
// Critical spans render in semantic rose-400. Bold renders in white/95.
//
// Intentionally lean — full markdown engines (react-markdown + remark-gfm)
// add ~150kb to the bundle for features we don't need. Kairos prose is
// controlled output: the prompt teaches the model to stay within this
// vocabulary.

export function KairosMarkdown({
  markdown,
  variant = 'briefing',
}: {
  markdown: string
  // Briefing leans denser (smaller fonts, more compact); chat leans
  // readable (slightly larger). Both share the same inline parser.
  variant?: 'briefing' | 'chat'
}) {
  const lines = markdown.split('\n')
  const out: ReactNode[] = []
  let key = 0
  const styles = STYLES[variant]

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) { out.push(<div key={key++} className="h-2" />); continue }
    if (line.startsWith('# '))   { out.push(<h2 key={key++} className={styles.h1}>{renderInline(line.slice(2))}</h2>); continue }
    if (line.startsWith('## '))  { out.push(<h3 key={key++} className={styles.h2} style={H2_ACCENT}>{line.slice(3)}</h3>); continue }
    if (line.startsWith('### ')) { out.push(<h4 key={key++} className={styles.h3}>{renderInline(line.slice(4))}</h4>); continue }
    if (line.startsWith('> '))   { out.push(<div key={key++} className={styles.quote}>{renderInline(line.slice(2))}</div>); continue }
    if (line.startsWith('- '))   { out.push(<li key={key++} className={styles.li}>{renderInline(line.slice(2))}</li>); continue }
    if (line === '---')          { out.push(<div key={key++} className="h-px bg-white/[0.04] my-1" />); continue }
    if (line.startsWith('*') && line.endsWith('*') && !line.includes('**')) {
      out.push(<div key={key++} className={styles.italic}>{line.slice(1, -1)}</div>)
      continue
    }
    out.push(<p key={key++} className={styles.p}>{renderInline(line)}</p>)
  }

  return <div className="flex flex-col gap-0.5">{out}</div>
}

const STYLES = {
  briefing: {
    // ## sections get a theme-accented chip-style header so the briefing has
    // visible structure (State / Movement / Watch / Suggested next stand out).
    h1: 'text-sm font-semibold text-white/95 mt-1 mb-1',
    h2: 'text-[11px] font-semibold uppercase tracking-[0.22em] mt-4 mb-2 inline-block px-2 py-0.5 rounded-md',
    h3: 'text-[12px] font-semibold text-white/85 mt-2',
    quote: 'text-[11px] text-white/45 italic border-l-2 border-white/15 pl-2',
    li: 'text-[12.5px] text-white/75 ml-4 list-disc marker:text-white/30 leading-relaxed',
    italic: 'text-[10px] text-white/35 italic',
    p: 'text-[12.5px] text-white/80 leading-relaxed',
  },
  chat: {
    h1: 'text-base font-semibold text-white/95 mt-1 mb-1',
    h2: 'text-[12px] font-semibold uppercase tracking-[0.22em] mt-3 mb-2 inline-block px-2 py-0.5 rounded-md',
    h3: 'text-[13px] font-semibold text-white/90 mt-2',
    quote: 'text-[12px] text-white/55 italic border-l-2 border-white/15 pl-2',
    li: 'text-[13px] text-white/80 ml-4 list-disc marker:text-white/35 leading-relaxed',
    italic: 'text-[12px] text-white/55 italic',
    p: 'text-[13px] text-white/85 leading-relaxed',
  },
} as const

// Theme-accent style for ## section headers — pulls --primary from the
// active theme so briefing sections feel native to the user's palette.
const H2_ACCENT: React.CSSProperties = {
  background: 'color-mix(in oklab, var(--primary) 14%, transparent)',
  color: 'color-mix(in oklab, var(--primary) 35%, white)',
  border: '1px solid color-mix(in oklab, var(--primary) 28%, transparent)',
}

// Inline parser: handles three span types in priority order:
//   **!critical!**   → bold rose-400 (stuck/overdue/risk semantics)
//   **bold**         → bold white/95 (named entities, key facts)
//   `code`           → mono chip, theme-accented (card names, ids, paths)
// Plain text segments outside any span go through renderChildren if provided
// (used by chat to splice citation chips inside paragraph text).
export function renderInline(text: string, renderChildren?: (segment: string) => ReactNode): ReactNode {
  const parts: ReactNode[] = []
  // Combined regex — alternation handles all three span types in one pass
  // so they can interleave freely within a line.
  const re = /(\*\*(.+?)\*\*)|(`([^`]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      const segment = text.slice(last, m.index)
      parts.push(renderChildren ? renderChildren(segment) : segment)
    }
    if (m[2] !== undefined) {
      // **...** match — distinguish critical vs plain bold
      const inner = m[2]
      if (inner.startsWith('!') && inner.endsWith('!') && inner.length > 2) {
        parts.push(
          <strong key={`crit-${key++}`} className="font-semibold text-rose-400">
            {inner.slice(1, -1)}
          </strong>,
        )
      } else {
        parts.push(
          <strong key={`b-${key++}`} className="font-semibold text-white/95">
            {inner}
          </strong>,
        )
      }
    } else if (m[4] !== undefined) {
      // `...` match — mono chip in theme accent
      parts.push(
        <code
          key={`c-${key++}`}
          className="font-mono text-[0.9em] px-1 py-px rounded"
          style={{
            background: 'color-mix(in oklab, var(--primary) 10%, rgba(255,255,255,0.04))',
            color: 'color-mix(in oklab, var(--primary) 25%, white)',
            border: '1px solid color-mix(in oklab, var(--primary) 18%, transparent)',
          }}
        >
          {m[4]}
        </code>,
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) {
    const tail = text.slice(last)
    parts.push(renderChildren ? renderChildren(tail) : tail)
  }
  return parts.length === 0 ? (renderChildren ? renderChildren(text) : text) : parts
}
