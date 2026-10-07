// Clip text to ≤max chars at a word boundary, ending in "…". Falls back to a
// hard cut when the last space would drop more than 40% of the budget.
export function clipAtWord(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.search(/\s\S*$/)
  const head = space >= max * 0.6 ? cut.slice(0, space) : cut
  return `${head.replace(/[\s,;:.\-–—]+$/, '')}…`
}
