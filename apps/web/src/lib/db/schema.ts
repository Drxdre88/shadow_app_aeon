import { pgTable, uuid, varchar, text, timestamp, integer, boolean, jsonb, primaryKey, real, uniqueIndex, index, type AnyPgColumn } from 'drizzle-orm/pg-core'
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
