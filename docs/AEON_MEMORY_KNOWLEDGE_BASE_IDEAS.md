# Aeon: Memory, Knowledge Base & Reporting — 10 Feature Ideas

> Completed work is the most valuable data you have.
> Every PM tool treats it as trash. Aeon treats it as treasure.

**Core philosophy**: With MCP, Claude isn't just reading project data — it's the one *doing* the work.
It can narrate, curate, and showcase its own output automatically. Nothing is lost. Everything compounds.

---

## The Anchors

### 1. Velocity DNA — Your Evolving Productivity Fingerprint

Every task state change gets logged to a `task_events` table. Over weeks and months, Aeon builds a unique fingerprint of *how you deliver*:

- Completion velocity curves by task type, label, priority
- "Burst vs. steady" work pattern detection
- Estimation accuracy score (planned dates vs actuals)
- Day/hour heat maps of when you're most productive

**MCP angle**: Claude already knows when it moves tasks through columns. It can self-report its own velocity too — *"I completed 14 tasks across 3 projects this week, averaging 4.2 minutes per task."* You get a split view: your velocity vs. Claude's velocity vs. combined.

**Data requirements**: New `task_events` table (task_id, event_type, from_state, to_state, timestamp, actor: 'user' | 'agent')

---

### 2. The Archive Constellation — Visual Knowledge Graph

Completed projects become stars in an interactive sky map:

- Cluster by labels, timeline overlap, or semantic similarity
- Zoom in to see every task, dependency, and outcome
- Zoom out for a strategic view of your entire history
- Each constellation node carries a richness score based on data density (tasks, subtasks, dependencies, timeline accuracy)
- Richer projects glow brighter — your constellation literally gets more impressive over time

**"Proof of Work" layer**: The constellation is a living portfolio. Every star is proof of something delivered.

**Data requirements**: Enriched `project_archives` table with computed metadata; optional embeddings for semantic clustering

---

### 3. The Replay Engine — Project Time Machine

Snapshot project state on every significant change. Play back any completed project as an animated story:

- Cards flowing through columns
- Gantt bars filling
- Dependencies resolving
- Progress bars advancing

**Claude Narration**: Since Claude did the work via MCP, it can annotate the replay: *"At this point I created 5 API endpoint tasks based on the spec. This blocker took 3 days to resolve because..."* The replay becomes a **narrated documentary** of the project, not just a silent animation.

**Data requirements**: `project_snapshots` table (project_id, snapshot_data JSONB, timestamp, trigger_event, agent_narration)

---

## The Revolutionary Reporting Play

### 4. Aeon Wrapped — Your Annual/Quarterly Showcase Deck

Forget boring reports. Think **Spotify Wrapped meets project management**:

- Auto-generated, beautifully designed scrollable web experience
- Animated stats: tasks completed, projects shipped, streaks, records broken
- *"Your busiest week was March 12th — you closed 47 tasks across 4 projects"*
- *"Your most complex project had 23 dependencies and you delivered 2 days early"*
- Personality archetypes: *"You're a Sprinter — 60% of your tasks complete in the final 20% of the timeline"*
- Shareable as a public link, embeddable, downloadable PDF

**Flex factor**: Post your Aeon Wrapped to LinkedIn/Twitter. It's your proof of output.

Quarterly mini-wraps build up to annual mega-wraps. Each one gets smarter as the data compounds.

---

## The Completed Work Showcase Ideas

### 5. The Trophy Case — Completed Card Gallery

This is the "Trello cards disappear" problem, solved beautifully:

- When a project completes (or when you archive it), every "Done" card gets preserved in a **Trophy Case** — a gorgeous gallery view
- Cards displayed as artifacts: title, description, labels, completion date, time-in-progress, dependencies it unblocked
- Filter by project, label, date range, priority
- Each card has a "story" auto-generated: *"Created March 3, moved to In Progress March 5, blocked by 'API auth' for 2 days, completed March 9"*

**MCP angle**: When Claude completes a task via MCP, it writes a one-line completion summary into the task's `metadata` field: *"Implemented JWT refresh token rotation with 15-minute expiry."* This happens automatically — zero effort from you, but every card in the Trophy Case has context.

**Data requirements**: Enhanced `metadata` JSONB on existing `boardTasks`; new `task_events` for story generation

---

### 6. Project Monuments — Rich Completion Artifacts

When a project reaches 100%, Aeon builds a **Monument** — a single, comprehensive artifact:

- Project timeline (planned vs actual) as a visual diff
- All tasks with their completion stories
- Dependency graph showing critical path
- Key stats: total tasks, on-time %, avg task duration, longest blocker
- Labels used, columns utilized, checklist completion rates
- Auto-generated executive summary (via Claude/MCP)

Monuments live in a dedicated **Hall of Monuments** — a portfolio page. Each one is a standalone, shareable page. It's a **case study generator**. You finish a project and immediately have a beautiful write-up of what was delivered.

**Data requirements**: `project_monuments` table (project_id, monument_data JSONB, executive_summary, stats, created_at); shareable via public URL

---

### 7. The Living Changelog — Auto-Generated Release Notes

Every completed task becomes a line item in an automatically maintained changelog:

- Grouped by project, sprint, or time period
- Categorized by label (feature, bugfix, improvement, etc.)
- Written in clean, professional language (Claude rewrites task titles into changelog entries via MCP)
- Exportable as markdown, HTML, or JSON

**Example output**:
```
## Week of March 9, 2026

### Project: Shadow App Aeon
- Added Gantt chart drag-to-resize functionality
- Fixed task dependency cycle detection edge case
- Improved Kanban column color theming system

### Project: Client Portal
- Implemented user invitation flow with email verification
- Added role-based dashboard filtering
```

Claude generates this *as it completes tasks* — by the time you're done, the changelog already exists.

**Data requirements**: `changelog_entries` table or generated on-the-fly from `task_events` + task metadata

---

### 8. Context Capsules — Preserving the "Why" Behind Every Task

The biggest loss when you delete completed cards isn't the *what* — it's the *why*. Context Capsules solve this:

- When Claude works on a task via MCP, it writes a structured context note: what problem this solved, what approach was taken, what alternatives were considered
- When a human completes a task, Aeon offers a lightweight "capsule" prompt: one sentence on what you learned or decided
- Capsules are searchable, taggable, and linked to their source task
- Start a new project and search capsules: *"What did we learn last time about auth?"* → instant institutional memory

**This is the knowledge base.** Not a wiki you have to maintain — a knowledge base that builds itself from the exhaust of doing actual work.

**Data requirements**: `context_capsules` table (task_id, project_id, problem, approach, alternatives, outcome, tags, searchable_text)

---

### 9. The Completion Ceremony — Making "Done" Feel Like Something

Right now, completing a task is nothing. A status change. Aeon should make it *mean something*:

- Task completes: subtle celebratory animation + the card "crystallizes" into the Trophy Case
- Project completes: full Monument generation with a summary screen
- Streak tracking: *"You've completed tasks 14 days in a row"*
- Milestone markers: *"This is your 100th completed task"* / *"5th project shipped"*
- Claude acknowledgment via MCP: *"Project complete. 34 tasks delivered across 3 weeks. Monument generated and added to your constellation."*

**The psychology matters.** If completion feels rewarding, you complete more. If completed work is showcased, you don't delete it.

**Data requirements**: `user_streaks` / `user_milestones` tables; frontend animation system; milestone detection logic

---

### 10. The MCP Memory Loop — Claude Remembers Everything It Built

The deepest idea. Since Claude operates on your projects via MCP, give it a **persistent memory layer**:

- New table: `agent_memories` — things Claude learned while working on your projects
- After completing a project, Claude writes a structured reflection: patterns noticed, decisions made, what worked, what didn't
- Next time Claude starts a new project, it queries its own memories: *"Based on 12 previous projects, I recommend starting with the auth layer — it's been a blocker in 8 of them"*
- Claude can reference specific past tasks: *"I built something similar in Project X, task #47. Here's the approach I used."*

**This is the killer feature**: Aeon becomes the system where your AI assistant builds **institutional knowledge about you and your work**. Every completed project makes Claude smarter about how *you* work, what *you* care about, and what patterns *your* projects follow.

**Data requirements**: `agent_memories` table (project_id, memory_type, content JSONB, tags, relevance_score, created_at)

---

## How They Layer Together

```
Complete a task
  → Trophy Case captures the card (#5)
  → Context Capsule preserves the "why" (#8)
  → Living Changelog gets a new entry (#7)
  → Velocity DNA updates your fingerprint (#1)
  → Completion Ceremony celebrates it (#9)

Complete a project
  → Monument gets built (#6)
  → Constellation gets a new star (#2)
  → Replay becomes available (#3)
  → Claude writes a memory reflection (#10)
  → Aeon Wrapped data compounds (#4)
```

Every single completion event feeds multiple systems simultaneously.
Nothing is lost. Everything compounds.

---

## Data Model Foundation

Most features share a small set of new tables:

| Table | Powers Ideas |
|-------|-------------|
| `task_events` (state change log) | 1, 3, 4, 5, 7, 9 |
| `project_archives` / `project_monuments` | 2, 3, 6 |
| `context_capsules` | 8 |
| `agent_memories` | 10 |
| `changelog_entries` | 7 |
| `user_milestones` / `user_streaks` | 4, 9 |

The existing JSONB `metadata` fields on `boardTasks` and `ganttTasks` can store completion summaries and context without schema changes. The existing MCP server is the integration point for all AI-powered features.

---

*Document created: March 2026*
*Status: Ideation / Scoping*
