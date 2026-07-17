# Architecture — Data Layer

> Part of the Aeon architecture set — index: [../ARCHITECTURE.md](../ARCHITECTURE.md)

**ORM:** Drizzle ORM with `@neondatabase/serverless` driver.
**Schema file:** `apps/web/src/lib/db/schema.ts` (~691 lines).
**Migrations:** `apps/web/drizzle/` — through **`0026_favorite_projects.sql`**. Recent: `0023_memory_embeddings` (pgvector 1024-dim `embedding` + HNSW cosine index, raw SQL like `fts`), `0024_memory_provenance` (`confidence`, `superseded_at`, `superseded_by_id`), **`0025_memory_valid_time`** (bi-temporal `valid_at`/`invalid_at` — when a claim was true in the WORLD, vs supersededAt = when we LEARNED it changed), **`0026_favorite_projects`**. (`0009`/`0010` are preexisting duplicate-numbered pairs, not an error.)

| Table | Key Columns | Purpose |
|---|---|---|
| `users` | id, email, role, termsAcceptedAt | Auth identity; `role` gates beta + admin-only AI features |
| `accounts` | (provider, providerAccountId) | OAuth tokens (Google, GitHub) |
| `sessions` | sessionToken, userId | NextAuth web sessions |
| `verificationTokens` | (identifier, token) | Magic-link tokens |
| `projects` | id, userId, dominionId, settings, boardVersion | Project; `dominionId` FK added in 0016 |
| `projectMembers` | (projectId, userId), role | Per-project ACL |
| `projectInvites` | token, email, expiresAt | Email-based invitations |
| `workspaceGroups` | id, ownerId, isPersonal, settings | Realms; partial unique index — one personal realm per user |
| `groupMembers` | (groupId, userId), role | Realm membership |
| `projectGroups` | (projectId, groupId), visibility | Project ↔ realm |
| `realmInvites` | token, email, groupId, expiresAt | 7-day realm invites |
| `boardColumns` | id, projectId, orderIndex | Kanban columns |
| `boardTasks` | id, columnId, ganttTaskId, metadata, archivedAt, completedAt | Cards; bidirectional FK to `ganttTasks` |
| `labels` / `taskLabels` | projectId, color / (taskId, labelId) | Tags and joins |
| `taskDependencies` | (blockerTaskId, blockedTaskId) | Blocker/blocked edges |
| `checklistItems` | id, taskId, state, groupName, orderIndex | Tri-state grouped checklists |
| `ganttViews` / `rows` / `ganttTasks` | id, projectId, … | Saved views, swimlanes, bars |
| `canvasNodes` / `canvasEdges` | id, projectId, … | Whiteboard |
| `taskVault` | id, originalTaskId, labelSnapshot, checklistSnapshot | Archived snapshot store |
| `taskComments` | id, taskId, userId, content | Threaded comments |
| `boardSnapshots` | token, snapshot, expiresAt | Public share links |
| `activityEvents` | entityType, action, actorType ∈ {user, agent}, metadata | Audit trail |
| `userPreferences` | userId, preferences (jsonb) | Theme + UI settings blob |
| `apiKeys` | keyPrefix, keyHash, revokedAt | REST/MCP keys (`aeon_k1_`) |
| `userContacts` | userId, contactEmail | Invite autocomplete |
| `mobileLoginTokens` / `mobileSessions` | tokenHash, expiresAt | Mobile login tokens (10-min, single-use) + bearer sessions (`aeon_s1_…`, 90-day; minted by `/api/v1/auth/mobile/*`, verified via `lib/api/auth.ts#verifyMobileSession`) |
| `memories` | userId, dominionId, realmId, projectId, taskId, aiTitle, execSummary jsonb, type, streamClass, source, sourceMetadata, tags, pinned, **embedding (vector 1024)**, **embeddingModel**, **confidence (real)**, **supersededAt**, **supersededById**, **validAt (NOT NULL, defaultNow)**, **invalidAt (nullable)**, archivedAt | Kairos memory nodes — the single substrate for nearly all brain features. FTS (`tsvector`+GIN, 0013) + pgvector HNSW (0023) + provenance/trust (0024) + **bi-temporal validity (0025: validAt/invalidAt = world-time, supersededAt = learn-time; read path = `getBeliefTrail` → MCP `get_belief_trail`)**. `streamClass` spans: `idea`, `agentic`, `execution`, `reflection`, `cortex`, `archetype`, `advisory`, `trace`, `snapshot`, `aether`. `type` discriminates feature rows (`note`, `aether`, `dominion_cortex`, `inbound`, …) |
| `favoriteProjects` | (userId, projectId) composite PK, cascade FKs | Per-user project stars (PR #80, migration 0026); surfaces the dashboard Favorites section; mirrored MCP `set_project_favorite` + REST `PUT /projects/[id]/favorite` |
| `dominions` | id, userId, name, color, icon, sortOrder, vision, missionLong, archivedAt | Kairos top-level grouping above project; standing context for Briefer |
| `dominionObjectives` | dominionId, title, status, targetDate, sortOrder | Concrete goals; Briefer reads open ones |
| `dominionRepos` | (dominionId, repoSlug) | Repo-slug → Dominion mapping for auto-resolution |
| `userAiCredentials` | userId, provider, ciphertext, iv, authTag, keyHint, revokedAt | AES-256-GCM BYOK keys; one active key per (userId, provider) |
| `userAiPreferences` | userId, {cheap,standard,heavy}{ProviderId,ModelId} | Three-tier model routing per user |
| `enginePolicies` | userId (nullable=global), taskType, sensitivity, urgency, providerId, modelId, tier, priority | Engine Router rows; falls back to `DEFAULT_POLICIES` |
| `agentSessions` | userId, dominionId, engine, repo, branch, goal, prompt, status, workerHost, workerPid, costUsd numeric(10,4), memoryId, exitCode, metadata jsonb | Spawn primitive + **all threaded conversations**. `engine` discriminates: `kairos-chat` (chat threads), `kairos-dialogue` (multi-turn operator↔Kairos), real spawned agents |
| `sessionEvents` | sessionId, seq (unique per session), kind, toolName, payload jsonb | Monotonic event timeline; replay-idempotent. Also holds chat messages (`kind='message'`) + dialogue turns (`operator`/`kairos`) |
| `taskAssignees` | (taskId, userId), assignedBy, assignedAt | Trello-style multi-assign |
| `oauthClients` | id (=client_id), redirectUris jsonb, clientName | OAuth 2.1 DCR (RFC 7591); no client secret |
| `oauthAuthCodes` | codeHash, clientId, userId, redirectUri, codeChallenge, scope, usedAt, expiresAt | Single-use PKCE auth codes; 10-min TTL |
| `oauthAccessTokens` | tokenHash, tokenPrefix, refreshHash, clientId, userId, scope, expiresAt, refreshExpiresAt, revokedAt, lastUsedAt | Bearer (`aeon_at_`, 30d) + refresh (`aeon_rt_`, 1y rotated); `lastUsedAt` write throttled to 1/60s |

**Aether / Asks / Dialogue / Reflections / Traces have NO dedicated tables** — they all reuse existing storage:
- **Aether** → `memories` rows `type='aether'`/`streamClass='aether'`; payload on `sourceMetadata.aether` (`lib/data/aether.ts`).
- **Kairos Ask** → `memories` carrying `sourceMetadata.kairosAsk` (`lib/kairos/ask.ts`, `lib/data/ask.ts`).
- **Kairos Dialogue** → `agentSessions` (`engine='kairos-dialogue'`) + `sessionEvents` turns (`lib/data/dialogue.ts`).
- **Reflections** → `memories` `streamClass='reflection'` (via `captureReflection`).
- **Recipe traces** → `memories` `streamClass='trace'` (`lib/data/recipes.ts`).

**Three-layer invariant:** `lib/data/` (pure queries) → `lib/actions/` (auth-guarded server actions) → API surfaces (REST `/api/v1`, MCP `/api/[transport]`, OAuth). All board mutations call `touchProject()` to bump `boardVersion`. `verifyProjectAccess()` resolves direct membership, ownership, and realm membership in 1–2 queries. Dominion resolution: `memory.dominionId` ?? `project.dominionId` ?? `dominionRepos` via `sourceMetadata.repo` ?? null. Forward-referenced FKs use `AnyPgColumn` to avoid Drizzle circular imports.

**`lib/data/` modules (35 files + `__tests__/`):** `activity`, `aether`, `ai-credentials`, `api-keys`, `ask`, `assignees`, `bridge`, `canvas`, `checklist`, `columns`, `comments`, `contacts`, `dependencies`, `dialogue`, `dominions`, `gantt`, `ganttViews`, `kairos-chat`, `kairos-chat-payload`, `labels`, `members`, `memories` (incl. `captureReflection`, `acceptProposal`, `backfillEmbeddings`, `dedupMemories`, `prepareContext`), `memoriesMarkdown`, `mobile-auth`, `oauth`, `preferences`, `projects`, `recipes`, `sessions`, `storage`, `tasks`, `validators`, `vault`, `velocity`, `workspaces`.

**DB driver (reliability):** `lib/db/index.ts` Pool — `max: 20`, `connectionTimeoutMillis: 8000`. The 8s acquire is deliberately kept **below** the v1 route `maxDuration` (30s): if a connection wait outlives the function budget, Vercel hard-kills the function mid-await and Next logs "No response is returned from route handler" (no throw to catch). 8s acquire → `apiHandler` try/catch returns a clean 503. `max:20` is safe on the `-pooler` (PgBouncer) endpoint.
