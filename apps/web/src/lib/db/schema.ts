import { pgTable, uuid, varchar, text, timestamp, integer, boolean, jsonb, primaryKey, real, numeric, uniqueIndex, index, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }),
  email: varchar('email', { length: 255 }).unique().notNull(),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image: text('image'),
  role: varchar('role', { length: 20 }).default('user').notNull(),
  termsAcceptedAt: timestamp('terms_accepted_at', { mode: 'date' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const accounts = pgTable('accounts', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 255 }).notNull(),
  provider: varchar('provider', { length: 255 }).notNull(),
  providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
  refresh_token: text('refresh_token'),
  access_token: text('access_token'),
  expires_at: integer('expires_at'),
  token_type: varchar('token_type', { length: 255 }),
  scope: varchar('scope', { length: 255 }),
  id_token: text('id_token'),
  session_state: varchar('session_state', { length: 255 }),
}, (account) => ({
  compoundKey: primaryKey({ columns: [account.provider, account.providerAccountId] }),
}))

export const sessions = pgTable('sessions', {
  sessionToken: varchar('session_token', { length: 255 }).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
})

export const verificationTokens = pgTable('verification_tokens', {
  identifier: varchar('identifier', { length: 255 }).notNull(),
  token: varchar('token', { length: 255 }).notNull(),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
}, (vt) => ({
  compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
}))

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // Kairos Dominion grouping (forward reference — dominions table defined
  // later in this file). On delete: set null so projects aren't lost when
  // a Dominion is removed.
  dominionId: uuid('dominion_id').references((): AnyPgColumn => dominions.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  timeScale: varchar('time_scale', { length: 20 }).default('week').notNull(),
  startDate: timestamp('start_date', { mode: 'date' }).notNull(),
  endDate: timestamp('end_date', { mode: 'date' }).notNull(),
  settings: jsonb('settings').default({}).notNull(),
  group: text('group'),
  planetImage: varchar('planet_image', { length: 255 }),
  boardVersion: integer('board_version').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const projectMembers = pgTable('project_members', {
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).default('editor').notNull(),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (pm) => ({
  pk: primaryKey({ columns: [pm.projectId, pm.userId] }),
}))

export const projectInvites = pgTable('project_invites', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  role: varchar('role', { length: 20 }).default('editor').notNull(),
  invitedBy: uuid('invited_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 64 }).notNull().unique(),
  acceptedAt: timestamp('accepted_at', { mode: 'date' }),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const workspaceGroups = pgTable('workspace_groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  icon: varchar('icon', { length: 50 }),
  color: varchar('color', { length: 20 }).default('purple').notNull(),
  isPersonal: boolean('is_personal').default(false).notNull(),
  settings: jsonb('settings').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  personalPerUser: uniqueIndex('workspace_groups_personal_per_user').on(table.ownerId).where(sql`is_personal = true`),
}))

export const groupMembers = pgTable('group_members', {
  groupId: uuid('group_id').notNull().references(() => workspaceGroups.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).default('editor').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (gm) => ({
  pk: primaryKey({ columns: [gm.groupId, gm.userId] }),
}))

export const projectGroups = pgTable('project_groups', {
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').notNull().references(() => workspaceGroups.id, { onDelete: 'cascade' }),
  addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
  visibility: varchar('visibility', { length: 20 }).default('all').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (pg) => ({
  pk: primaryKey({ columns: [pg.projectId, pg.groupId] }),
}))

export const realmInvites = pgTable('realm_invites', {
  id: uuid('id').defaultRandom().primaryKey(),
  groupId: uuid('group_id').notNull().references(() => workspaceGroups.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  role: varchar('role', { length: 20 }).default('editor').notNull(),
  invitedBy: uuid('invited_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 64 }).notNull().unique(),
  acceptedAt: timestamp('accepted_at', { mode: 'date' }),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const ganttViews = pgTable('gantt_views', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  groupBy: varchar('group_by', { length: 20 }).default('column').notNull(),
  filters: jsonb('filters').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const rows = pgTable('rows', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  ganttViewId: uuid('gantt_view_id').references(() => ganttViews.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  color: varchar('color', { length: 20 }).default('purple').notNull(),
  orderIndex: integer('order_index').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const ganttTasks = pgTable('gantt_tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  rowId: uuid('row_id').references(() => rows.id, { onDelete: 'set null' }),
  boardTaskId: uuid('board_task_id').references((): AnyPgColumn => boardTasks.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  startDate: timestamp('start_date', { mode: 'date' }).notNull(),
  endDate: timestamp('end_date', { mode: 'date' }).notNull(),
  color: varchar('color', { length: 20 }).default('purple').notNull(),
  progress: integer('progress').default(0).notNull(),
  metadata: jsonb('metadata').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const boardColumns = pgTable('board_columns', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  color: varchar('color', { length: 20 }).default('purple').notNull(),
  icon: varchar('icon', { length: 50 }),
  orderIndex: integer('order_index').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const boardTasks = pgTable('board_tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  columnId: uuid('column_id').references(() => boardColumns.id, { onDelete: 'set null' }),
  ganttTaskId: uuid('gantt_task_id').references(() => ganttTasks.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 20 }).default('todo').notNull(),
  priority: varchar('priority', { length: 20 }).default('medium').notNull(),
  color: varchar('color', { length: 20 }).default('purple').notNull(),
  startDate: timestamp('start_date', { mode: 'date' }),
  endDate: timestamp('end_date', { mode: 'date' }),
  onTimeline: boolean('on_timeline').default(false).notNull(),
  size: real('size'),
  orderIndex: integer('order_index').notNull(),
  metadata: jsonb('metadata').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at', { mode: 'date' }),
  archivedAt: timestamp('archived_at', { mode: 'date' }),
})

export const labels = pgTable('labels', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  color: varchar('color', { length: 20 }).default('purple').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const taskLabels = pgTable('task_labels', {
  taskId: uuid('task_id').notNull().references(() => boardTasks.id, { onDelete: 'cascade' }),
  labelId: uuid('label_id').notNull().references(() => labels.id, { onDelete: 'cascade' }),
}, (tl) => ({
  pk: primaryKey({ columns: [tl.taskId, tl.labelId] }),
}))

export const taskDependencies = pgTable('task_dependencies', {
  blockerTaskId: uuid('blocker_task_id').notNull().references(() => boardTasks.id, { onDelete: 'cascade' }),
  blockedTaskId: uuid('blocked_task_id').notNull().references(() => boardTasks.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (td) => ({
  pk: primaryKey({ columns: [td.blockerTaskId, td.blockedTaskId] }),
}))

export const checklistItems = pgTable('checklist_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  taskId: uuid('task_id').notNull().references(() => boardTasks.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  completed: boolean('completed').default(false).notNull(),
  state: varchar('state', { length: 20 }).default('unchecked').notNull(),
  status: varchar('status', { length: 30 }),
  groupName: varchar('group_name', { length: 100 }).default('Checklist').notNull(),
  startDate: timestamp('start_date', { mode: 'date' }),
  endDate: timestamp('end_date', { mode: 'date' }),
  orderIndex: integer('order_index').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const canvasNodes = pgTable('canvas_nodes', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 50 }).default('idea').notNull(),
  positionX: integer('position_x').notNull(),
  positionY: integer('position_y').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  color: varchar('color', { length: 20 }).default('purple').notNull(),
  metadata: jsonb('metadata').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  preferences: jsonb('preferences').default({}).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
  keyHash: varchar('key_hash', { length: 64 }).notNull(),
  lastUsedAt: timestamp('last_used_at', { mode: 'date' }),
  revokedAt: timestamp('revoked_at', { mode: 'date' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const userAiCredentials = pgTable('user_ai_credentials', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 32 }).notNull(),
  label: varchar('label', { length: 100 }).notNull(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  keyHint: varchar('key_hint', { length: 16 }),
  lastUsedAt: timestamp('last_used_at', { mode: 'date' }),
  revokedAt: timestamp('revoked_at', { mode: 'date' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  uniqUserProvider: uniqueIndex('user_ai_creds_user_provider_active')
    .on(t.userId, t.provider)
    .where(sql`revoked_at IS NULL`),
}))

export const userAiPreferences = pgTable('user_ai_preferences', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  cheapProviderId: varchar('cheap_provider_id', { length: 32 }).default('anthropic').notNull(),
  cheapModelId: varchar('cheap_model_id', { length: 64 }).default('claude-haiku-4-5-20251001').notNull(),
  standardProviderId: varchar('standard_provider_id', { length: 32 }).default('anthropic').notNull(),
  standardModelId: varchar('standard_model_id', { length: 64 }).default('claude-sonnet-4-6').notNull(),
  heavyProviderId: varchar('heavy_provider_id', { length: 32 }).default('anthropic').notNull(),
  heavyModelId: varchar('heavy_model_id', { length: 64 }).default('claude-opus-4-7').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const canvasEdges = pgTable('canvas_edges', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  sourceNodeId: uuid('source_node_id').notNull().references(() => canvasNodes.id, { onDelete: 'cascade' }),
  targetNodeId: uuid('target_node_id').notNull().references(() => canvasNodes.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 255 }),
  animated: boolean('animated').default(false).notNull(),
  metadata: jsonb('metadata').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const activityEvents = pgTable('activity_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  entityType: varchar('entity_type', { length: 30 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  action: varchar('action', { length: 30 }).notNull(),
  entityName: varchar('entity_name', { length: 255 }),
  metadata: jsonb('metadata').default({}).notNull(),
  actorId: varchar('actor_id', { length: 255 }),
  actorType: varchar('actor_type', { length: 10 }).default('user').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const taskVault = pgTable('task_vault', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  originalTaskId: uuid('original_task_id'),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  priority: varchar('priority', { length: 20 }).default('medium').notNull(),
  color: varchar('color', { length: 20 }).default('purple').notNull(),
  columnName: varchar('column_name', { length: 255 }),
  size: real('size'),
  daysTaken: integer('days_taken'),
  labelSnapshot: jsonb('label_snapshot').default([]).notNull(),
  checklistSnapshot: jsonb('checklist_snapshot').default({}).notNull(),
  metadata: jsonb('metadata').default({}).notNull(),
  archivedAt: timestamp('archived_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  originalCreatedAt: timestamp('original_created_at').notNull(),
})

export const taskComments = pgTable('task_comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  taskId: uuid('task_id').notNull().references(() => boardTasks.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const boardSnapshots = pgTable('board_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 64 }).notNull().unique(),
  projectName: varchar('project_name', { length: 255 }).notNull(),
  snapshot: jsonb('snapshot').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const userContacts = pgTable('user_contacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  contactEmail: varchar('contact_email', { length: 255 }).notNull(),
  contactUserId: uuid('contact_user_id').references(() => users.id, { onDelete: 'set null' }),
  displayName: varchar('display_name', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userEmailUniq: uniqueIndex('user_contacts_user_email_uniq').on(table.userId, table.contactEmail),
}))

export const mobileLoginTokens = pgTable('mobile_login_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  callbackUrl: text('callback_url').notNull(),
  usedAt: timestamp('used_at', { mode: 'date' }),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const mobileSessions = pgTable('mobile_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Brain Phase 1 — user-scoped memory substrate. See docs/brain/01-schema.md.
// The `fts` tsvector generated column and the GIN indexes (memories_fts_idx,
// memories_tags_idx) are NOT modelled here — they live in the raw SQL
// migration 0013_brain_memories.sql because Drizzle cannot yet express
// weighted tsvector generated columns. db:push leaves them alone if present.
export const memories = pgTable('memories', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  realmId: uuid('realm_id').references(() => workspaceGroups.id, { onDelete: 'set null' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  taskId: uuid('task_id').references(() => boardTasks.id, { onDelete: 'set null' }),
  // Kairos Dominion grouping — optional direct anchor. If null, the display
  // layer resolves via project.dominionId, then via sourceMetadata.repo →
  // dominionRepos, then "Unassigned".
  dominionId: uuid('dominion_id').references((): AnyPgColumn => dominions.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 255 }).notNull(),
  // AI-generated short title (1–6 words). Falls back to `title` when null.
  aiTitle: varchar('ai_title', { length: 120 }),
  bodyMd: text('body_md').notNull(),
  summary: text('summary'),
  // AI-generated 5–10 bullet point exec summary. Front-of-house display.
  // Empty array until generation runs.
  execSummary: jsonb('exec_summary').default([]).notNull(),
  type: varchar('type', { length: 30 }).default('note').notNull(),
  // Kairos memory stream classifier. Allowed values are canonical in
  // apps/web/src/lib/kairos/streamClass.ts (STREAM_CLASSES const + StreamClass
  // type + isStreamClass guard). Phase 2 added agentic/execution/idea/
  // reflection/archetype/cortex; Phase 3 added 'advisory' and 'trace'. The
  // column is varchar with no CHECK constraint — writers MUST narrow via
  // isStreamClass() before insert.
  streamClass: varchar('stream_class', { length: 20 }).default('idea').notNull(),
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
  dominionIdx: index('memories_dominion_idx').on(t.dominionId),
  streamClassIdx: index('memories_stream_class_idx').on(t.userId, t.streamClass),
}))

// Kairos Dominion — user-scoped top-level grouping that sits above Project
// for the brain visualisation. Projects, repos, and memories all resolve up
// to a Dominion for cluster colour and auto-edge generation. See VISION.md
// "Bet 5: Kairos as a personal productivity tool first".
export const dominions = pgTable('dominions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  // Theme-aligned colour key (e.g. "purple", "sky", "emerald") — drives the
  // node tint and the legend pill. Free-form so the user isn't boxed in.
  color: varchar('color', { length: 30 }).default('purple').notNull(),
  // Optional icon slug (matches the realm icon picker conventions).
  icon: varchar('icon', { length: 50 }),
  sortOrder: integer('sort_order').default(0).notNull(),
  // Kairos Phase 1 (C11) — standing context for the Briefer.
  vision: text('vision'),
  missionLong: text('mission_long'),
  archivedAt: timestamp('archived_at', { mode: 'date' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: index('dominions_user_idx').on(t.userId, t.sortOrder),
  archivedIdx: index('dominions_archived_idx').on(t.userId, t.archivedAt),
}))

// Kairos Phase 1 (B10) — Engine Router policy table. Each row maps a
// (task_type, sensitivity, urgency) selector to the preferred engine.
// Router falls back to DEFAULT_POLICIES constants when no row matches.
// See drizzle/0018_engine_policies.sql for column-level docs.
export const enginePolicies = pgTable('engine_policies', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  taskType: varchar('task_type', { length: 40 }).notNull(),
  sensitivity: varchar('sensitivity', { length: 20 }).default('public').notNull(),
  urgency: varchar('urgency', { length: 20 }).default('normal').notNull(),
  providerId: varchar('provider_id', { length: 40 }).notNull(),
  modelId: varchar('model_id', { length: 120 }),
  tier: varchar('tier', { length: 20 }),
  priority: integer('priority').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userTaskIdx: index('engine_policies_user_task_idx').on(t.userId, t.taskType, t.priority),
  taskIdx: index('engine_policies_task_idx').on(t.taskType, t.priority),
}))

// Kairos Phase 1 (C11) — concrete, trackable goals per Dominion. The Briefer
// reads open objectives as the "what we said matters" frame; closed ones
// remain for retrospective context.
export const dominionObjectives = pgTable('dominion_objectives', {
  id: uuid('id').defaultRandom().primaryKey(),
  dominionId: uuid('dominion_id').notNull().references(() => dominions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  // 'active' | 'paused' | 'completed' | 'abandoned' — validated by Zod
  // (see dominionObjectiveStatusSchema in validators.ts).
  status: varchar('status', { length: 20 }).default('active').notNull(),
  targetDate: timestamp('target_date', { mode: 'date' }),
  sortOrder: integer('sort_order').default(0).notNull(),
  archivedAt: timestamp('archived_at', { mode: 'date' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  dominionIdx: index('dominion_objectives_dominion_idx').on(t.dominionId, t.sortOrder),
  userStatusIdx: index('dominion_objectives_user_status_idx').on(t.userId, t.status),
}))

// Join table mapping Claude-session-capture repo slugs to a Dominion so a
// memory whose sourceMetadata.repo matches can auto-resolve its Dominion
// without manual assignment.
export const dominionRepos = pgTable('dominion_repos', {
  dominionId: uuid('dominion_id').notNull().references(() => dominions.id, { onDelete: 'cascade' }),
  repoSlug: varchar('repo_slug', { length: 120 }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.dominionId, t.repoSlug] }),
  slugIdx: index('dominion_repos_slug_idx').on(t.repoSlug),
}))

// Kairos Phase 3 (D15) — Spawn primitive substrate. agent_sessions tracks
// AI sessions (Claude Code, Codex) dispatched on the operator's behalf.
// See drizzle/0019_agent_sessions.sql for column-level docs.
export const agentSessions = pgTable('agent_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  realmId: uuid('realm_id').references(() => workspaceGroups.id, { onDelete: 'set null' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  dominionId: uuid('dominion_id').references(() => dominions.id, { onDelete: 'set null' }),
  engine: varchar('engine', { length: 40 }).notNull(),
  repo: varchar('repo', { length: 200 }),
  branch: varchar('branch', { length: 120 }),
  goal: text('goal').notNull(),
  prompt: text('prompt').notNull(),
  workerHost: varchar('worker_host', { length: 120 }),
  workerPid: integer('worker_pid'),
  // 'queued' | 'running' | 'succeeded' | 'failed' | 'killed' | 'timeout'
  status: varchar('status', { length: 20 }).default('queued').notNull(),
  exitCode: integer('exit_code'),
  spawnedAt: timestamp('spawned_at').defaultNow().notNull(),
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 4 }),
  // Forward link to the session-summary memory created on success.
  memoryId: uuid('memory_id').references((): AnyPgColumn => memories.id, { onDelete: 'set null' }),
  metadata: jsonb('metadata').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userStatusIdx: index('agent_sessions_user_status_idx').on(t.userId, t.status, t.spawnedAt),
  dominionIdx: index('agent_sessions_dominion_idx').on(t.dominionId, t.spawnedAt),
  liveIdx: index('agent_sessions_live_idx').on(t.userId, t.spawnedAt),
}))

// Trello-style multi-assign on board cards. Auto-activates in boards with
// more than one project member; single-member boards see a graceful hint.
export const taskAssignees = pgTable('task_assignees', {
  taskId: uuid('task_id').notNull().references(() => boardTasks.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
  assignedAt: timestamp('assigned_at').defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.taskId, t.userId] }),
  userIdx: index('task_assignees_user_idx').on(t.userId, t.assignedAt),
  taskIdx: index('task_assignees_task_idx').on(t.taskId),
}))

// Per-session timeline. Emitted by the worker host (status transitions) and
// by Claude Code PostToolUse / Stop hooks (tool_use, tool_result, message,
// stop). seq is monotonic per session and UNIQUE to make replays idempotent.
export const sessionEvents = pgTable('session_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  // 'status' | 'tool_use' | 'tool_result' | 'message' | 'stop' | 'error'
  kind: varchar('kind', { length: 40 }).notNull(),
  toolName: varchar('tool_name', { length: 80 }),
  payload: jsonb('payload').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  sessionSeqIdx: uniqueIndex('session_events_session_seq_idx').on(t.sessionId, t.seq),
  createdIdx: index('session_events_created_idx').on(t.createdAt),
}))

export type User = typeof users.$inferSelect
export type Project = typeof projects.$inferSelect
export type GanttView = typeof ganttViews.$inferSelect
export type Row = typeof rows.$inferSelect
export type BoardColumn = typeof boardColumns.$inferSelect
export type GanttTask = typeof ganttTasks.$inferSelect
export type BoardTask = typeof boardTasks.$inferSelect
export type Label = typeof labels.$inferSelect
export type TaskDependency = typeof taskDependencies.$inferSelect
export type ChecklistItem = typeof checklistItems.$inferSelect
export type CanvasNode = typeof canvasNodes.$inferSelect
export type CanvasEdge = typeof canvasEdges.$inferSelect
export type ActivityEvent = typeof activityEvents.$inferSelect
export type TaskVault = typeof taskVault.$inferSelect
export type UserPreference = typeof userPreferences.$inferSelect
export type TaskComment = typeof taskComments.$inferSelect
export type ApiKeyRecord = typeof apiKeys.$inferSelect
export type ProjectMember = typeof projectMembers.$inferSelect
export type ProjectInvite = typeof projectInvites.$inferSelect
export type BoardSnapshot = typeof boardSnapshots.$inferSelect
export type WorkspaceGroup = typeof workspaceGroups.$inferSelect
export type GroupMember = typeof groupMembers.$inferSelect
export type ProjectGroup = typeof projectGroups.$inferSelect
export type UserContact = typeof userContacts.$inferSelect
export type RealmInvite = typeof realmInvites.$inferSelect
export type MobileLoginToken = typeof mobileLoginTokens.$inferSelect
export type MobileSession = typeof mobileSessions.$inferSelect
export type Memory = typeof memories.$inferSelect
export type Dominion = typeof dominions.$inferSelect
export type DominionRepo = typeof dominionRepos.$inferSelect
export type DominionObjective = typeof dominionObjectives.$inferSelect
export type EnginePolicy = typeof enginePolicies.$inferSelect
export type UserAiCredential = typeof userAiCredentials.$inferSelect
export type UserAiPreference = typeof userAiPreferences.$inferSelect
export type AgentSession = typeof agentSessions.$inferSelect
export type SessionEvent = typeof sessionEvents.$inferSelect
export type TaskAssignee = typeof taskAssignees.$inferSelect
