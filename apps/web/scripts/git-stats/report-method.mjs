import { dayLabel, fmt } from './report-format.mjs'
import { REASON_LABELS, policyLine } from './report-ai.mjs'

export function methodBullets(model) {
  const m = model.method
  const d = model.dedupe
  const t = model.total
  const reasons = Object.entries(t.aiReasons).filter(([, n]) => n).map(([r, n]) => `${REASON_LABELS[r] || r}: ${fmt(n)}`).join('; ') || 'none'
  const out = [
    `Window: commits authored ${dayLabel(model.since)} to ${dayLabel(model.end)} (author's local date). ${fmt(m.reposOk)} of ${fmt(m.reposScanned)} repositories read; ${fmt(m.refs)} branches and remote-tracking refs scanned (all local branches and remotes, not just main), ${fmt(m.scannedCommits)} commits read including a ${fmt(m.lookbackDays)}-day lookback used only for duplicate detection.`,
    `Your identities (${fmt(d.seen)} commits seen): ${m.ownerEmails.map(([k, n]) => `${k} (${fmt(n)})`).join(', ')}.`,
    `Only exact duplicates are removed: ${fmt(d.merges)} merge commits, ${fmt(d.patchDup)} rebased or cherry-picked copies (same patch id), ${fmt(d.squashDup)} branch commits already represented by a squash merge, ${fmt(d.squashBranch)} squash merges whose branch commits were counted instead, and ${fmt(d.crossRepo)} copies of a change already counted in another repository, leaving ${fmt(d.counted)} commits.`,
    `Squash rule: a squash merge is matched to its pull request (or, without PR data, to a branch with the same patch); ${fmt(m.squashMatched)} of ${fmt(m.squashChecked)} candidate branches matched. When the branch commits survive, they are counted and the squash commit is not.`,
    `Big commits count in full. ${fmt(t.flaggedCommits)} commits carry an import, vendored or over-${fmt(m.giantLines)}-line label (${m.noiseReasons.map(([r, n]) => `${r}: ${fmt(n)}`).join('; ') || 'none'}); the label only explains the "Biggest single drops" table.`,
    `Code, tests, docs, config: each file is classified by path and extension. "Authored" lines are all of these. Lockfiles, generated files, data files (csv, parquet, ipynb, …), json/yaml/xml/txt changes over ${fmt(m.dataDumpLines)} lines and the excluded folders below appear only in the raw figure (+${fmt(t.rawAdded - t.added)} / −${fmt(t.rawRemoved - t.removed)} lines${t.pathAdded || t.pathRemoved ? `, ${fmt(t.pathAdded)} / ${fmt(t.pathRemoved)} of them in excluded folders` : ''}).`,
    `Excluded folders: everywhere ${m.globalExcludes.map((g) => `"${g}"`).join(', ') || 'none'}; ${m.repoExcludes.map(([repo, globs]) => `${repo}: ${globs.map((g) => `"${g}"`).join(', ')}`).join('; ') || 'no per-repository folders are excluded'}${m.configPath ? ` (from ${m.configPath.replace(/\\/g, '/').split('/').slice(-1)[0]})` : ''}.`,
    `AI-made: ${policyLine(model)} Commits by reason: ${reasons}. Pull requests opened by the Copilot agent (${fmt(model.prs.totals.agent)}) always count as AI-made.`,
    `Pull requests: opened in the window by andrey.selikhov@sefe.eu (Azure DevOps), Drxdre88 (GitHub) or the Copilot agent. "Merged" means completed; merge month is the close date.`,
    `Repository kind: names containing "_app_" or ending "_dash" are apps; names ending "_lab" are labs.`,
    'Baseline: owner commits before the window, merges excluded but no patch or squash dedupe, big commits included. Treat it as approximate.',
    'Known limits: Azure DevOps PRs carry no line counts; author dates are in mixed time zones; files "changed" counts modifications and renames are listed separately.',
  ]
  for (const w of [...m.warnings, ...model.prNotes]) out.push(`Data note — ${w}.`)
  for (const w of model.ownerCheck) out.push(`Data note — this report and the extractor's owner totals disagree on ${w}.`)
  return out
}
