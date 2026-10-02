'use client'

import { useState } from 'react'
import { Terminal, Bot } from 'lucide-react'
import type { KairosBrainStatus } from '@/lib/kairos/routines/status-types'
import { Code, CodeBlock, Dot, SegmentedSwitch, Table } from './brainUi'
import { relativeTo } from './brainTime'
import type { SessionTool, Tick } from './setupProgress'
import { Act, Actions, B, CheckAgain, Disclosure, Expect } from './setupUi'

const SCRIPTS = '/path/to/shadow_app_aeon/apps/web/scripts'

const TOOLS: { id: SessionTool; label: string; icon: typeof Terminal; config: string; lang: string; node: string }[] = [
  { id: 'claude', label: 'Claude Code', icon: Terminal, config: '~/.claude/settings.json', lang: 'json', node: '18' },
  { id: 'codex', label: 'Codex', icon: Bot, config: '~/.codex/config.toml', lang: 'toml', node: '18' },
  { id: 'copilot', label: 'Copilot CLI', icon: Bot, config: '~/.copilot/config.json', lang: 'json', node: '22.13' },
]

function hookConfig(tool: SessionTool): string {
  if (tool === 'claude') {
    return `{
  "hooks": {
    "SessionEnd": [
      { "hooks": [{ "type": "command", "timeout": 3,
        "command": "node \\"${SCRIPTS}/claude-session-capture-dispatch.mjs\\"" }] }
    ],
    "SessionStart": [
      { "matcher": "startup", "hooks": [{ "type": "command", "timeout": 30,
        "command": "node \\"${SCRIPTS}/claude-session-capture.mjs\\" --backfill" }] }
    ]
  }
}`
  }
  if (tool === 'codex') {
    return `[[hooks.SessionStart]]
[[hooks.SessionStart.hooks]]
type = "command"
command = 'node "${SCRIPTS}/codex-session-capture-dispatch.mjs"'
timeout = 5

[[hooks.SessionEnd]]
[[hooks.SessionEnd.hooks]]
type = "command"
command = 'node "${SCRIPTS}/codex-session-capture-dispatch.mjs"'
timeout = 3`
  }
  const run = `node '${SCRIPTS}/copilot-session-capture-dispatch.mjs'`
  const ps = `$payload = $input | Out-String; $payload | & node '${SCRIPTS}/copilot-session-capture-dispatch.mjs'`
  const entry = `{ "type": "command", "timeoutSec": 5,
        "bash": "${run}",
        "powershell": "${ps}" }`
  return `{
  "hooks": {
    "sessionStart": [
      ${entry}
    ],
    "sessionEnd": [
      ${entry}
    ]
  }
}`
}

export function CaptureSessionsBody({
  status, ticks, refreshing, onRefresh,
}: {
  status: KairosBrainStatus
  ticks: Record<SessionTool, Tick>
  refreshing: boolean
  onRefresh: () => void
}) {
  const [toolId, setToolId] = useState<SessionTool>('claude')
  const tool = TOOLS.find((t) => t.id === toolId) ?? TOOLS[0]
  const lastAt = status.setup?.sessions[toolId] ?? null
  const env = `AEON_API_KEY=<paste your key>\nAEON_BASE_URL=${status.appUrl}`

  return (
    <>
      <p className="text-[12.5px] leading-relaxed text-white/65">
        Every coding session you finish becomes one memory — what you did, the repo, files and commits. Do this on the
        computer you code on (needs Node {tool.node}+ and a copy of the Aeon repo).
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedSwitch options={TOOLS} value={toolId} onChange={setToolId} layoutId="kairos-capture-tool" size="sm" label="Coding tool" />
        <ToolState tick={ticks[toolId]} lastAt={lastAt} nowIso={status.generatedAt} />
      </div>
      <Actions>
        <Act where="In Aeon">open <B>Help → MCP</B> and click <B>Generate API key</B>. Copy the key.</Act>
        <>
          <Act where="In apps/web/.env.local of your Aeon copy">add these two lines, with your key pasted in:</Act>
          <CodeBlock lang="env" value={env} />
        </>
        <>
          <Act where={`In ${tool.config}`}>add this, change <Code>/path/to</Code> to where your Aeon copy lives, then restart {tool.label}.</Act>
          <CodeBlock lang={tool.lang} value={hookConfig(toolId)} />
        </>
        <>
          <Act where={`In ${tool.label}`}>finish a real session (a few turns, at least one file read or edit).</Act>
          <Expect>Within a minute, “Last session saved” appears next to {tool.label} above.</Expect>
          <CheckAgain onClick={onRefresh} busy={refreshing} />
        </>
      </Actions>
      <Troubleshooting tool={toolId} />
    </>
  )
}

function ToolState({ tick, lastAt, nowIso }: { tick: Tick; lastAt: string | null; nowIso: string }) {
  if (tick === 'unknown') return null
  const tone = tick === 'done' ? 'var(--success)' : 'var(--text-dim)'
  return (
    <span className="inline-flex items-center gap-2 text-[11.5px]" style={{ color: tick === 'done' ? tone : undefined }}>
      <Dot tone={tone} />
      <span className={tick === 'done' ? undefined : 'text-white/45'}>
        {lastAt ? `Last session saved ${relativeTo(lastAt, nowIso)}` : 'No session saved yet'}
      </span>
    </span>
  )
}

function Troubleshooting({ tool }: { tool: SessionTool }) {
  return (
    <Disclosure label="Troubleshooting and settings">
      <Table
        rows={[
          ['AEON_API_KEY not set', 'Add it to apps/web/.env.local — the scripts read it from there.'],
          ['POST failed 401', 'The key is wrong or revoked. Make a new one in Help → MCP.'],
          ['POST error: fetch failed', 'AEON_BASE_URL is wrong, or it still points at a dev server that isn’t running.'],
          ['Runs, but no memory appears', 'Tiny sessions are skipped on purpose. Lower the two thresholds below.'],
          ['First save is slow', 'The database wakes up on the first request. Later saves take under a second.'],
        ]}
      />
      <Table
        rows={[
          ['BRAIN_MIN_USER_TURNS', 'Skip sessions with fewer turns than this. Default 3.'],
          ['BRAIN_MIN_TOOL_USES', 'Skip sessions with fewer tool calls than this. Default 2. Set both to 0 to keep everything.'],
          ['BRAIN_DEFAULT_REALM_ID', 'Optional — file every session under one realm.'],
          ...(tool === 'claude'
            ? ([
                ['BRAIN_AI_CLEANUP', '1 to have Claude write a clean title and summary. Adds 5–15 s per save.'],
                ['BRAIN_BACKFILL_HOURS', 'How far back the start-up sweep looks for missed sessions. Default 48.'],
              ] as [string, string][])
            : []),
        ]}
      />
    </Disclosure>
  )
}
