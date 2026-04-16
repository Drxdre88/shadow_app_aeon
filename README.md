# AEON

> **The last PM tool of this dying world.**

A multi-tenant kanban / project management app with real-time sync, multiple views (Kanban, Gantt, Canvas), AI-agent control via MCP, and 151 themes worth of personalization. Currently in **closed beta**.

---

## What is AEON

AEON is a project management workspace built for individuals and small teams who think visually and want their tools to feel alive. It combines:

- A **fast kanban board** with drag-and-drop, dependencies, comments, checklists, and undo
- A **Gantt timeline** view linked to the same tasks
- A **Canvas / whiteboard** view powered by ReactFlow for mind-mapping and free-form planning
- **Realms** (shared workspaces) for multi-user collaboration with role-based access
- A **trophy room** that archives completed work with snapshot history
- **Real-time sync** via Pusher (~1s latency) with polling fallback
- An **MCP server** that lets AI agents (Claude, Cursor, etc.) drive the board the same way humans do
- A **REST API** mirroring the same capabilities for external integrations
- **151 theme presets**, 13 visual effects, celebration animations, and a command palette — because work tools should be fun

---

## Features

### Boards & Tasks
- Kanban board with drag-and-drop column and card reordering
- Task cards with priority, size, labels, stale indicators, and hover preview
- Tri-state grouped checklists (check / cross / unchecked) with status badges
- Task dependencies — blocker / blocked graphs with SVG overlay and connect mode
- Threaded comments per task
- Right-click context menus on tasks and columns
- Inline quick-add and full modal editing
- Filtering by text search, priority, label, column, and date range
- 20-entry undo stack with snapshot/rollback
- Optimistic UI with server reconciliation
- Virtual scrolling for dense columns (TanStack Virtual)

### Views
- **Gantt chart** — day / week / month scale, named saved views, swim-lane rows, progress bars
- **Canvas** — ReactFlow whiteboard with auto-layout (dagre), multiple node types, edge connections
- **Trophy room** — archive of completed work with stats, timeline, batch and auto-vault
- **Velocity** — throughput chart, cycle time card, heatmap grid, column flow

### Workspaces & Realms
- Multi-realm (workspace) support with custom icons and color picker
- Realm member roles (owner / member) with email invites (7-day token)
- Magic-link signup auto-resolves pending invites on first sign-in
- Scoped project visibility per realm (members-only toggle)
- Three project list views: SpaceView (canvas), TreeView (folders), GridView (cards)
- Sidebar hide / unhide per project and per realm (persisted)
- `1`–`9` keyboard shortcuts for realm switching

### Collaboration & Sharing
- Real-time board sync via Pusher with 30s polling fallback
- Read-only share links with snapshot data
- Project invites via Resend
- Contact autocomplete on the invite field
- Custom access-denied page (no raw 404s)

### Personalization
- 151 theme presets across 17 categories
- Saturation / brightness / vibrancy sliders
- 13 visual effects (starfield, sakura, snowfall, matrix, storm, aurora, cursor trails, …)
- 6 celebration categories on task completion (alien, business, fun, horror, medieval, …)
- Per-project theme override
- 8 customizable keyboard shortcuts
- Command palette (`Cmd+K`)
- In-app **Settings** modal: General, Dashboard, Palette, Effects, Typography, Fun, Shortcuts
- In-app **Help** modal for feature reference

### Auth & Security
- NextAuth v5 with three providers: Google OAuth, GitHub OAuth, Resend magic links
- Database session strategy (30-day max age, persistent across PWA restarts)
- Closed-beta allowlist with invite-based bypass
- Beta terms acceptance gate

### Mobile / Desktop
- PWA — installable on iOS / Android with manifest, service worker, offline fallback
- Capacitor mobile shell scripts (`cap:sync`, `cap:open`)
- Tauri desktop scaffold (parked until post-beta)

---

## Tech Stack

| Layer | Choice |
|---|---|
| **Framework** | Next.js 16 (App Router) + React 19 |
| **Database** | Postgres (Neon serverless) + Drizzle ORM 0.37 |
| **Auth** | NextAuth v5 beta (Auth.js) + `@auth/drizzle-adapter` |
| **State** | Zustand 5 (with `persist` middleware) |
| **Styling** | Tailwind CSS 3.4 + custom theme system |
| **Real-time** | Pusher + Pusher-JS |
| **Drag & Drop** | `@dnd-kit/core`, `@dnd-kit/sortable` |
| **Flow / Graphs** | `@xyflow/react` + `dagre` |
| **Virtual Scroll** | `@tanstack/react-virtual` |
| **Validation** | Zod 4 |
| **Email** | Resend |
| **Testing** | Vitest + Testing Library + fast-check (property tests) |
| **Compiler** | `babel-plugin-react-compiler` (React 19 compiler) |
| **MCP** | `@modelcontextprotocol/sdk` + `mcp-handler` |
| **Mobile** | Capacitor 8 (PWA bridge) |
| **Desktop** | Tauri 2 (scaffold only) |
| **Monorepo** | npm workspaces + Turborepo |

---

## Project Structure

```
shadow_app_aeon/
├── apps/
│   ├── web/              # Next.js 16 web app (primary)
│   └── desktop/          # Tauri desktop wrapper (post-beta)
├── packages/
│   └── shared/           # Shared types, themes, utilities
├── docs/                 # Reference docs
├── master_builder/       # Build orchestration scripts
├── master_plans/         # Planning documents
├── scripts/              # One-off tooling
├── shadow-specs/         # Spec workflow (draft → human_spec → ai_spec)
├── ARCHITECTURE.md       # Living architecture doc
├── VISION.md             # Strategic roadmap
├── turbo.json            # Turborepo config
└── README.md             # This file
```

### apps/web/src/

```
src/
├── app/                  # Next.js App Router routes
│   ├── api/v1/           # REST API surface (~40 routes)
│   ├── api/[transport]/  # MCP server surface (52 tools)
│   ├── dashboard/        # Main authenticated app shell
│   ├── project/          # Project-level pages
│   ├── invite/           # Realm invite acceptance
│   ├── login/            # Auth pages
│   ├── share/            # Public read-only share links
│   └── beta-terms/       # Beta terms gate
├── components/
│   ├── board/            # Kanban board UI
│   ├── project/          # Project list / cards
│   ├── workspace/        # Realm / workspace management
│   ├── sidebar/          # Navigation
│   ├── gantt/            # Gantt chart view
│   ├── canvas/           # Canvas / whiteboard view
│   ├── velocity/         # Velocity analytics
│   ├── trophy/           # Trophy room
│   ├── celebrations/     # Task completion effects
│   ├── effects/          # Background visual effects
│   ├── pwa/              # PWA install prompts
│   └── ui/               # Reusable primitives (modals, buttons, …)
├── lib/
│   ├── data/             # Pure DB access (Drizzle queries) — 22 modules
│   ├── actions/          # Server Actions ('use server') with auth guards
│   ├── store/            # Zustand stores (server-adjacent)
│   ├── db/               # Drizzle schema + client
│   ├── realtime/         # Pusher real-time helpers
│   ├── auth.ts           # NextAuth config
│   ├── email.ts          # Email sending (Resend)
│   └── utils/            # Shared utilities
├── stores/               # Top-level Zustand stores (client-side)
└── types/                # Shared TypeScript types
```

---

## How It Works

AEON has a **three-layer architecture** that keeps DB queries pure, business logic guarded, and the API surface mirrored across REST + MCP.

```
React component
      │
      ▼
Server Action  ─── auth guard (requireAuth / requireGroupOwner / …)
      │
      ▼
Data layer  ─── pure Drizzle queries, no auth, no side effects
      │
      ▼
Postgres (Neon)
                  ▲
MCP tool / REST route ──┘   (same data functions, parallel surfaces)
```

**Core entities (32 DB tables):**

- **Users / Accounts / Sessions** — accounts with three OAuth + magic link providers
- **Realms** (`workspace_groups` + `group_members`) — top-level shared workspaces
- **Projects** (`projects` + `project_members` + `project_invites`) — boards owned by a user, optionally shared into realms
- **Tasks** (`board_tasks`) — kanban cards with priority, size, labels, dependencies, checklists, comments
- **Gantt tasks** (`gantt_tasks` + `rows` + `gantt_views`) — timeline items linked to board tasks
- **Canvas** (`canvas_nodes` + `canvas_edges`) — ReactFlow whiteboard per project
- **Vault** (`task_vault`) — archived completed tasks with snapshot history
- **Supporting** — `activity_events`, `user_preferences`, `api_keys`, `board_snapshots`, `user_contacts`, `realm_invites`

**Data flow:**

```
Mutation
  ├─→ data layer writes to Postgres
  ├─→ touchProject() bumps board version
  ├─→ Pusher event → live update for other clients
  └─→ 30s polling fallback for clients without Pusher
```

For full architecture details — feature inventory, completion status, known gaps — see [`ARCHITECTURE.md`](./ARCHITECTURE.md). For strategic direction and roadmap, see [`VISION.md`](./VISION.md).

---

## Local Development

### Prerequisites

- **Node.js 20+**
- **npm 10+**
- **Postgres 15+** — optimized for [Neon](https://neon.tech/) serverless; local Postgres also works
- **Resend account** for magic-link email auth (or just use OAuth providers)
- (Optional) **Pusher account** for real-time sync

### First-time setup

```bash
git clone <repo-url> shadow_app_aeon
cd shadow_app_aeon
npm install
cp .env.example .env.local
# fill in .env.local — see env vars below
npm run -w apps/web db:push     # initialize schema
npm run -w apps/web dev         # start on http://localhost:3000
```

### Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string (Neon or local). Neon needs `?sslmode=require`. |
| `AUTH_SECRET` | ✅ | Random 32+ char secret. Generate: `openssl rand -base64 32` |
| `NEXTAUTH_URL` | ✅ | `http://localhost:3000` for local dev |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | one auth provider required | Google OAuth — callback `/api/auth/callback/google` |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | one auth provider required | GitHub OAuth — callback `/api/auth/callback/github` |
| `AUTH_RESEND_KEY` | recommended | Resend API key for magic-link email |
| `EMAIL_FROM` | recommended | Sender address, e.g. `Aeon <noreply@yourdomain.com>` |
| `ALLOWED_EMAILS` | optional | Comma-separated whitelist for closed beta. Empty = open registration. |
| `ADMIN_EMAILS` | optional | Comma-separated emails granted admin role on first sign-in |
| `AEON_API_KEY` / `AEON_API_USER_ID` | optional | Static API key for MCP server access |
| `PUSHER_APP_ID` / `PUSHER_KEY` / `PUSHER_SECRET` / `PUSHER_CLUSTER` | optional | Server-side Pusher creds for real-time |
| `NEXT_PUBLIC_PUSHER_KEY` / `NEXT_PUBLIC_PUSHER_CLUSTER` | optional | Client-side Pusher config (must match server-side) |

### Common scripts

| Command | Purpose |
|---|---|
| `npm run -w apps/web dev` | Start the Next.js dev server |
| `npm run -w apps/web build` | Production build |
| `npm run -w apps/web start` | Start production server |
| `npm run -w apps/web lint` | ESLint over `src/` |
| `npm run -w apps/web typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm run -w apps/web test` | Run Vitest unit tests once |
| `npm run -w apps/web test:watch` | Vitest in watch mode |
| `npm run -w apps/web db:push` | Push schema directly to DB (dev shortcut, no migration files) |
| `npm run -w apps/web db:generate` | Generate Drizzle migration files from schema |
| `npm run -w apps/web db:migrate` | Apply versioned migration files (production path) |
| `npm run -w apps/web db:studio` | Open Drizzle Studio in the browser |
| `npm run -w apps/web cap:sync` | Sync web build to Capacitor mobile shell |

### Database notes

- **Dev workflow:** use `db:push` — syncs schema directly without migration files
- **Production workflow:** use `db:generate` then `db:migrate` to apply versioned migrations
- 13 migration files exist in `apps/web/drizzle/` (`0000_…` through `0012_…`)
- Driver is `@neondatabase/serverless`; works with any standard Postgres URL

---

## API Surfaces

AEON exposes the same data through two parallel APIs:

### REST API (`/api/v1/`)

~40 routes across 5 resource groups:

- `projects/` — CRUD, columns, tasks, gantt, labels, dependencies, comments, batch ops
- `realms/` — CRUD, members, invites, project assignment
- `api-keys/` — create / revoke API keys for external clients
- `auth/` — mobile OAuth + magic-link verification flows
- `me/` — current user info

**Auth:** session cookie or `Authorization: Bearer <api_key>`. Rate-limited per user.

### MCP Server (`/api/[transport]/tools/`)

52 tools across 11 categories — designed for AI agents (Claude Code, Cursor, etc.):

- `list_projects`, `create_project`, `update_project`, `delete_project`
- `list_tasks`, `create_task`, `update_task`, `batch_create_tasks`
- `list_realms`, `invite_realm_member`, `cancel_realm_invite`, `resend_realm_invite`
- `list_gantt_tasks`, `create_gantt_task`, `update_gantt_task`
- `create_checklist_item`, `batch_create_checklist_items`, `update_checklist_item`
- … and more

**Auth:** `Authorization: Bearer <api_key>` only.

The MCP server makes AEON one of the few PM tools that an AI agent can drive end-to-end — create projects, move cards through columns, write checklists, watch real progress.

---

## Status

**Closed beta.** Live users. Active development on stability, mobile UX, and the AI-agent collaboration layer.

The board is built around a workflow that mixes human prioritization with AI execution — see the columns: `Mission Control → Raw Ideas → Analysis → PBI Queue → Bugs → In Dev → AI Review → Human Review → Done`. Cards flow through automatically when the AI dev workflow is enabled.

For development conventions, AI workflow rules, and standards, see the [`.claude/`](./.claude) directory (gitignored locally) for individual standards and workflow files.

---

## License

Private — closed beta. Contact the maintainer for access.
