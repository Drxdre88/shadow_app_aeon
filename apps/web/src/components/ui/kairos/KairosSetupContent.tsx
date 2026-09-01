'use client'

import { useState } from 'react'
import { Terminal, Bot, Cpu, Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

type Provider = 'claude' | 'codex' | 'copilot' | 'local'

const PROVIDERS: { id: Provider; label: string; icon: typeof Terminal; status: 'live' | 'soon' }[] = [
  { id: 'claude', label: 'Claude Code', icon: Terminal, status: 'live' },
  { id: 'codex', label: 'Codex', icon: Bot, status: 'live' },
  { id: 'copilot', label: 'Copilot CLI', icon: Bot, status: 'live' },
  { id: 'local', label: 'Local AI', icon: Cpu, status: 'soon' },
]

export function KairosSetupContent() {
  const [provider, setProvider] = useState<Provider>('claude')

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2 flex-wrap">
        {PROVIDERS.map(({ id, label, icon: Icon, status }) => {
          const active = provider === id
          const soon = status === 'soon'
          return (
            <button
              key={id}
              onClick={() => !soon && setProvider(id)}
              disabled={soon}
              className={cn(
                'flex items-center gap-2 px-3.5 py-2 rounded-lg text-[12px] font-medium transition-all',
                active
                  ? 'bg-white/[0.10] text-white border border-white/20'
                  : 'bg-white/[0.03] text-white/55 hover:text-white/85 hover:bg-white/[0.06] border border-transparent',
                soon && 'opacity-40 cursor-not-allowed hover:bg-white/[0.03] hover:text-white/55',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
              {soon && (
                <span className="text-[9px] uppercase tracking-[0.16em] text-white/30 ml-1">Soon</span>
              )}
            </button>
          )
        })}
      </div>

      {provider === 'claude' && <ClaudeCodeSetup />}
      {provider === 'codex' && <CodingAgentSetup provider="codex" />}
      {provider === 'copilot' && <CodingAgentSetup provider="copilot" />}
      {provider === 'local' && <ComingSoon name="Local AI" />}
    </div>
  )
}

function CodingAgentSetup({ provider }: { provider: 'codex' | 'copilot' }) {
  const isCodex = provider === 'codex'
  const label = isCodex ? 'Codex' : 'Copilot CLI'
  const configPath = isCodex ? '~/.codex/config.toml' : '~/.copilot/hooks/aeon-session-capture.json'
  const script = isCodex ? 'codex-session-capture-dispatch.mjs' : 'copilot-session-capture-dispatch.mjs'
  const config = isCodex
    ? `[[hooks.SessionEnd]]
matcher = "^other$"

[[hooks.SessionEnd.hooks]]
type = "command"
command = 'node "C:/Users/you/path/to/shadow_app_aeon/apps/web/scripts/${script}"'
timeout = 3
statusMessage = "Saving session to Aeon"`
    : `{
  "version": 1,
  "hooks": {
    "sessionEnd": [
      {
        "type": "command",
        "bash": "node '/path/to/shadow_app_aeon/apps/web/scripts/${script}'",
        "powershell": "$payload = $input | Out-String; $payload | & 'C:/Program Files/nodejs/node.exe' 'C:/Users/you/path/to/shadow_app_aeon/apps/web/scripts/${script}'",
        "timeoutSec": 5
      }
    ]
  }
}`

  return (
    <div className="flex flex-col gap-7 text-white/85">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
        <div className="text-[10px] uppercase tracking-[0.22em] text-white/40 mb-2">What this does</div>
        <p className="text-[13px] leading-relaxed text-white/75">
          Every completed {label} session is read from its local session store, distilled into one
          structured Kairos memory, and labelled with the originating client.
        </p>
      </div>
      <Step number={1} title="Prerequisites">
        <Table
          rows={[
            ['Node', isCodex ? '≥ 18' : '≥ 22.13 for the unflagged built-in SQLite reader'],
            ['Aeon API key', 'Set as AEON_API_KEY in apps/web/.env.local'],
            ['Aeon reachable', 'Set AEON_BASE_URL when not using localhost:3000'],
          ]}
        />
      </Step>
      <Step number={2} title="Register the SessionEnd hook">
        <P>
          Add this to <Code>{configPath}</Code>, replace the repository path, then restart {label}.
          {isCodex
            ? ' The dispatcher returns immediately while capture finishes in the background.'
            : ' The dispatcher returns immediately, then waits briefly for Copilot to commit its final SQLite turn before reading it in the background.'}
        </P>
        <CodeBlock lang={isCodex ? 'toml' : 'json'} value={config} />
      </Step>
      <Step number={3} title="Verify it works">
        <P>
          Finish a substantive session, then filter the Brain by <Code>{provider}</Code>. The saved
          memory includes the session id, repo, branch, files, commits, and end reason.
        </P>
      </Step>
    </div>
  )
}

function ClaudeCodeSetup() {
  return (
    <div className="flex flex-col gap-7 text-white/85">
      <Intro />
      <Step number={1} title="Prerequisites">
        <Table
          rows={[
            ['Node', '≥ 18 (uses built-in fetch)'],
            ['Aeon API key', 'Set as AEON_API_KEY in apps/web/.env.local'],
            ['Aeon reachable', 'Dev server on localhost:3000, or set AEON_BASE_URL'],
            ['Memories table', 'Migration applied (already done in this repo)'],
          ]}
        />
      </Step>

      <Step number={2} title="Register the SessionEnd hook">
        <P>
          Paste this into <Code>~/.claude/settings.json</Code> under <Code>hooks</Code>. If you
          already have a <Code>SessionEnd</Code> block, just add this entry to its <Code>hooks</Code>
          list — multiple hooks happily share the same event.
        </P>
        <CodeBlock
          lang="jsonc"
          value={`{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \\"C:/Users/you/path/to/shadow_app_aeon/apps/web/scripts/claude-session-capture.mjs\\"",
            "timeout": 15000
          }
        ]
      }
    ]
  }
}`}
        />
      </Step>

      <Step number={3} title="Add the backfill safety net">
        <P>
          Same script with <Code>--backfill</Code> on <Code>SessionStart</Code>. If a session ever
          fails to capture cleanly (crash, force-quit, OS reboot), the next Claude launch picks it
          up. Already-saved sessions are skipped — no duplicates.
        </P>
        <CodeBlock
          lang="jsonc"
          value={`{
  "SessionStart": [
    {
      "matcher": "startup",
      "hooks": [
        {
          "type": "command",
          "command": "node \\"C:/Users/you/path/to/shadow_app_aeon/apps/web/scripts/claude-session-capture.mjs\\" --backfill",
          "timeout": 30000
        }
      ]
    },
    {
      "matcher": "resume",
      "hooks": [
        {
          "type": "command",
          "command": "node \\"C:/Users/you/path/to/shadow_app_aeon/apps/web/scripts/claude-session-capture.mjs\\" --backfill",
          "timeout": 30000
        }
      ]
    }
  ]
}`}
        />
      </Step>

      <Step number={4} title="Turn on AI summarization (recommended)">
        <P>
          Set <Code>BRAIN_AI_CLEANUP=1</Code> and the hook asks Claude itself to write a clean
          title and a 5–10 bullet summary for every captured session. Adds 5–15 seconds per save —
          worth it.
        </P>
        <Table
          rows={[
            ['BRAIN_AI_CLEANUP', '1 to enable. Off by default.'],
            ['BRAIN_AI_CLEANUP_BIN', 'Path to the claude binary. Default: claude'],
            ['BRAIN_AI_CLEANUP_TIMEOUT_MS', 'Default 60000'],
            ['BRAIN_DEFAULT_REALM_ID', 'Anchor every memory to a realm. Optional.'],
          ]}
        />
      </Step>

      <Step number={5} title="Verify it works">
        <P>Run a dry-run against any real transcript to see the payload without writing:</P>
        <CodeBlock
          lang="bash"
          value={`TRANSCRIPT=$(ls ~/.claude/projects/*/sessions/*.jsonl | head -1)
echo "{
  \\"session_id\\": \\"test-$(date +%s)\\",
  \\"transcript_path\\": \\"$TRANSCRIPT\\",
  \\"cwd\\": \\"$(pwd)\\",
  \\"hook_event_name\\": \\"SessionEnd\\",
  \\"reason\\": \\"prompt_input_exit\\"
}" | BRAIN_DRY_RUN=1 BRAIN_DEBUG=1 node apps/web/scripts/claude-session-capture.mjs`}
        />
        <P>Then check your brain after a real capture:</P>
        <CodeBlock
          lang="bash"
          value={`curl -s "http://localhost:3000/api/v1/memories?type=session_summary&limit=5" \\
  -H "Authorization: Bearer $AEON_API_KEY" | jq '.data[] | {title, createdAt}'`}
        />
      </Step>

      <Step number={6} title="Tune the quality gate">
        <P>
          By default, the hook ignores tiny chats (under 3 user turns AND under 2 tool calls).
          Override with env vars — set both to <Code>0</Code> to capture everything.
        </P>
        <Table
          rows={[
            ['BRAIN_MIN_USER_TURNS', 'Default 3'],
            ['BRAIN_MIN_TOOL_USES', 'Default 2'],
            ['BRAIN_BACKFILL_HOURS', 'Default 48 — widen if you want longer recovery'],
            ['BRAIN_BACKFILL_MAX', 'Default 50 — cap per backfill run'],
          ]}
        />
      </Step>

      <Step number={7} title="Troubleshooting">
        <Table
          rows={[
            ['AEON_API_KEY not set', 'Add it to apps/web/.env.local — the script auto-loads from there.'],
            ['POST failed 401', 'Key wrong or revoked. Re-issue in the Aeon settings.'],
            ['POST failed 400 Realm not accessible', 'BRAIN_DEFAULT_REALM_ID points at a realm you do not own.'],
            ['POST error: fetch failed', 'Dev server is not running and AEON_BASE_URL still localhost.'],
            ['Hook runs but no memory appears', 'Quality gate filtered it. Lower thresholds.'],
            ['Hook takes forever', 'First-request cold start on Neon. Subsequent fires under 500ms.'],
          ]}
        />
      </Step>
    </div>
  )
}

function ComingSoon({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3 border border-dashed border-white/[0.10] rounded-xl bg-white/[0.02]">
      <div
        className="text-[10px] font-medium uppercase tracking-[0.32em] px-3 py-1 rounded-full"
        style={{
          color: 'var(--primary)',
          border: '1px solid var(--primary)',
          textShadow: '0 0 6px var(--glow-color)',
          background: 'rgba(8,6,18,0.4)',
        }}
      >
        Coming soon
      </div>
      <h3 className="text-base font-semibold text-white/90">{name} support</h3>
      <p className="text-[12px] text-white/50 max-w-md">
        Same protocol — a session-end hook that posts a structured payload to{' '}
        <span className="text-white/70 font-mono">/api/v1/memories</span>. The {name} wrapper
        lands once the Claude Code path settles.
      </p>
    </div>
  )
}

function Intro() {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="text-[10px] uppercase tracking-[0.22em] text-white/40 mb-2">What this does</div>
      <p className="text-[13px] leading-relaxed text-white/75">
        Once this is set up, every Claude Code session you finish gets saved into Kairos — title,
        summary, files you touched, commits you made. If a session ever ends badly (crash,
        force-quit), the next one you start picks it up. One edit to your Claude settings, done.
      </p>
    </div>
  )
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-semibold"
          style={{
            border: '1px solid var(--primary)',
            color: 'var(--primary)',
            background: 'rgba(8,6,18,0.4)',
            textShadow: '0 0 6px var(--glow-color)',
          }}
        >
          {number}
        </div>
        <h3 className="text-[14px] font-semibold text-white">{title}</h3>
      </div>
      <div className="flex flex-col gap-3 pl-9">{children}</div>
    </section>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] leading-relaxed text-white/70">{children}</p>
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded text-[11.5px] font-mono text-white/90 bg-white/[0.06] border border-white/[0.08]">
      {children}
    </code>
  )
}

function CodeBlock({ lang, value }: { lang: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }
  return (
    <div className="relative rounded-lg border border-white/[0.08] bg-black/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06]">
        <span className="text-[9px] uppercase tracking-[0.2em] text-white/35 font-mono">{lang}</span>
        <button
          onClick={onCopy}
          className="flex items-center gap-1.5 text-[10px] text-white/45 hover:text-white/85 transition-colors"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="text-[11.5px] leading-relaxed text-white/85 font-mono p-3.5 overflow-x-auto whitespace-pre">
        {value}
      </pre>
    </div>
  )
}

function Table({ rows }: { rows: [string, string][] }) {
  return (
    <div className="rounded-lg border border-white/[0.08] overflow-hidden">
      {rows.map(([k, v], i) => (
        <div
          key={k}
          className={cn(
            'grid grid-cols-[200px_1fr] gap-3 px-3.5 py-2.5 text-[12px]',
            i % 2 === 0 ? 'bg-white/[0.02]' : 'bg-transparent',
          )}
        >
          <div className="font-mono text-white/65">{k}</div>
          <div className="text-white/75">{v}</div>
        </div>
      ))}
    </div>
  )
}
