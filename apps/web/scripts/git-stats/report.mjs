#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { loadPrs, loadRaw } from './report-data.mjs'
import { renderHtml } from './report-html.mjs'
import { renderMarkdown } from './report-md.mjs'
import { buildModel } from './report-model.mjs'
import { buildSections } from './report-sections.mjs'

export const USAGE = 'Usage: node report.mjs --raw <dir> [--prs <dir>] --out <dir>'

export function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { raw: { type: 'string' }, prs: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean', default: false } },
  })
  if (values.help) return { help: true }
  if (!values.raw || !values.out) throw new Error(`--raw and --out are required\n${USAGE}`)
  return { raw: resolve(values.raw), prs: values.prs ? resolve(values.prs) : null, out: resolve(values.out) }
}

export function buildReport({ raw, prs }) {
  const { commits, summaryAll, run, repoSummaries, config } = loadRaw(raw)
  const { prs: prRows, prSummary } = loadPrs(prs)
  const model = buildModel({ commits, summaryAll, run, repoSummaries, prs: prRows, prSummary, config })
  const sections = buildSections(model)
  return { model, sections, html: renderHtml(model, sections), markdown: renderMarkdown(model, sections) }
}

function main() {
  const options = parseCli(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }
  const { model, sections, html, markdown } = buildReport(options)
  mkdirSync(options.out, { recursive: true })
  writeFileSync(join(options.out, 'report.html'), html)
  writeFileSync(join(options.out, 'report.md'), markdown)
  console.error(`wrote ${join(options.out, 'report.html')} and report.md`)
  for (const line of sections.headlines) console.error(`  ${line}`)
  for (const issue of model.ownerCheck) console.error(`  WARNING ${issue}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (err) {
    console.error(err.message)
    process.exitCode = 1
  }
}
