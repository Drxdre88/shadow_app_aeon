import { BUCKETS } from './classify.mjs'

export const GIANT_LINES = 40000
export const SUBJECT_MAX = 120
export const LOG_FORMAT = '%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%aI%x1f%cI%x1f%(trailers:key=Co-authored-by,valueonly,separator=%x1d)%x1f%s'
export const DIFF_FLAGS = ['--no-ext-diff', '--no-textconv', '--no-color']
export const REV_ARGS = ['--branches', '--remotes']

const AI_COAUTHOR = /claude|anthropic|copilot/i

const RAW = /^:\d{6} \d{6} [0-9a-f]+ [0-9a-f]+ ([A-Z])(\d*)$/
const NUMSTAT = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/

export function logArgs(revArgs) {
  return ['log', ...revArgs, '-z', '--raw', '--numstat', '-M', '--diff-merges=off', ...DIFF_FLAGS, `--format=${LOG_FORMAT}`, '--']
}

function emptyBuckets() {
  return Object.fromEntries(BUCKETS.map((b) => [b, { added: 0, removed: 0 }]))
}

function parseHeader(token) {
  const fields = token.slice(1).split('\x1f')
  const [sha, parentList, authorName, authorEmail, committerName, committerEmail, authorDate, commitDate, trailers] = fields
  const subject = fields.slice(9).join('\x1f')
  const parents = parentList ? parentList.split(' ').filter(Boolean).length : 0
  const coAuthors = (trailers || '').split('\x1d').map((t) => t.trim()).filter(Boolean)
  return {
    sha,
    authorName,
    authorEmail,
    committerName,
    committerEmail,
    authorDate,
    commitDate,
    subject: subject.length > SUBJECT_MAX ? subject.slice(0, SUBJECT_MAX) : subject,
    parents,
    isMerge: parents > 1,
    coAuthors,
    aiAssisted: coAuthors.some((c) => AI_COAUTHOR.test(c)),
    patchId: null,
    dupOf: null,
    dupKind: null,
    squashOf: null,
    squashBranchPresent: null,
    squashBasis: null,
    noise: null,
    dropReason: null,
    counted: true,
    onDefaultBranch: false,
    hasDefaultCopy: null,
    landedViaSquash: null,
    filesChanged: 0,
    linesAdded: 0,
    linesRemoved: 0,
    rawLinesAdded: 0,
    rawLinesRemoved: 0,
    authoredAdded: 0,
    authoredRemoved: 0,
    excludedAdded: 0,
    excludedRemoved: 0,
    binaryFiles: 0,
    filesAdded: 0,
    filesModified: 0,
    filesDeleted: 0,
    filesRenamed: 0,
    filesCopied: 0,
    buckets: emptyBuckets(),
    codeDirs: {},
    giant: false,
  }
}

function applyRaw(commit, status) {
  if (status === 'A') commit.filesAdded++
  else if (status === 'M' || status === 'T') commit.filesModified++
  else if (status === 'D') commit.filesDeleted++
  else if (status === 'R') commit.filesRenamed++
  else if (status === 'C') commit.filesCopied++
}

function applyNumstat(commit, entry, classifier) {
  commit.filesChanged++
  if (entry.binary) {
    commit.binaryFiles++
    return
  }
  commit.rawLinesAdded += entry.added
  commit.rawLinesRemoved += entry.removed
  if (classifier.isExcluded?.(entry.path)) {
    commit.excludedAdded += entry.added
    commit.excludedRemoved += entry.removed
  }
  const bucket = classifier.classify(entry.path, entry.added + entry.removed)
  commit.buckets[bucket].added += entry.added
  commit.buckets[bucket].removed += entry.removed
  if (bucket === 'code') {
    const key = classifier.dirKey(entry.path)
    commit.codeDirs[key] = (commit.codeDirs[key] || 0) + entry.added + entry.removed
  }
}

function finish(commit) {
  const generated = commit.buckets.generated_or_data
  commit.authoredAdded = commit.rawLinesAdded - generated.added
  commit.authoredRemoved = commit.rawLinesRemoved - generated.removed
  commit.linesAdded = commit.authoredAdded
  commit.linesRemoved = commit.authoredRemoved
  const over = [
    commit.authoredAdded > GIANT_LINES ? `authored +${commit.authoredAdded} > ${GIANT_LINES}` : null,
    commit.authoredRemoved > GIANT_LINES ? `authored -${commit.authoredRemoved} > ${GIANT_LINES}` : null,
  ].filter(Boolean)
  commit.giant = over.length > 0
  commit.giantReason = over.length ? over.join('; ') : null
  return commit
}

export async function* parseLogTokens(tokens, classifier) {
  let commit = null
  let afterHeader = false
  let pending = null
  for await (const raw of tokens) {
    let token = raw
    if (afterHeader && token.startsWith('\n')) token = token.slice(1)
    afterHeader = false
    if (pending) {
      pending.paths.push(token)
      if (pending.paths.length === pending.need) {
        if (pending.kind === 'numstat') {
          applyNumstat(commit, { ...pending.entry, path: pending.paths[pending.need - 1] }, classifier)
        }
        pending = null
      }
      continue
    }
    if (token.startsWith('\x1e')) {
      if (commit) yield finish(commit)
      commit = parseHeader(token)
      afterHeader = true
      continue
    }
    if (!token || !commit) continue
    const rawMatch = RAW.exec(token)
    if (rawMatch) {
      const status = rawMatch[1]
      applyRaw(commit, status)
      pending = { kind: 'raw', need: status === 'R' || status === 'C' ? 2 : 1, paths: [] }
      continue
    }
    const num = NUMSTAT.exec(token)
    if (num) {
      const binary = num[1] === '-' || num[2] === '-'
      const entry = { binary, added: binary ? 0 : Number(num[1]), removed: binary ? 0 : Number(num[2]) }
      if (num[3] === '') pending = { kind: 'numstat', need: 2, paths: [], entry }
      else applyNumstat(commit, { ...entry, path: num[3] }, classifier)
      continue
    }
    throw new Error(`Unexpected git log token after ${commit.sha}: ${JSON.stringify(token.slice(0, 80))}`)
  }
  if (pending) throw new Error(`Truncated git log stream after ${commit?.sha}`)
  if (commit) yield finish(commit)
}
