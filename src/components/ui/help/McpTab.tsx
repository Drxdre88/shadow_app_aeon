'use client'

import { useSession } from 'next-auth/react'
import { Terminal, Key, Link2, Wrench } from 'lucide-react'
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
    name: 'Batch',
    tools: [
      'batch_create_tasks',
      'batch_create_checklist_items',
      'batch_add_dependencies',
      'setup_board',
    ],
  },
]

function UserIdDisplay() {
  const { data: session } = useSession()
  const { colors } = useThemeStore()
  const userId = session?.user?.id ?? 'Sign in to see your User ID'

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${colors.primary}20` }}
      >
        <Key className="w-4 h-4" style={{ color: colors.primary }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-400">Your User ID</p>
        <p className="text-sm font-mono text-white truncate">{userId}</p>
      </div>
      {session?.user?.id && <CopyButton text={session.user.id} />}
    </div>
  )
}

function McpConfigBlock() {
  const configTemplate = `{
  "mcpServers": {
    "aeon": {
      "type": "sse",
      "url": "https://your-deployment-url.vercel.app/api/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`

  return <CodeBlock copyText={configTemplate}>{configTemplate}</CodeBlock>
}

function EnvBlock() {
  const envTemplate = `AEON_API_KEY=your-chosen-secret-key
AEON_API_USER_ID=your-user-id-from-above`

  return <CodeBlock copyText={envTemplate}>{envTemplate}</CodeBlock>
}

export function McpTab() {
  const { colors } = useThemeStore()

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-300 leading-relaxed">
        Connect AI assistants (Claude, Cursor, etc.) to Aeon via the Model Context Protocol (MCP).
        This gives your AI full access to manage projects, tasks, and boards programmatically.
      </p>

      <Section title="Your Connection Info">
        <UserIdDisplay />
      </Section>

      <Section title="Setup Guide">
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-medium text-white">
              1. Set environment variables on your deployment
            </p>
            <EnvBlock />
            <p className="text-xs text-slate-500">
              Choose any secret for AEON_API_KEY. Copy your User ID from above for AEON_API_USER_ID.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-white">
              2. Add to your AI client&apos;s MCP config
            </p>
            <McpConfigBlock />
            <p className="text-xs text-slate-500">
              Replace YOUR_API_KEY with the same secret you set in step 1.
              For Claude Desktop, add this to claude_desktop_config.json.
              For Cursor, add to .cursor/mcp.json.
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
            title="Bearer Token"
            description="Your AEON_API_KEY is sent as a Bearer token in the Authorization header with every MCP request."
          />
          <FeatureCard
            icon={Link2}
            title="User Binding"
            description="AEON_API_USER_ID links the API key to your account. All operations execute as your user."
          />
          <FeatureCard
            icon={Terminal}
            title="SSE Transport"
            description="MCP uses Server-Sent Events for real-time communication between your AI client and Aeon."
          />
          <FeatureCard
            icon={Wrench}
            title="35 Tools"
            description="Full CRUD for projects, columns, tasks, Gantt, dependencies, labels, checklists, and batch ops."
          />
        </div>
      </Section>

      <Section title="Available Tools (35)">
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
