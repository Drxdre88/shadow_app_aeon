'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { Terminal, Key, Link2, Wrench, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { Section, FeatureCard, CodeBlock, CopyButton } from './shared'
import { useThemeStore } from '@/stores/themeStore'

const TOOL_CATEGORIES = [
  {
    name: 'Projects',
    tools: [
      'list_projects',
      'get_project',
      'create_project',
      'update_project',
      'delete_project',
      'project_summary',
    ],
  },
  {
    name: 'Columns',
    tools: [
      'list_columns',
      'create_column',
      'update_column',
      'delete_column',
      'reorder_columns',
    ],
  },
  {
    name: 'Tasks',
    tools: [
      'list_tasks',
      'create_task',
      'update_task',
      'delete_task',
      'get_task_detail',
    ],
  },
  {
    name: 'Gantt',
    tools: ['list_gantt_tasks', 'create_gantt_task', 'update_gantt_task'],
  },
  {
    name: 'Dependencies',
    tools: ['list_dependencies', 'add_dependency', 'remove_dependency'],
  },
  {
    name: 'Labels',
    tools: [
      'list_labels',
      'create_label',
      'delete_label',
      'add_label_to_task',
      'remove_label_from_task',
      'set_task_labels',
    ],
  },
  {
    name: 'Checklist',
    tools: [
      'create_checklist_item',
      'update_checklist_item',
      'delete_checklist_item',
    ],
  },
  {
    name: 'Batch & Analytics',
    tools: [
      'batch_create_tasks',
      'batch_create_checklist_items',
      'batch_add_dependencies',
      'setup_board',
      'get_velocity_stats',
    ],
  },
]

type ApiKeyEntry = {
  id: string
  name: string
  keyPrefix: string
  lastUsedAt: string | null
  createdAt: string
}

function ApiKeyManager() {
  const { colors } = useThemeStore()
  const [keys, setKeys] = useState<ApiKeyEntry[]>([])
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyPlaintext, setNewKeyPlaintext] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/api-keys')
      if (!res.ok) return
      const json = await res.json()
      setKeys(json.data || [])
    } catch {}
  }, [])

  useEffect(() => { fetchKeys() }, [fetchKeys])

  const handleCreate = async () => {
    if (!newKeyName.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Failed to create key')
        return
      }
      setNewKeyPlaintext(json.data.key)
      setNewKeyName('')
      fetchKeys()
    } catch {
      setError('Failed to create key')
    } finally {
      setLoading(false)
    }
  }

  const handleRevoke = async (keyId: string) => {
    try {
      await fetch(`/api/v1/api-keys/${keyId}`, { method: 'DELETE' })
      fetchKeys()
    } catch {}
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Key name (e.g. Claude Desktop)"
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          maxLength={100}
          className="flex-1 px-3 py-2 text-sm bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-white/20"
        />
        <button
          onClick={handleCreate}
          disabled={loading || !newKeyName.trim()}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-40"
          style={{ backgroundColor: `${colors.primary}20`, color: colors.primary }}
        >
          <Plus className="w-4 h-4" />
          Generate
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {newKeyPlaintext && (
        <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <p className="text-xs font-medium text-amber-300">
              Copy this key now. It will not be shown again.
            </p>
          </div>
          <div className="flex items-center gap-2 p-2 rounded bg-black/40 font-mono text-xs text-white break-all">
            <span className="flex-1">{newKeyPlaintext}</span>
            <CopyButton text={newKeyPlaintext} />
          </div>
          <button
            onClick={() => setNewKeyPlaintext(null)}
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {keys.length > 0 ? (
        <div className="space-y-2">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white font-medium truncate">{k.name}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs font-mono text-slate-500">{k.keyPrefix}...</span>
                  <span className="text-xs text-slate-600">
                    Created {new Date(k.createdAt).toLocaleDateString()}
                  </span>
                  {k.lastUsedAt && (
                    <span className="text-xs text-slate-600">
                      Last used {new Date(k.lastUsedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleRevoke(k.id)}
                className="p-1.5 rounded-md bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors ml-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500 text-center py-2">
          No API keys yet. Generate one to connect your AI client.
        </p>
      )}
    </div>
  )
}

function McpConfigBlock() {
  const configTemplate = `{
  "mcpServers": {
    "aeon": {
      "type": "sse",
      "url": "https://aeon.shadow-lab.ai/api/sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`

  return <CodeBlock copyText={configTemplate}>{configTemplate}</CodeBlock>
}

export function McpTab() {
  const { colors } = useThemeStore()

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-300 leading-relaxed">
        Connect AI assistants (Claude, Cursor, etc.) to Aeon via the Model Context Protocol (MCP).
        This gives your AI full access to manage projects, tasks, and boards programmatically.
      </p>

      <Section title="API Keys">
        <ApiKeyManager />
      </Section>

      <Section title="Setup Guide">
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-medium text-white">
              1. Generate an API key above
            </p>
            <p className="text-xs text-slate-500">
              Give it a descriptive name like &quot;Claude Desktop&quot; or &quot;Cursor&quot;.
              The key is shown once -- copy it immediately.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-white">
              2. Add to your AI client&apos;s MCP config
            </p>
            <McpConfigBlock />
            <p className="text-xs text-slate-500">
              Replace YOUR_API_KEY with the key you generated.
              For Claude Desktop, add to claude_desktop_config.json.
              For Cursor, add to .cursor/mcp.json.
              For Claude Code, add to .mcp.json.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-white">
              3. Verify connection
            </p>
            <p className="text-xs text-slate-400">
              Ask your AI assistant to &quot;list my projects&quot;. If configured correctly,
              it will call the list_projects tool and return your projects.
            </p>
          </div>
        </div>
      </Section>

      <Section title="How Auth Works">
        <div className="grid grid-cols-2 gap-3">
          <FeatureCard
            icon={Key}
            title="Per-User Keys"
            description="Each user generates their own API keys. Keys are hashed and bound to your account for secure, isolated access."
          />
          <FeatureCard
            icon={Link2}
            title="Data Isolation"
            description="Your API key only accesses your projects. All operations execute with your user's permissions."
          />
          <FeatureCard
            icon={Terminal}
            title="SSE Transport"
            description="MCP uses Server-Sent Events for real-time communication between your AI client and Aeon."
          />
          <FeatureCard
            icon={Wrench}
            title="36 Tools"
            description="Full CRUD for projects, columns, tasks, Gantt, dependencies, labels, checklists, batch ops, and analytics."
          />
        </div>
      </Section>

      <Section title="Available Tools (36)">
        <div className="grid grid-cols-2 gap-4">
          {TOOL_CATEGORIES.map((cat) => (
            <div key={cat.name}>
              <p
                className="text-xs font-semibold mb-1.5"
                style={{ color: colors.primary }}
              >
                {cat.name}
              </p>
              <div className="space-y-1">
                {cat.tools.map((tool) => (
                  <p key={tool} className="text-xs font-mono text-slate-400">
                    {tool}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
