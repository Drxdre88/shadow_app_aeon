# Aeon Brain — Schema

**Phase 1 scope.** One new table (`memories`), one new index, one new migration. No changes to existing tables.

---

## `memories` table

```sql
CREATE TABLE memories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- optional anchors (memory can float free or attach to anything)
  realm_id      uuid REFERENCES workspace_groups(id) ON DELETE SET NULL,
  project_id    uuid REFERENCES projects(id) ON DELETE SET NULL,
  task_id       uuid REFERENCES board_tasks(id) ON DELETE SET NULL,

  -- content
  title         varchar(255) NOT NULL,
  body_md       text NOT NULL,                       -- canonical markdown body
  summary       text,                                -- one-line compression for context packing
  type          varchar(30) NOT NULL DEFAULT 'note', -- note | decision | idea | observation | session_summary | reflection
  source        varchar(20) NOT NULL DEFAULT 'manual', -- manual | claude | voice | hook | import

  -- structured sidecar
  source_metadata jsonb NOT NULL DEFAULT '{}',       -- e.g. {repo, branch, sessionId, filesTouched, commits[]}
  links           jsonb NOT NULL DEFAULT '[]',       -- typed hyperedges; see below
  tags            jsonb NOT NULL DEFAULT '[]',       -- free-form string array

  -- full-text search (generated column, see index below)
  fts             tsvector GENERATED ALWAYS AS (
                    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
                    setweight(to_tsvector('english', coalesce(body_md, '')), 'C')
                  ) STORED,

  -- soft lifecycle
  pinned        boolean NOT NULL DEFAULT false,
  archived_at   timestamp,
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX memories_user_idx       ON memories(user_id, created_at);
CREATE INDEX memories_realm_idx      ON memories(realm_id);
CREATE INDEX memories_project_idx    ON memories(project_id);
CREATE INDEX memories_task_idx       ON memories(task_id);
CREATE INDEX memories_type_idx       ON memories(user_id, type);
CREATE INDEX memories_fts_idx        ON memories USING GIN (fts);
CREATE INDEX memories_tags_idx       ON memories USING GIN (tags jsonb_path_ops);
```

### Column rationale

| Column | Why it exists |
|---|---|
| `user_id` (required) | Memories are personal first. A memory can link to a realm/project, but it is owned by a user. This is the critical difference from `taskComments` (project-scoped). |
| `realm_id` / `project_id` / `task_id` (all nullable) | Optional anchors. A "freeform thought about pricing strategy" floats free; a "session summary for fix #123" attaches to a task. Cascade rules use `SET NULL` so deleting a project does not destroy memories — they just float free. |
| `body_md` (text, not varchar) | Markdown body. No length cap. Memories can be a sentence or a 5-page reflection. |
| `summary` (text, nullable) | One-line compression. Used by `prepare_context()` (Phase 4) to pack many memories into a small token budget without re-summarising at query time. Filled by Claude on creation if `body_md` exceeds ~200 chars. |
| `type` | Six fixed values let us route in the UI and via MCP filters. Not an enum (cheaper migrations) — kept as `varchar(30)` with Zod validation at the action layer. |
| `source` | Tells us *how* the memory got here. Critical for trust/curation later. `claude` = a session-capture; `voice` = STT dictation; `hook` = automated import; `manual` = the user typed it. |
| `source_metadata jsonb` | Provenance. `claude` source carries `{repo, branch, sessionId, filesTouched[], commits[]}`. `voice` carries audio length. `hook` carries hook name. Schema-less because each source has different shape. |
| `links jsonb` | Typed hyperedges. Array of `{type, target, target_kind, note?}`. See "Links schema" below. Keeps the graph in the row, not in a separate table — fine until we exceed ~50 edges/memory or want to query "all memories pointing at X" hot path (then we extract to a join table in Phase 3+). |
| `tags jsonb` | Free-form labels. GIN-indexed for `?` containment search. Distinct from `labels` (project-scoped) — these are personal cross-cutting categories. |
| `fts` (generated) | Postgres' built-in full-text index. Weighted: title > summary > body. Generated column means we never have to remember to recompute. GIN index makes search milliseconds at 10k+ rows. |
| `pinned` | UI surface for the daily-briefing "always include these" set. |
| `archived_at` | Soft delete. Memories never truly disappear (the `Stop`-hook would re-create them). |

### Links schema (jsonb shape)

```ts
type MemoryLink = {
  type: 'relates' | 'supports' | 'contradicts' | 'supersedes' | 'refers_to' | 'blocks_thinking'
  target: string                                // uuid
  target_kind: 'memory' | 'task' | 'project' | 'realm' | 'url'
  note?: string                                 // optional one-liner on the edge
}
```

Stored on the *source* memory only — edges are one-directional in storage, but the API treats them as bidirectional for graph walks (`get_memory_with_neighbours` joins both directions via a query that unnests `links` and unions with reverse lookups).

This mirrors the typed-edge pattern we will later extend `canvasEdges` with in Phase 3, so promoting a memory to canvas is a structural translation, not a re-design.

---

## How it slots into the existing schema

```
users ──┬── memories (user_id, NOT NULL)
        │       │
        │       ├── realm_id   ──> workspace_groups (optional anchor)
        │       ├── project_id ──> projects        (optional anchor)
        │       ├── task_id    ──> board_tasks     (optional anchor)
        │       └── links[]    ──> any of memory|task|project|realm|url
        │
        ├── projects (existing)
        ├── workspace_groups (existing)
        └── board_tasks (existing)
```

No existing table is modified in Phase 1. `canvasEdges` is touched in Phase 3 (add `edge_type` and allow `source_node_kind`/`target_node_kind` to reference memories). `pgvector` extension is enabled in Phase 6 if/when needed and adds a single nullable `embedding vector(1536)` column behind a feature flag.

---

## Drizzle schema additions

Append to `apps/web/src/lib/db/schema.ts`:

```ts
export const memories = pgTable('memories', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  realmId: uuid('realm_id').references(() => workspaceGroups.id, { onDelete: 'set null' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  taskId: uuid('task_id').references(() => boardTasks.id, { onDelete: 'set null' }),

  title: varchar('title', { length: 255 }).notNull(),
  bodyMd: text('body_md').notNull(),
  summary: text('summary'),
  type: varchar('type', { length: 30 }).default('note').notNull(),
  source: varchar('source', { length: 20 }).default('manual').notNull(),

  sourceMetadata: jsonb('source_metadata').default({}).notNull(),
  links: jsonb('links').default([]).notNull(),
  tags: jsonb('tags').default([]).notNull(),

  pinned: boolean('pinned').default(false).notNull(),
  archivedAt: timestamp('archived_at', { mode: 'date' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: index('memories_user_idx').on(t.userId, t.createdAt),
  realmIdx: index('memories_realm_idx').on(t.realmId),
  projectIdx: index('memories_project_idx').on(t.projectId),
  taskIdx: index('memories_task_idx').on(t.taskId),
  typeIdx: index('memories_type_idx').on(t.userId, t.type),
}))

export type Memory = typeof memories.$inferSelect
```

The `tsvector` column and GIN indexes ship via raw SQL in the migration file — Drizzle does not yet generate them cleanly. See `apps/web/drizzle/00XX_brain_memories.sql` (TBD migration number).

---

## Performance budget

| Operation | Target | Why it holds |
|---|---|---|
| `create_memory` | < 50ms p95 | Single insert, no embeddings, no FK lookups beyond user |
| `search_memories(q, limit=20)` | < 100ms p95 at 10k rows | GIN FTS index + LIMIT; Postgres FTS scales linearly with result size, not corpus |
| `get_memory_with_neighbours(id, hops=2)` | < 150ms p95 | Two recursive CTE hops over `links` jsonb |
| Markdown export of 10k memories | < 5s | Streamed write, no transformation beyond YAML serialisation |

These leave ~5x headroom before vectors become necessary.
