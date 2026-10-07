import { DIFF_FLAGS } from './log-parse.mjs'
import { gitLines, patchIdPipeline, runGit } from './git.mjs'

const DEFAULT_CANDIDATES = ['refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master']
const ZERO_SHA = /^0+$/

export async function listBranchRefs(repo) {
  const { stdout } = await runGit(repo, [
    'for-each-ref', '--format=%(refname)%09%(objectname)%09%(committerdate:unix)%09%(symref)', 'refs/heads', 'refs/remotes',
  ])
  return stdout.split('\n').filter(Boolean).map((line) => {
    const [name, sha, date, symref] = line.replace(/\r$/, '').split('\t')
    return { name, sha, date: Number(date) || 0, symref: symref || null }
  })
}

export function resolveDefaultRefs(refs) {
  const byName = new Map(refs.map((r) => [r.name, r]))
  const chosen = []
  const originHead = byName.get('refs/remotes/origin/HEAD')
  if (originHead?.symref && byName.has(originHead.symref)) chosen.push(originHead.symref)
  for (const name of DEFAULT_CANDIDATES) if (byName.has(name) && !chosen.includes(name)) chosen.push(name)
  return chosen
}

export async function markDefaultBranch(repo, defaultRefs, bySha, extraShas = new Set()) {
  const reachable = new Set()
  if (!defaultRefs.length) return reachable
  for await (const sha of gitLines(repo, ['rev-list', ...defaultRefs, '--'])) {
    const commit = bySha.get(sha)
    if (commit) commit.onDefaultBranch = true
    if (commit || extraShas.has(sha)) reachable.add(sha)
  }
  return reachable
}

export async function computePatchIds(repo, revArgs) {
  return patchIdPipeline(repo, ['log', ...revArgs, '--no-merges', '-p', '--diff-merges=off', ...DIFF_FLAGS, '--format=commit %H', '--'])
}

function dateKey(commit) {
  return Date.parse(commit.commitDate) || 0
}

function chronological(a, b) {
  return dateKey(a) - dateKey(b) || (Date.parse(a.authorDate) || 0) - (Date.parse(b.authorDate) || 0) || (a.sha < b.sha ? -1 : 1)
}

export function assignPatchDuplicates(commits) {
  const canonical = new Map()
  const ordered = commits.filter((c) => !c.isMerge && c.patchId).sort(chronological)
  for (const commit of ordered) {
    const first = canonical.get(commit.patchId)
    if (!first) {
      canonical.set(commit.patchId, commit)
      commit.hasDefaultCopy = commit.onDefaultBranch
      continue
    }
    commit.dupOf = first.sha
    commit.dupKind = 'patch'
    if (commit.onDefaultBranch) first.hasDefaultCopy = true
  }
  return canonical
}

export async function detectSquashMerges(repo, { refs, defaultRefs, reachable, commits, bySha, sinceUnix, maxRefs }) {
  if (!defaultRefs.length) return { checked: 0, matched: 0, skipped: 0 }
  const squashTargets = new Map()
  for (const c of commits) {
    if (c.onDefaultBranch && !c.isMerge && c.patchId && !c.dupOf) squashTargets.set(c.patchId, c)
  }
  const tips = new Map()
  for (const ref of refs) {
    if (ref.symref || reachable.has(ref.sha) || ref.date < sinceUnix || tips.has(ref.sha)) continue
    tips.set(ref.sha, ref)
  }
  const candidates = [...tips.values()].sort((a, b) => b.date - a.date)
  const checkedList = candidates.slice(0, maxRefs)
  let matched = 0
  for (const ref of checkedList) {
    const base = await runGit(repo, ['merge-base', defaultRefs[0], ref.sha], { allowFail: true })
    const mergeBase = base.stdout.trim()
    if (base.code !== 0 || !mergeBase || mergeBase === ref.sha) continue
    const ids = await patchIdPipeline(repo, ['diff', ...DIFF_FLAGS, mergeBase, ref.sha])
    const branchPatch = [...ids.entries()].find(([sha]) => ZERO_SHA.test(sha))?.[1]
    const target = branchPatch && squashTargets.get(branchPatch)
    if (!target || target.dupOf || target.sha === ref.sha || dateKey(target) < ref.date * 1000) continue
    target.dupOf = ref.sha
    target.dupKind = 'squash'
    target.squashOfRef = ref.name
    for await (const sha of gitLines(repo, ['rev-list', '--no-merges', `${mergeBase}..${ref.sha}`, '--'])) {
      const branchCommit = bySha.get(sha)
      if (branchCommit) branchCommit.landedViaSquash = target.sha
    }
    matched++
  }
  return { checked: checkedList.length, matched, skipped: candidates.length - checkedList.length }
}
