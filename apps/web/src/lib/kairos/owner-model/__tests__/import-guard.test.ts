import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

// Readers of the owner model are chat and the 06:00 message only. The cold
// read (and every other measuring instrument or self-model writer) must never
// import it — measurement stays independent of Kairos's read of the owner.

const KAIROS = path.resolve(__dirname, '../..')
const rel = (p: string) => path.relative(KAIROS, p).split(path.sep).join('/')

const coldRead = readdirSync(path.join(KAIROS, 'cold-read'))
  .filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n))
  .map((n) => path.join(KAIROS, 'cold-read', n))

const NEVER_READERS = [
  ...coldRead,
  ...['cold-read', 'character-check', 'drift-probe', 'idea-judge', 'idea-judge-swiss', 'dream', 'dream-read', 'aether', 'cortex', 'weekly-review']
    .map((n) => path.join(KAIROS, 'thinking/handlers', `${n}.ts`)),
  path.join(KAIROS, 'conscience-context.ts'),
].filter((p) => existsSync(p))

function imports(src: string): string[] {
  return [
    ...(src.match(/import[\s\S]*?from\s+['"][^'"]+['"]/g) ?? []),
    ...(src.match(/import\(\s*['"][^'"]+['"]\s*\)/g) ?? []),
  ]
}

describe('owner model readers', () => {
  it('finds the cold read files', () => {
    expect(coldRead.length).toBeGreaterThan(0)
    expect(NEVER_READERS.some((p) => rel(p) === 'thinking/handlers/cold-read.ts')).toBe(true)
  })

  it.each(NEVER_READERS.map((p) => [rel(p), p]))('%s imports nothing from the owner model', (_name, file) => {
    for (const stmt of imports(readFileSync(file, 'utf8'))) {
      expect(stmt).not.toMatch(/owner-model/)
    }
  })

  it('the guard would catch a static or lazy import', () => {
    expect(imports("import { x } from '@/lib/kairos/owner-model/block'")[0]).toMatch(/owner-model/)
    expect(imports("await import('@/lib/data/kairos-owner-model')")[0]).toMatch(/owner-model/)
  })
})
