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
    if (line.startsWith('## '))  { out.push(<h3 key={key++} className={styles.h2}>{line.slice(3)}</h3>); continue }
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
    h1: 'text-sm font-semibold text-white/95 mt-1 mb-1',
    h2: 'text-[11px] uppercase tracking-[0.2em] text-white/45 mt-3 mb-1',
    h3: 'text-[12px] font-semibold text-white/85 mt-2',
    quote: 'text-[10px] text-white/40 italic',
    li: 'text-[12px] text-white/70 ml-4 list-disc marker:text-white/30',
    italic: 'text-[10px] text-white/35 italic',
    p: 'text-[12px] text-white/75 leading-relaxed',
  },
  chat: {
    h1: 'text-base font-semibold text-white/95 mt-1 mb-1',
    h2: 'text-[12px] uppercase tracking-[0.2em] text-white/55 mt-2 mb-1',
    h3: 'text-[13px] font-semibold text-white/90 mt-2',
    quote: 'text-[12px] text-white/55 italic border-l-2 border-white/15 pl-2',
    li: 'text-[13px] text-white/80 ml-4 list-disc marker:text-white/35',
    italic: 'text-[12px] text-white/55 italic',
    p: 'text-[13px] text-white/85 leading-relaxed',
  },
} as const

// Inline parser: walks **...** spans, distinguishing **!critical!** (red)
// from plain **bold** (white). Caller passes the matched segments through
// renderChildren so chat callers can splice citation chips inside.
export function renderInline(text: string, renderChildren?: (segment: string) => ReactNode): ReactNode {
  const parts: ReactNode[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      const segment = text.slice(last, m.index)
      parts.push(renderChildren ? renderChildren(segment) : segment)
    }
    const inner = m[1]
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
    last = m.index + m[0].length
  }
  if (last < text.length) {
    const tail = text.slice(last)
    parts.push(renderChildren ? renderChildren(tail) : tail)
  }
  return parts.length === 0 ? (renderChildren ? renderChildren(text) : text) : parts
}
