import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildSessionRecord,
  clampTags,
  composeTitle,
  extractTelemetry,
  isUuid,
  mergeCommits,
  parseHangarBrief,
  parseRepoRegistry,
  parseResultEnvelope,
  resolveRepoIdentity,
  withDispatchContext,
} from './session-record.mjs'
import { truncate } from './session-title.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const DEV = 'C:/Users/me/data_science/dev_26'
const registry = parseRepoRegistry([
  '# comment',
  'repos:',
  '  aeon:',
  `    path: ${DEV}/shadow_app_aeon`,
  '    defaultBranch: main',
  '  swarm:',
  `    path: "${DEV}/shadow_app_swarm"`,
  'other:',
  '  ignored:',
  '    path: C:/nope/wrong',
].join('\n'))

test('registry maps hangar slug to the canonical folder basename', () => {
  assert.equal(registry.get('aeon'), 'shadow_app_aeon')
  assert.equal(registry.get('swarm'), 'shadow_app_swarm')
  assert.equal(registry.has('ignored'), false)
})

test('Hangar worktrees resolve to the canonical folder, not ".aeon-worktrees"', () => {
  assert.deepEqual(
    resolveRepoIdentity(`${DEV}/.aeon-worktrees/aeon/kairos-1a2b3c4d`, { registry }),
    { repo: 'shadow_app_aeon', registrySlug: 'aeon', worktree: true },
  )
  // Backslashes and a subdirectory of the worktree.
  assert.deepEqual(
    resolveRepoIdentity('C:\\Users\\me\\data_science\\dev_26\\.aeon-worktrees\\swarm\\wt\\apps\\web', { registry }),
    { repo: 'shadow_app_swarm', registrySlug: 'swarm', worktree: true },
  )
  // Not in the local registry → built-in map.
  assert.equal(resolveRepoIdentity(`${DEV}/.aeon-worktrees/relic/wt`, { registry }).repo, 'stp_app_relic')
  assert.equal(resolveRepoIdentity(`${DEV}/.aeon-worktrees/shadow-research-lab/wt`, { registry }).repo, 'shadow_research_lab')
  // Unknown slug → git remote basename.
  assert.deepEqual(
    resolveRepoIdentity(`${DEV}/.aeon-worktrees/newthing/wt`, { registry, remote: 'https://github.com/o/shadow_app_new.git' }),
    { repo: 'shadow_app_new', registrySlug: 'newthing', worktree: true },
  )
})

test('scratch dirs resolve to null or their real enclosing repo, never a fake slug', () => {
  const temp = 'C:/Users/me/AppData/Local/Temp/inferno-smoke-0929'
  assert.deepEqual(resolveRepoIdentity(temp, { registry }), { repo: null })
  // A git-init'ed temp dir is still scratch.
  assert.deepEqual(resolveRepoIdentity(temp, { toplevel: temp, registry }), { repo: null })
  const bench = 'C:/Users/me/.copilot/session-state/abc/files/bench'
  assert.deepEqual(resolveRepoIdentity(bench, { registry }), { repo: null })
  assert.deepEqual(resolveRepoIdentity(DEV, { registry }), { repo: null })
  assert.deepEqual(resolveRepoIdentity(DEV, { toplevel: DEV, registry }), { repo: null })
  // Temp cwd inside a real repo checkout → that repo.
  assert.deepEqual(resolveRepoIdentity(temp, { toplevel: `${DEV}/shadow_app_aeon`, registry }), { repo: 'shadow_app_aeon' })
  // Outside dev_26, a real repo resolves by its toplevel basename.
  assert.deepEqual(
    resolveRepoIdentity('C:/Users/me/OneDrive - sefe/Short Term Power/stp_app_ermac/src', {
      toplevel: 'C:/Users/me/OneDrive - sefe/Short Term Power/stp_app_ermac', registry,
    }),
    { repo: 'stp_app_ermac' },
  )
  assert.deepEqual(resolveRepoIdentity('C:/Users/me/Documents/notes', { registry }), { repo: null })
})

test('ordinary dev_26 checkouts keep their folder slug', () => {
  assert.deepEqual(resolveRepoIdentity(`${DEV}/shadow_app_aeon/apps/web`, { registry }), { repo: 'shadow_app_aeon' })
  assert.deepEqual(resolveRepoIdentity('/c/Users/me/data_science/dev_26/shadow_app_swarm', { registry }), { repo: 'shadow_app_swarm' })
})

test('tags are clamped to the API limit so one long branch cannot 400 the capture', () => {
  const branch = `branch:feat/${'x'.repeat(60)}`
  const tags = clampTags(['session', 'claude', 'session', '  ', branch, 42])
  assert.deepEqual(tags.slice(0, 2), ['session', 'claude'])
  assert.equal(tags.length, 3)
  assert.equal(tags[2].length, 50)
  assert.ok(tags.every((t) => t.length >= 1 && t.length <= 50))
  assert.equal(clampTags(Array.from({ length: 80 }, (_, i) => `t${i}`)).length, 50)
})

function fakeGit(responses, calls = []) {
  return (cwd, args) => {
    calls.push({ cwd, args })
    const key = args.slice(0, 2).join(' ')
    return responses[key] ?? null
  }
}

test('dispatch context carries Hangar env, brief card name and git state into the job', () => {
  const briefDir = mkdtempSync(join(tmpdir(), 'aeon-brief-'))
  try {
    writeFileSync(join(briefDir, 'aeon-hangar-hs-123-brief.md'), [
      'You are running an Aeon AI Hangar mission in repo "aeon" on branch kairos/1a2b.',
      'Objective: implement',
      'Mission: Fix the capture pipeline',
    ].join('\n'))
    const calls = []
    const git = fakeGit({
      'rev-parse --show-toplevel': `${DEV}/.aeon-worktrees/aeon/kairos-1a2b`,
      'rev-parse --abbrev-ref': 'kairos/1a2b',
      'remote get-url': 'https://github.com/o/shadow_app_aeon.git',
      'rev-parse HEAD': 'a'.repeat(40),
      'log --pretty=format:%H%x1f%s': `${'b'.repeat(40)}\x1ffeat: one\n${'c'.repeat(40)}\x1ffix: two`,
    }, calls)
    const taskId = '2f1c7a3e-5b1d-4c8e-9f0a-1b2c3d4e5f60'
    const out = withDispatchContext(
      { client: 'claude', session_id: 's1', cwd: `${DEV}/.aeon-worktrees/aeon/kairos-1a2b`, transcript_path: join(briefDir, 'none.jsonl') },
      { env: { KAIROS_SESSION_ID: 'hs-123', AEON_TASK_ID: taskId }, git, briefDir, now: () => new Date('2026-09-30T10:00:00Z') },
    )
    assert.equal(out.session_id, 's1')
    assert.deepEqual(out.dispatch, {
      v: 1,
      at: '2026-09-30T10:00:00.000Z',
      hangarSessionId: 'hs-123',
      cardName: 'Fix the capture pipeline',
      objective: 'implement',
      taskId,
      git: {
        toplevel: `${DEV}/.aeon-worktrees/aeon/kairos-1a2b`,
        branch: 'kairos/1a2b',
        remote: 'https://github.com/o/shadow_app_aeon.git',
        headSha: 'a'.repeat(40),
        commits: [{ sha: 'b'.repeat(40), subject: 'feat: one' }, { sha: 'c'.repeat(40), subject: 'fix: two' }],
      },
    })
    // No transcript start → a worktree lists its unpushed commits instead of --since.
    assert.ok(calls.some((c) => c.args.includes('--not') && c.args.includes('--remotes')))
  } finally {
    rmSync(briefDir, { recursive: true, force: true })
  }
})

test('dispatch context omits absent env and never throws', () => {
  const plain = withDispatchContext({ client: 'codex', session_id: 's2', cwd: 'C:/x' }, {
    env: { AEON_TASK_ID: '' }, git: () => null, now: () => new Date('2026-09-30T10:00:00Z'),
  })
  assert.deepEqual(plain.dispatch, { v: 1, at: '2026-09-30T10:00:00.000Z' })
  const exploding = { client: 'codex', session_id: 's3', cwd: 'C:/x' }
  assert.equal(withDispatchContext(exploding, { git: () => { throw new Error('boom') }, env: {} }), exploding)
  assert.equal(withDispatchContext(null), null)
})

test('hangar brief parsing reads Mission and Objective lines only', () => {
  assert.deepEqual(parseHangarBrief('Objective: review\nMission: Card title\nRequest:\nMission: not me'), { cardName: 'Card title', objective: 'review' })
  assert.deepEqual(parseHangarBrief('a raw prompt with no header'), {})
})

test('Claude telemetry: branch, model, deduped usage, cost-state, tools, errors, commits, PRs, tests', () => {
  const usage = { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 20 }
  const records = [
    { type: 'user', gitBranch: 'feat/x', message: { content: 'go' }, timestamp: '2026-09-30T09:00:00Z' },
    // One API message split across two records must count once.
    { type: 'assistant', gitBranch: 'feat/x', message: { id: 'm1', model: 'claude-x', usage, content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git commit -m "feat: thing"' } }] } },
    { type: 'assistant', message: { id: 'm1', model: 'claude-x', usage, content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'gh pr create --fill' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }, toolUseResult: { stdout: '[feat/x 1a2b3c4] feat: thing\n 2 files changed', stderr: '' } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'x' }] }, toolUseResult: { stdout: 'https://github.com/o/r/pull/42\n', stderr: '' } },
    { type: 'assistant', message: { id: 'm2', model: 'claude-x', usage, content: [
      { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'npx vitest run src/a.test.ts' } },
      { type: 'tool_use', id: 't4', name: 'Edit', input: { file_path: 'a.ts' } },
    ] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't3', is_error: true, content: 'Error: Exit code 1' }] }, toolUseResult: 'Error: Exit code 1\n Tests  1 failed | 3 passed (4)' },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't4', content: 'done' }] } },
    // A later passing run supersedes the failure.
    { type: 'assistant', message: { id: 'm3', model: '<synthetic>', content: [{ type: 'tool_use', id: 't5', name: 'Bash', input: { command: 'npm run test --workspace=apps/web' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't5', content: '' }] }, toolUseResult: { stdout: ' Test Files  9 passed (9)\n      Tests  120 passed (120)', stderr: '' } },
    // A commit-looking line in unrelated output is NOT a commit.
    { type: 'assistant', message: { id: 'm4', content: [{ type: 'tool_use', id: 't6', name: 'Bash', input: { command: 'cat notes.md' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't6', content: '' }] }, toolUseResult: { stdout: '[main 9f9f9f9] not mine', stderr: '' } },
    { type: 'ai-title', aiTitle: 'Capture fixes' },
    { type: 'cost-state', totalCostUSD: 1.25, totalLinesAdded: 40, totalLinesRemoved: 3 },
  ]
  const t = extractTelemetry(records, 'claude')
  assert.equal(t.branch, 'feat/x')
  assert.equal(t.model, 'claude-x')
  assert.equal(t.inputTokens, 30)
  assert.equal(t.outputTokens, 40)
  assert.equal(t.cacheReadTokens, 200)
  assert.equal(t.costUsd, 1.25)
  assert.equal(t.linesAdded, 40)
  assert.equal(t.linesRemoved, 3)
  assert.deepEqual(t.toolCalls, { Bash: 5, Edit: 1 })
  assert.equal(t.errorCount, 1)
  assert.deepEqual(t.commits, [{ sha: '1a2b3c4', subject: 'feat: thing' }])
  assert.deepEqual(t.prs, [{ number: 42, url: 'https://github.com/o/r/pull/42', action: 'created' }])
  assert.deepEqual(t.tests, { status: 'passed', summary: 'Test Files  9 passed (9)' })
  assert.equal(t.aiTitle, 'Capture fixes')
})

test('Codex telemetry: model, cumulative tokens, tool outputs for tests/errors/PRs', () => {
  const records = [
    { type: 'session_meta', payload: { cwd: 'C:/repo' } },
    { type: 'turn_context', payload: { model: 'gpt-a' } },
    { type: 'turn_context', payload: { model: 'gpt-b' } },
    { type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['pytest', '-q'] }) } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ output: '2 failed, 5 passed in 1.2s', metadata: { exit_code: 1 } }) } },
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'c2', input: 'await tools.exec_command({cmd:"gh pr merge 7 --squash"})' } },
    { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'c2', output: [{ type: 'input_text', text: 'Merged https://github.com/o/r/pull/7\nProcess exited with code 0' }] } },
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 9 } } } },
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 300, cached_input_tokens: 200, output_tokens: 30 } } } },
    { type: 'event_msg', payload: { type: 'error', message: 'stream disconnected' } },
  ]
  const t = extractTelemetry(records, 'codex')
  assert.equal(t.model, 'gpt-b')
  assert.equal(t.inputTokens, 100)
  assert.equal(t.cacheReadTokens, 200)
  assert.equal(t.outputTokens, 30)
  assert.deepEqual(t.toolCalls, { shell: 1, exec: 1 })
  assert.equal(t.errorCount, 2)
  assert.deepEqual(t.tests, { status: 'failed', summary: '2 failed, 5 passed in 1.2s' })
  assert.deepEqual(t.prs, [{ number: 7, url: 'https://github.com/o/r/pull/7', action: 'merged' }])
})

test('Copilot telemetry comes from the session_meta the SQLite loader writes', () => {
  const t = extractTelemetry([
    { type: 'session_meta', payload: { client: 'copilot', branch: 'feat/y', usage: { model: 'm', inputTokens: 1000, outputTokens: 50, cacheReadTokens: 900 } } },
    { type: 'user', message: { content: 'hi' } },
  ], 'copilot')
  assert.deepEqual(t, { branch: 'feat/y', model: 'm', inputTokens: 100, outputTokens: 50, cacheReadTokens: 900 })
  assert.deepEqual(extractTelemetry(null, 'claude'), {})
})

test("Copilot's own session summary becomes aiTitle, so tool lines never title the memory", () => {
  const meta = (title) => [{ type: 'session_meta', payload: { client: 'copilot', ...(title === undefined ? {} : { title }) } }]
  assert.equal(extractTelemetry(meta('  Build Nightly Repo-Docs Feeder '), 'copilot').aiTitle, 'Build Nightly Repo-Docs Feeder')
  assert.equal('aiTitle' in extractTelemetry(meta('   '), 'copilot'), false)
  assert.equal('aiTitle' in extractTelemetry(meta(undefined), 'copilot'), false)
  const title = composeTitle({ repo: 'aeon', aiTitle: extractTelemetry(meta('Deploy Dagster Poll'), 'copilot').aiTitle, firstPrompt: 'Edit X.md +11 -3' }, (s) => s)
  assert.equal(title, 'aeon: Deploy Dagster Poll')
})

test('session record v1 is flat, capped and drops empty values', () => {
  const record = buildSessionRecord({
    client: 'claude',
    sessionId: 's',
    taskId: undefined,
    repo: null,
    worktree: true,
    firstPrompt: 'p'.repeat(900),
    files: Array.from({ length: 70 }, (_, i) => `f${i}`),
    commits: [],
    toolCalls: {},
    inputTokens: 12.4,
    errorCount: -1,
    costUsd: 0.5,
    notAKey: 'dropped',
  })
  assert.deepEqual(Object.keys(record), ['v', 'client', 'sessionId', 'worktree', 'firstPrompt', 'inputTokens', 'costUsd', 'files'])
  assert.equal(record.v, 1)
  assert.equal(record.firstPrompt.length, 500)
  assert.equal(record.files.length, 50)
  assert.equal(record.inputTokens, 12)
  assert.equal(buildSessionRecord({ client: 'claude' }), null)
})

test('title prefers card name, then client title, then the first prompt', () => {
  assert.equal(composeTitle({ repo: 'shadow_app_aeon', cardName: 'Fix capture', aiTitle: 'x', firstPrompt: 'y' }, truncate), 'shadow_app_aeon: Fix capture')
  assert.equal(composeTitle({ repo: 'r', aiTitle: 'Named', firstPrompt: 'y' }, truncate), 'r: Named')
  assert.equal(composeTitle({ repo: null, firstPrompt: `a  b ${'c'.repeat(80)}` }, truncate).length, 60)
})

test('mission result envelope, commit merge and uuid guard', () => {
  const text = 'done\n```json\n{"status":"needs_input","outcome":"o","questions":["q?"]}\n```'
  assert.deepEqual(parseResultEnvelope(text), { status: 'needs_input', outcome: 'o', questions: ['q?'] })
  assert.equal(parseResultEnvelope('```json\n{"status":"weird"}\n```'), null)
  assert.deepEqual(mergeCommits([{ sha: 'abcdef1234', subject: 'a' }], [{ sha: 'abcdef1', subject: 'a' }, { sha: '9999999' }]),
    [{ sha: 'abcdef1234', subject: 'a' }, { sha: '9999999' }])
  assert.equal(isUuid('2f1c7a3e-5b1d-4c8e-9f0a-1b2c3d4e5f60'), true)
  assert.equal(isUuid('task-1'), false)
})

// ─── end-to-end through the real capture script (dry run, never POSTs) ──

function sandboxEnv(root) {
  const env = { ...process.env }
  for (const key of ['KAIROS_SESSION_ID', 'AEON_TASK_ID', 'KAIROS_CALLBACK_URL', 'KAIROS_CALLBACK_TOKEN', 'AEON_HOOK_CHILD', 'BRAIN_AI_CLEANUP']) delete env[key]
  return {
    ...env,
    BRAIN_DRY_RUN: '1',
    AEON_API_KEY: 'test-key-not-real',
    AEON_BASE_URL: 'http://127.0.0.1:9',
    AEON_CAPTURE_HOME: join(root, 'capture'),
    CLAUDE_HOME: join(root, 'claude-home'),
    CODEX_HOME: join(root, 'codex-home'),
    COPILOT_HOME: join(root, 'copilot-home'),
  }
}

function writeClaudeFixture(root, cwd) {
  const path = join(root, 'transcript.jsonl')
  const lines = [
    { type: 'user', cwd, gitBranch: `feat/${'long-branch-name-'.repeat(4)}`, timestamp: '2026-09-30T09:00:00.000Z', message: { content: 'Fix the capture pipeline end to end' } },
    { type: 'assistant', cwd, timestamp: '2026-09-30T09:10:00.000Z', message: { id: 'm1', model: 'claude-x', usage: { input_tokens: 1, output_tokens: 2 }, content: [
      { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'a.ts' } },
      { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'git commit -m x' } },
    ] } },
    { type: 'user', cwd, timestamp: '2026-09-30T09:11:00.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: '' }] }, toolUseResult: { stdout: '[feat/y abc1234] fix: capture', stderr: '' } },
    { type: 'assistant', cwd, timestamp: '2026-09-30T09:30:00.000Z', message: { id: 'm2', content: [{ type: 'text', text: 'Done.\n\n## Executive Summary\n\nPlain words.\n\n**Key points:**\n- Sessions now carry a record\n- Second bullet' }] } },
  ]
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n'))
  return path
}

function dryRun(payload, env) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  const result = spawnSync(process.execPath, [join(scriptDir, 'claude-session-capture.mjs'), '--hook-payload-base64', encoded, '--queue-worker'], {
    encoding: 'utf8', env, windowsHide: true, timeout: 60_000,
  })
  const marker = result.stderr.indexOf('payload follows:')
  assert.ok(marker >= 0, `dry-run payload missing: ${result.stderr.slice(-800)}`)
  return JSON.parse(result.stderr.slice(result.stderr.indexOf('{', marker)))
}

test('capture script: old job shape (no dispatch) still builds a v1 record', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-capture-e2e-'))
  try {
    const cwd = join(root, 'not-a-repo')
    mkdirSync(cwd)
    const transcript = writeClaudeFixture(root, cwd)
    const body = dryRun({ client: 'claude', session_id: 'old-shape-1', transcript_path: transcript, cwd, hook_event_name: 'SessionEnd', reason: 'other' }, sandboxEnv(root))
    const s = body.sourceMetadata.session
    assert.equal(s.v, 1)
    assert.equal(s.client, 'claude')
    assert.equal(s.sessionId, 'old-shape-1')
    assert.equal(s.hangarSessionId, undefined)
    assert.equal(s.endedAt, '2026-09-30T09:30:00.000Z')
    assert.equal(s.startedAt, '2026-09-30T09:00:00.000Z')
    assert.equal(s.durationMin, 30)
    assert.deepEqual(s.commits, [{ sha: 'abc1234', subject: 'fix: capture' }])
    assert.equal(body.taskId, null)
    assert.equal(body.summary, 'Sessions now carry a record')
    assert.deepEqual(body.execSummary, ['Sessions now carry a record', 'Second bullet'])
    // Temp dir → no fake repo slug; long branch tag clamped.
    assert.equal(s.repo, undefined)
    assert.equal(body.sourceMetadata.repo, null)
    assert.ok(body.tags.every((t) => t.length <= 50))
    assert.ok(body.tags.some((t) => t.startsWith('branch:feat/long-branch')))
    // Legacy top-level keys survive.
    for (const key of ['externalId', 'branch', 'sessionId', 'client', 'cwd', 'filesTouched', 'commits', 'stats']) {
      assert.ok(key in body.sourceMetadata, key)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('capture script: dispatch context sets taskId, hangar ids, worktree repo and card title', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-capture-e2e-'))
  try {
    const cwd = join(root, 'data_science', 'dev_26', '.aeon-worktrees', 'aeon', 'kairos-1a2b')
    const transcript = writeClaudeFixture(root, cwd)
    const taskId = '2f1c7a3e-5b1d-4c8e-9f0a-1b2c3d4e5f60'
    const body = dryRun({
      client: 'claude', session_id: 'new-shape-1', transcript_path: transcript, cwd, hook_event_name: 'SessionEnd',
      dispatch: {
        v: 1, at: '2026-09-30T09:31:00.000Z', hangarSessionId: 'hs-9', taskId, cardName: 'Fix capture', objective: 'implement',
        git: { toplevel: cwd, branch: 'kairos/1a2b', remote: 'https://github.com/o/shadow_app_aeon.git', commits: [{ sha: 'abc1234def0', subject: 'fix: capture' }] },
      },
    }, sandboxEnv(root))
    const s = body.sourceMetadata.session
    assert.equal(body.taskId, taskId)
    assert.equal(s.taskId, taskId)
    assert.equal(s.hangarSessionId, 'hs-9')
    assert.equal(s.repo, 'shadow_app_aeon')
    assert.equal(s.registrySlug, 'aeon')
    assert.equal(s.worktree, true)
    assert.equal(s.cardName, 'Fix capture')
    assert.equal(s.objective, 'implement')
    assert.deepEqual(s.commits, [{ sha: 'abc1234def0', subject: 'fix: capture' }])
    assert.equal(body.title, 'shadow_app_aeon: Fix capture')
    assert.equal(body.aiTitle, 'Fix capture')
    assert.deepEqual(body.sourceMetadata.commits, ['abc1234 fix: capture'])
    // A non-uuid task id stays in the record but never reaches the uuid column.
    const loose = dryRun({ client: 'claude', session_id: 'new-shape-2', transcript_path: transcript, cwd, dispatch: { v: 1, taskId: 'task-7' } }, sandboxEnv(root))
    assert.equal(loose.taskId, null)
    assert.equal(loose.sourceMetadata.session.taskId, 'task-7')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('drain: a job queued in the old on-disk shape still drains', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-drain-compat-'))
  try {
    const env = sandboxEnv(root)
    const pending = join(env.AEON_CAPTURE_HOME, 'pending')
    mkdirSync(pending, { recursive: true })
    const cwd = join(root, 'not-a-repo')
    mkdirSync(cwd)
    const transcript = writeClaudeFixture(root, cwd)
    // Exactly what enqueueCapture wrote before dispatch context existed.
    writeFileSync(join(pending, 'claude-legacy-1.json'), JSON.stringify({
      version: 1, client: 'claude', sessionId: 'legacy-1', attempts: 0, createdAt: '2026-09-29T00:00:00.000Z',
      payload: { session_id: 'legacy-1', transcript_path: transcript, cwd, hook_event_name: 'SessionEnd', reason: 'other', client: 'claude' },
    }))
    const result = spawnSync(process.execPath, [join(scriptDir, 'session-capture-drain.mjs')], { encoding: 'utf8', env, windowsHide: true, timeout: 120_000 })
    assert.equal(result.status, 0, result.stderr)
    // Dry run reaches the end of the capture path and exits 3 ("nothing
    // posted"), which the drain treats as a clean skip — a crash would exit 2
    // and leave the job pending with attempts=1.
    assert.deepEqual(readdirSync(pending), [])
    assert.equal(existsSync(join(env.AEON_CAPTURE_HOME, 'failed')), false)
    assert.match(readFileSync(join(env.AEON_CAPTURE_HOME, 'capture.log'), 'utf8'), /skipped non-substantive claude\/legacy-1/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('dispatcher: env propagates into the queued job', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-dispatch-e2e-'))
  try {
    const env = sandboxEnv(root)
    const taskId = '2f1c7a3e-5b1d-4c8e-9f0a-1b2c3d4e5f60'
    env.KAIROS_SESSION_ID = 'hs-dispatch'
    env.AEON_TASK_ID = taskId
    // Hold the drain lock with a live pid so the detached drain exits at once
    // and the queued job stays on disk for inspection.
    const lock = join(env.AEON_CAPTURE_HOME, 'drain.lock')
    mkdirSync(lock, { recursive: true })
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }))
    const input = JSON.stringify({ session_id: 'dispatch-1', transcript_path: join(root, 'missing.jsonl'), cwd: root, hook_event_name: 'SessionEnd' })
    const result = spawnSync(process.execPath, [join(scriptDir, 'claude-session-capture-dispatch.mjs')], { input, encoding: 'utf8', env, windowsHide: true, timeout: 30_000 })
    assert.equal(result.status, 0, result.stderr)
    const job = JSON.parse(readFileSync(join(env.AEON_CAPTURE_HOME, 'pending', 'claude-dispatch-1.json'), 'utf8'))
    assert.equal(job.version, 1)
    assert.equal(job.sessionId, 'dispatch-1')
    assert.equal(job.payload.client, 'claude')
    assert.equal(job.payload.dispatch.hangarSessionId, 'hs-dispatch')
    assert.equal(job.payload.dispatch.taskId, taskId)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
