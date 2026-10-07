import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_CONFIG = join(dirname(fileURLToPath(import.meta.url)), 'repos.json')

export function parseJsonLines(text) {
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line, i) => {
    try {
      return JSON.parse(line)
    } catch (err) {
      throw new Error(`line ${i + 1}: ${err.message}`)
    }
  })
}

function readJson(path, fallback = undefined) {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback
    throw new Error(`missing input file: ${path}`)
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function loadRaw(dir) {
  const commitsPath = join(dir, 'commits.jsonl')
  if (!existsSync(commitsPath)) throw new Error(`missing input file: ${commitsPath}`)
  const commits = parseJsonLines(readFileSync(commitsPath, 'utf8'))
  const summaryAll = readJson(join(dir, 'summary.all.json'))
  const run = readJson(join(dir, 'run.json'), { repos: [] })
  const repoSummaries = {}
  for (const name of readdirSync(dir)) {
    const match = /^(.+)\.summary\.json$/.exec(name)
    if (!match || match[1] === 'summary.all') continue
    const { byWeek, byMonth, byIdentity, totals, ...meta } = readJson(join(dir, name))
    repoSummaries[match[1]] = meta
  }
  return { commits, summaryAll, run, repoSummaries, config: loadConfig(run.config) }
}

export function loadConfig(path) {
  const candidate = path && existsSync(path) ? path : DEFAULT_CONFIG
  return existsSync(candidate) ? { path: candidate, ...JSON.parse(readFileSync(candidate, 'utf8')) } : null
}

export function loadPrs(dir) {
  if (!dir) return { prs: [], prSummary: null }
  const path = join(dir, 'prs.jsonl')
  const prs = existsSync(path) ? parseJsonLines(readFileSync(path, 'utf8')) : []
  return { prs, prSummary: readJson(join(dir, 'summary.json'), null) }
}
