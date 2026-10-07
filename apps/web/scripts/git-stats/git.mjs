import { spawn } from 'node:child_process'

const GIT_ENV = {
  ...process.env,
  GIT_NO_LAZY_FETCH: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_PAGER: 'cat',
  GCM_INTERACTIVE: 'never',
}

const SAFE_CONFIG = [
  '-c', 'core.quotePath=false',
  '-c', 'log.showSignature=false',
  '-c', 'color.ui=never',
  '-c', 'diff.noprefix=false',
  '-c', 'diff.mnemonicPrefix=false',
]

const STDERR_CAP = 64 * 1024

export function gitArgs(repo, args) {
  return ['-C', repo, '--no-pager', ...SAFE_CONFIG, ...args]
}

export function spawnGit(repo, args) {
  const child = spawn('git', gitArgs(repo, args), { env: GIT_ENV, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    if (stderr.length < STDERR_CAP) stderr += chunk.toString('utf8')
  })
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stderr: stderr.trim() }))
  })
  return { child, done }
}

export class GitError extends Error {
  constructor(repo, args, code, stderr) {
    super(`git ${args.slice(0, 3).join(' ')} failed in ${repo} (exit ${code}): ${stderr.slice(0, 500)}`)
    this.code = code
  }
}

export async function runGit(repo, args, { allowFail = false } = {}) {
  const { child, done } = spawnGit(repo, args)
  child.stdin.end()
  const chunks = []
  child.stdout.on('data', (c) => chunks.push(c))
  const { code, stderr } = await done
  const stdout = Buffer.concat(chunks).toString('utf8')
  if (code !== 0 && !allowFail) throw new GitError(repo, args, code, stderr)
  return { code, stdout, stderr }
}

export async function* splitStream(stream, separator) {
  let pending = []
  for await (const chunk of stream) {
    let start = 0
    let idx
    while ((idx = chunk.indexOf(separator, start)) !== -1) {
      pending.push(chunk.subarray(start, idx))
      yield Buffer.concat(pending).toString('utf8')
      pending = []
      start = idx + 1
    }
    if (start < chunk.length) pending.push(Buffer.from(chunk.subarray(start)))
  }
  if (pending.length) {
    const tail = Buffer.concat(pending).toString('utf8')
    if (tail) yield tail
  }
}

export async function* gitLines(repo, args) {
  const { child, done } = spawnGit(repo, args)
  child.stdin.end()
  let completed = false
  try {
    for await (const line of splitStream(child.stdout, 0x0a)) yield line.replace(/\r$/, '')
    completed = true
  } finally {
    if (!completed) child.kill()
  }
  const { code, stderr } = await done
  if (code !== 0) throw new GitError(repo, args, code, stderr)
}

export async function* gitTokens(repo, args) {
  const { child, done } = spawnGit(repo, args)
  child.stdin.end()
  let completed = false
  try {
    yield* splitStream(child.stdout, 0x00)
    completed = true
  } finally {
    if (!completed) child.kill()
  }
  const { code, stderr } = await done
  if (code !== 0) throw new GitError(repo, args, code, stderr)
}

export async function patchIdPipeline(repo, producerArgs) {
  const producer = spawnGit(repo, producerArgs)
  const consumer = spawnGit(repo, ['patch-id', '--stable'])
  producer.child.stdin.end()
  consumer.child.stdin.on('error', () => {})
  producer.child.stdout.pipe(consumer.child.stdin)
  const ids = new Map()
  for await (const line of splitStream(consumer.child.stdout, 0x0a)) {
    const [patchId, sha] = line.trim().split(' ')
    if (patchId && sha) ids.set(sha, patchId)
  }
  const [p, c] = await Promise.all([producer.done, consumer.done])
  if (p.code !== 0) throw new GitError(repo, producerArgs, p.code, p.stderr)
  if (c.code !== 0) throw new GitError(repo, ['patch-id'], c.code, c.stderr)
  return ids
}
