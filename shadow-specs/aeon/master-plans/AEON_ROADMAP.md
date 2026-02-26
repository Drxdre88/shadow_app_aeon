# AEON Master Roadmap
> Last updated: 2026-02-26

## Completed
- Google OAuth (NextAuth v5, DB sessions in Neon PostgreSQL)
- Neon PostgreSQL connected via Drizzle ORM (9 tables: users, accounts, sessions, verificationTokens, projects, rows, ganttTasks, boardTasks, labels, taskLabels, checklistItems)
- Dashboard: Project CRUD, list, delete with confirmation
- Kanban Board: 4 columns (todo/doing/review/done), drag-drop via dnd-kit, task cards with priority/color/dates - fully DB persisted
- 6 Themes (Deep Space, Aurora, Ember, Midnight, Forest, Rose) + glow intensity slider + glass transparency slider + ambient blobs toggle
- GlassStage component: multi-layer glass background (panes, grain, grid, blobs, vignette, rim lighting, refraction)
- Demo mode (`/demo`), Landing page (`/`), Login page (`/login`)
- Drag effects picker (Aurora Glow, Ghost Trail, Lightning)
- GlowCard with glassmorphism (backdrop-blur, edge highlights, depth shadows)
- NeonButton with glow variants
- ThemeSelector with full settings panel

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Framework | Next.js ~16 (App Router, Server Actions) |
| Language | TypeScript 5.7 |
| Runtime | React 19.0.0 |
| Styling | Tailwind CSS 3.4 |
| Animation | Framer Motion 11.15 |
| State | Zustand 5.0 with persist middleware |
| DnD | @dnd-kit/core + @dnd-kit/sortable |
| Auth | next-auth v5.0.0-beta.30 |
| ORM | Drizzle ORM 0.37 |
| DB | Neon PostgreSQL (serverless) |
| Icons | Lucide React |
| Date utils | date-fns 4.1 |

---

## Phase 1: Close the Gaps (CRITICAL - do first)
1. **Fix middleware** - `proxy.ts` → `middleware.ts` (auth route protection may not be executing)
2. **Wire Gantt to DB** - create `src/lib/actions/gantt.ts` server actions (follow board.ts pattern exactly)
3. **Wire Labels end-to-end** - server actions to load/save from task_labels + labels tables (schema exists, UI renders them, just no data flow)
4. **Integrate orphaned components** - QuickAddTask into KanbanColumn, TaskChecklist into TaskCard (both built, neither rendered)
5. **Loading skeletons + error states** - Neon cold-start can be 2-5s, needs UX treatment

## Phase 2: SOTA Trello-Style Features
1. **Swimlanes** - group by assignee, priority, label with collapsible rows
2. **Card covers** - image/color headers on task cards
3. **Activity feed** - per-card comment/history timeline with timestamps
4. **Filters & search** - real-time board filtering by label, priority, assignee, date range
5. **Board templates** - pre-built project templates (Sprint, Kanban, Bug Triage)
6. **Card dependencies** - "blocked by" links between cards with visual chain indicators
7. **WIP limits** - column capacity limits with visual warnings when exceeded
8. **Multi-select bulk ops** - select multiple cards, batch move/label/delete/archive

## Phase 3: Revolutionary Gantt
1. **Dependency arrows** - finish-to-start, start-to-start, finish-to-finish with SVG path rendering
2. **Critical path highlighting** - auto-detect and glow the critical path through the project
3. **Resource allocation view** - who's overloaded, capacity heatmap per row/person
4. **Baseline comparison** - ghost bars showing original plan vs actual progress
5. **Auto-scheduling** - drag one task, all dependents cascade automatically
6. **Milestone diamonds** - key dates rendered as diamond markers on timeline
7. **Zoom levels** - hour/day/week/month/quarter with smooth animated transitions
8. **Gantt <-> Board sync** - drag a board task onto the timeline, changes reflect bidirectionally

## Phase 4: AI Plugin Architecture
1. **REST API routes** - `/api/projects`, `/api/tasks`, `/api/gantt` for external integrations
2. **MCP Server integration** - expose project/task CRUD as MCP tools so Claude Code can directly manage AEON
3. **Claude Code Skill** - `/aeon` skill to query project state, create tasks, generate sprint plans from natural language
4. **AI Sprint Planner** - "I need to build feature X" → auto-generates board tasks + gantt timeline with estimates
5. **Smart task decomposition** - paste a requirement, AI breaks it into subtasks with checklist items
6. **Natural language filters** - "show me all overdue tasks assigned to me" → instant board/gantt filter
7. **Webhook system** - fire events on task state changes for CI/CD triggers and external notifications
8. **AI retrospective** - analyze completed sprint data, generate insights on velocity, bottleneck patterns, team capacity

---

## Strategic Execution Order
**Phase 1 → Phase 4 (items 1-3) → Phase 2 → Phase 3 → Phase 4 (items 4-8)**

Rationale:
- Phase 1 closes critical functional gaps (security, data persistence)
- Phase 4 items 1-3 (API + MCP + Skill) early because:
  - REST API forces clean data layer separation that makes all UI features easier to build
  - MCP + Claude Code skill = dogfooding AEON from terminal while building it
  - External API unlocks automation and third-party integrations immediately
- Phase 2/3 are UI-heavy feature work that benefits from the clean API layer underneath
- Phase 4 items 4-8 are AI-powered features that build on top of everything else

## Known Issues & Warnings
- `proxy.ts` naming: Next.js only auto-discovers `middleware.ts` - route protection may not be running
- `next-auth@5.0.0-beta.30` is unstable beta - export patterns will break on v4
- Board store in localStorage grows unbounded (all projects in one key, never evicted)
- Gantt fully disconnected from DB (Zustand/localStorage only) - new device = empty gantt
- Labels always render empty (no server actions connect to DB)
- No error boundaries - server action failures log to console only
