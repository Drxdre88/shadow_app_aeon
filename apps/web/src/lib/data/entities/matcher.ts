import { aliasRule, isUsableAlias, normAlias, passesRule, type AliasRule } from './normalize'

export interface MatcherAlias {
  entityId: string
  alias: string
  kind: string
}

interface AliasEntry {
  entityId: string
  alias: string
  rule: AliasRule
}

export const SCAN_TEXT_CAP = 50_000

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// One regex over every alias, longest first, with letter/number/underscore
// boundaries; each hit is checked against its alias rule (exact case for
// initials, capital first letter for stoplisted words and first names).
export class EntityMatcher {
  private readonly byNorm = new Map<string, AliasEntry[]>()
  private readonly pattern: RegExp | null

  constructor(aliases: readonly MatcherAlias[]) {
    for (const a of aliases) {
      const norm = normAlias(a.alias)
      if (!isUsableAlias(norm)) continue
      const list = this.byNorm.get(norm) ?? []
      if (!list.some((e) => e.entityId === a.entityId && e.alias === a.alias)) {
        list.push({ entityId: a.entityId, alias: a.alias, rule: aliasRule(a.alias, a.kind) })
      }
      this.byNorm.set(norm, list)
    }
    const norms = [...this.byNorm.keys()].sort((x, y) => y.length - x.length || x.localeCompare(y))
    const body = norms.map((n) => escapeRe(n).replace(/ /g, '\\s+')).join('|')
    this.pattern = body ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])`, 'giu') : null
  }

  get size(): number {
    return this.byNorm.size
  }

  match(text: string): Set<string> {
    const found = new Set<string>()
    if (!this.pattern || !text) return found
    const clipped = text.length > SCAN_TEXT_CAP ? text.slice(0, SCAN_TEXT_CAP) : text
    for (const m of clipped.normalize('NFKC').matchAll(this.pattern)) {
      for (const e of this.byNorm.get(normAlias(m[0])) ?? []) {
        if (passesRule(e.rule, e.alias, m[0])) found.add(e.entityId)
      }
    }
    return found
  }
}

export function memoryScanText(row: { title: string; summary: string | null; bodyMd: string | null }): string {
  return [row.title, row.summary ?? '', row.bodyMd ?? ''].join('\n').slice(0, SCAN_TEXT_CAP)
}
