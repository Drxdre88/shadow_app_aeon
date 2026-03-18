import { pgTable, uuid, varchar, text, timestamp, integer, boolean, jsonb, primaryKey, real, type AnyPgColumn } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }),
  email: varchar('email', { length: 255 }).unique().notNull(),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image: text('image'),
  role: varchar('role', { length: 20 }).default('user').notNull(),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
  title: varchar('title', { length: 255 }).notNull(),
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
  originalCreatedAt: timestamp('original_created_at').notNull(),
})

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
