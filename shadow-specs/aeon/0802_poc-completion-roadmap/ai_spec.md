# Aeon POC Completion -- Execution Blueprint

---

## Phase 1: Project CRUD + Dashboard

### Step 1.1: Create Server Actions for Projects

**New file: `src/lib/actions/projects.ts`**

```typescript
'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

export async function getProjects() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, session.user.id))
    .orderBy(desc(projects.createdAt))
}

export async function createProject(data: {
  name: string
  description?: string
  startDate: string
  endDate: string
  timeScale?: string
}) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const [project] = await db
    .insert(projects)
    .values({
      userId: session.user.id,
      name: data.name,
      description: data.description || null,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      timeScale: data.timeScale || 'week',
    })
    .returning()

  revalidatePath('/dashboard')
  return project
}

export async function updateProject(
  projectId: string,
  data: { name?: string; description?: string; startDate?: string; endDate?: string; timeScale?: string }
) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (data.name !== undefined) updates.name = data.name
  if (data.description !== undefined) updates.description = data.description
  if (data.startDate !== undefined) updates.startDate = new Date(data.startDate)
  if (data.endDate !== undefined) updates.endDate = new Date(data.endDate)
  if (data.timeScale !== undefined) updates.timeScale = data.timeScale

  const [project] = await db
    .update(projects)
    .set(updates)
    .where(eq(projects.id, projectId))
    .returning()

  revalidatePath('/dashboard')
  revalidatePath(`/project/${projectId}`)
  return project
}

export async function deleteProject(projectId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await db.delete(projects).where(eq(projects.id, projectId))
  revalidatePath('/dashboard')
}
```

**Why Server Actions over API Routes:**
- Next.js 15 native pattern, no need for fetch() calls or route handlers
- Type-safe: function signatures are the contract
- `revalidatePath` automatically refreshes server component data
- Auth check via `auth()` is identical to what dashboard page.tsx already does

**Validation:**
- Import and call `createProject` from a test button -- check Drizzle Studio for inserted row
- Call `getProjects` -- should return array with the created project
- Call `deleteProject` -- row should disappear from Drizzle Studio

---

### Step 1.2: Create Project Modal Component

**New file: `src/components/project/CreateProjectModal.tsx`**

```typescript
'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { NeonButton } from '@/components/ui/NeonButton'
import { createProject } from '@/lib/actions/projects'
import { useRouter } from 'next/navigation'

interface CreateProjectModalProps {
  isOpen: boolean
  onClose: () => void
}

export function CreateProjectModal({ isOpen, onClose }: CreateProjectModalProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  })

  const handleSubmit = async () => {
    if (!formData.name.trim() || isSubmitting) return
    setIsSubmitting(true)

    try {
      const project = await createProject({
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        startDate: formData.startDate,
        endDate: formData.endDate,
      })
      onClose()
      router.push(`/project/${project.id}`)
    } catch (error) {
      console.error('Failed to create project:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'w-full max-w-md p-6 rounded-xl',
              'bg-gradient-to-b from-white/10 to-black/40',
              'backdrop-blur-xl border border-white/10',
              'shadow-[0_0_40px_rgba(99,102,241,0.3)]'
            )}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-400" />
                <h2 className="text-lg font-semibold text-white">New Project</h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Project Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My Project"
                  className={cn(
                    'w-full px-4 py-2.5 rounded-lg',
                    'bg-white/5 border border-white/10',
                    'text-white placeholder-slate-500',
                    'focus:outline-none focus:ring-2 focus:ring-purple-500/50'
                  )}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description..."
                  rows={2}
                  className={cn(
                    'w-full px-4 py-2.5 rounded-lg resize-none',
                    'bg-white/5 border border-white/10',
                    'text-white placeholder-slate-500',
                    'focus:outline-none focus:ring-2 focus:ring-purple-500/50'
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-slate-400 mb-1.5">Start Date</label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className={cn(
                      'w-full px-4 py-2.5 rounded-lg',
                      'bg-white/5 border border-white/10',
                      'text-white',
                      'focus:outline-none focus:ring-2 focus:ring-purple-500/50',
                      '[color-scheme:dark]'
                    )}
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1.5">End Date</label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className={cn(
                      'w-full px-4 py-2.5 rounded-lg',
                      'bg-white/5 border border-white/10',
                      'text-white',
                      'focus:outline-none focus:ring-2 focus:ring-purple-500/50',
                      '[color-scheme:dark]'
                    )}
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <NeonButton
                onClick={handleSubmit}
                disabled={!formData.name.trim() || isSubmitting}
                className="flex-1"
                color="purple"
              >
                {isSubmitting ? 'Creating...' : 'Create Project'}
              </NeonButton>
              <button
                onClick={onClose}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium',
                  'bg-white/5 hover:bg-white/10 border border-white/10',
                  'text-slate-400 hover:text-white transition-all'
                )}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

**Why this approach:**
- Mirrors existing TaskBoard modal pattern (same glassmorphism, same animation)
- `useRouter().push()` navigates to new project immediately after creation
- `isSubmitting` state prevents double-submit

---

### Step 1.3: Wire Dashboard to Real Data

**Modified: `src/app/dashboard/page.tsx`**

```typescript
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getProjects } from '@/lib/actions/projects'
import DashboardContent from './DashboardContent'

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const projects = await getProjects()

  return <DashboardContent user={session.user} projects={projects} />
}
```

**Modified: `src/app/dashboard/DashboardContent.tsx`**

Key changes (not full file -- only the delta):

1. Add props interface change:
```typescript
// BEFORE
interface DashboardContentProps {
  user: { id: string; role: string; name?: string | null; email?: string | null; image?: string | null }
}

// AFTER
import type { Project } from '@/lib/db/schema'

interface DashboardContentProps {
  user: { id: string; role: string; name?: string | null; email?: string | null; image?: string | null }
  projects: Project[]
}
```

2. Add state for modal + wire project count:
```typescript
export default function DashboardContent({ user, projects }: DashboardContentProps) {
  const [showCreateModal, setShowCreateModal] = useState(false)
  // ... existing code ...
```

3. Replace static "0 Projects" card:
```typescript
<h3 className="text-sm font-semibold text-white">{projects.length} Projects</h3>
```

4. Wire "New Project" GlowCard `onClick`:
```typescript
<GlowCard accentColor="purple" glowIntensity="sm" showAccentLine hover>
  <div onClick={() => setShowCreateModal(true)} className="flex items-center gap-3 p-2 cursor-pointer">
    {/* ... existing content ... */}
  </div>
</GlowCard>
```

5. Replace empty state section with conditional:
```typescript
{projects.length === 0 ? (
  // ... existing empty state with floating animation ...
  <NeonButton onClick={() => setShowCreateModal(true)} color="purple" glowIntensity="md">
    {/* ... */}
  </NeonButton>
) : (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    {projects.map((project) => (
      <Link key={project.id} href={`/project/${project.id}`}>
        <GlowCard accentColor="purple" glowIntensity="sm" showAccentLine hover>
          <div className="p-3">
            <h3 className="text-sm font-semibold text-white">{project.name}</h3>
            {project.description && (
              <p className="text-xs text-[var(--text-dim)] mt-1 line-clamp-2">{project.description}</p>
            )}
            <div className="flex items-center gap-3 mt-3 text-xs text-[var(--text-muted)]">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {new Date(project.startDate).toLocaleDateString()}
              </span>
              <span>-</span>
              <span>{new Date(project.endDate).toLocaleDateString()}</span>
            </div>
          </div>
        </GlowCard>
      </Link>
    ))}
  </div>
)}
```

6. Add modal at bottom of component:
```typescript
<CreateProjectModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
```

**Validation:**
- Dashboard loads with projects fetched from DB (initially empty)
- Click "New Project" -> modal opens
- Fill form, submit -> project appears in DB + user redirected to `/project/[id]`
- Navigate back to dashboard -> project card visible with name + dates

---

### Step 1.4: Create Project Detail Page

**New file: `src/app/project/[id]/page.tsx`**

```typescript
import { auth } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import ProjectContent from './ProjectContent'

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const { id } = await params

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, session.user.id)))

  if (!project) notFound()

  return <ProjectContent project={project} />
}
```

**New file: `src/app/project/[id]/ProjectContent.tsx`**

```typescript
'use client'

import { useState, useEffect } from 'react'
import { Sparkles, LayoutGrid, Calendar, ArrowLeft, Settings } from 'lucide-react'
import Link from 'next/link'
import { ThemeSelector } from '@/components/ui/ThemeSelector'
import { GanttChart } from '@/components/gantt/GanttChart'
import { TimeScaleSelector } from '@/components/gantt/TimeScaleSelector'
import { TaskBoard } from '@/components/board/TaskBoard'
import { useGanttStore } from '@/lib/store/ganttStore'
import { useBoardStore } from '@/lib/store/boardStore'
import type { Project } from '@/lib/db/schema'

interface ProjectContentProps {
  project: Project
}

export default function ProjectContent({ project }: ProjectContentProps) {
  const [activeTab, setActiveTab] = useState<'board' | 'gantt'>('board')
  const { setTasks: setGanttTasks, setRows, timeScale } = useGanttStore()
  const { setTasks: setBoardTasks, setLabels } = useBoardStore()

  useEffect(() => {
    // Phase 1: Clear stores for this project (Phase 2+3 will load from DB)
    setBoardTasks([])
    setGanttTasks([])
    setRows([])
    setLabels([])
  }, [project.id, setBoardTasks, setGanttTasks, setRows, setLabels])

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/5 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <Sparkles className="w-5 h-5 text-[var(--primary)]" />
            <span className="text-lg font-bold text-white">{project.name}</span>
          </div>

          <div className="flex items-center gap-4">
            {activeTab === 'gantt' && <TimeScaleSelector />}
            <ThemeSelector />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => setActiveTab('board')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === 'board'
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
            Task Board
          </button>
          <button
            onClick={() => setActiveTab('gantt')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === 'gantt'
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Calendar className="w-4 h-4" />
            Gantt Chart
          </button>
        </div>

        {activeTab === 'board' && (
          <div className="h-[calc(100vh-180px)]">
            <TaskBoard projectId={project.id} />
          </div>
        )}

        {activeTab === 'gantt' && (
          <GanttChart
            projectId={project.id}
            startDate={new Date(project.startDate)}
            endDate={new Date(project.endDate)}
          />
        )}
      </main>
    </div>
  )
}
```

**Why this structure mirrors demo page:**
- Same tab switching, same component usage
- Server component fetches project + validates ownership
- Client component manages UI state via existing stores
- `useEffect` clears stores on mount -- Phase 2/3 will replace this with DB loading

---

### Step 1.5: Update Middleware

**Modified: `src/middleware.ts`**

```typescript
// BEFORE
const PUBLIC_PATHS = ['/', '/login', '/demo']

// AFTER
const PUBLIC_PATHS = ['/', '/login', '/demo']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/api/') || pathname.startsWith('/project/')) {
    // /project/* routes are protected by server component auth check, not middleware
    // This prevents redirect loop -- middleware can't read session from DB
    return NextResponse.next()
  }
  // ... rest unchanged
}
```

**Wait -- actually this is wrong.** The middleware cookie check IS the protection for `/project/*`. The server component does a redundant check. Both patterns work but we should keep middleware protection and just let it through since it already checks for session cookie:

Actually, the middleware DOES protect `/project/*` already -- it's not in PUBLIC_PATHS so it falls through to the cookie check. No middleware change needed. The server component `redirect('/login')` is a fallback for edge cases where cookie exists but session is expired.

**Correction: No middleware change required.** The current middleware already protects `/project/*` paths correctly.

**Validation for Phase 1:**
- Visit `/dashboard` -> see "0 Projects" + empty state
- Click "Create First Project" -> modal appears
- Enter name + dates, submit -> redirected to `/project/[uuid]`
- See empty board + gantt (stores cleared)
- Navigate back to `/dashboard` -> project card appears
- Click project card -> returns to project page

---

## Phase 2: Board Tasks -> Database

### Step 2.1: Create Board Server Actions

**New file: `src/lib/actions/board.ts`**

```typescript
'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { boardTasks, projects } from '@/lib/db/schema'
import { eq, and, asc } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

async function verifyProjectAccess(projectId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)))

  if (!project) throw new Error('Project not found')
  return session.user.id
}

export async function getBoardTasks(projectId: string) {
  await verifyProjectAccess(projectId)

  return db
    .select()
    .from(boardTasks)
    .where(eq(boardTasks.projectId, projectId))
    .orderBy(asc(boardTasks.orderIndex))
}

export async function createBoardTask(data: {
  projectId: string
  name: string
  description?: string
  status: string
  priority: string
  color: string
  orderIndex: number
}) {
  await verifyProjectAccess(data.projectId)

  const [task] = await db
    .insert(boardTasks)
    .values({
      projectId: data.projectId,
      name: data.name,
      description: data.description || null,
      status: data.status,
      priority: data.priority,
      color: data.color,
      orderIndex: data.orderIndex,
      onTimeline: false,
    })
    .returning()

  revalidatePath(`/project/${data.projectId}`)
  return task
}

export async function updateBoardTask(
  taskId: string,
  projectId: string,
  data: {
    name?: string
    description?: string
    status?: string
    priority?: string
    color?: string
    orderIndex?: number
    startDate?: string | null
    endDate?: string | null
    onTimeline?: boolean
  }
) {
  await verifyProjectAccess(projectId)

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (data.name !== undefined) updates.name = data.name
  if (data.description !== undefined) updates.description = data.description || null
  if (data.status !== undefined) updates.status = data.status
  if (data.priority !== undefined) updates.priority = data.priority
  if (data.color !== undefined) updates.color = data.color
  if (data.orderIndex !== undefined) updates.orderIndex = data.orderIndex
  if (data.startDate !== undefined) updates.startDate = data.startDate ? new Date(data.startDate) : null
  if (data.endDate !== undefined) updates.endDate = data.endDate ? new Date(data.endDate) : null
  if (data.onTimeline !== undefined) updates.onTimeline = data.onTimeline

  const [task] = await db
    .update(boardTasks)
    .set(updates)
    .where(eq(boardTasks.id, taskId))
    .returning()

  return task
}

export async function moveBoardTask(
  taskId: string,
  projectId: string,
  status: string,
  orderIndex: number
) {
  await verifyProjectAccess(projectId)

  await db
    .update(boardTasks)
    .set({ status, orderIndex, updatedAt: new Date() })
    .where(eq(boardTasks.id, taskId))
}

export async function deleteBoardTask(taskId: string, projectId: string) {
  await verifyProjectAccess(projectId)
  await db.delete(boardTasks).where(eq(boardTasks.id, taskId))
  revalidatePath(`/project/${projectId}`)
}

export async function batchUpdateBoardTaskOrder(
  projectId: string,
  updates: { id: string; orderIndex: number; status?: string }[]
) {
  await verifyProjectAccess(projectId)

  await Promise.all(
    updates.map(({ id, orderIndex, status }) => {
      const set: Record<string, unknown> = { orderIndex, updatedAt: new Date() }
      if (status) set.status = status
      return db.update(boardTasks).set(set).where(eq(boardTasks.id, id))
    })
  )
}
```

**Why `verifyProjectAccess` as a shared helper:**
- Every board action needs auth + project ownership check
- Prevents a user from manipulating tasks in someone else's project
- Single query validates both conditions

**Why `batchUpdateBoardTaskOrder`:**
- Drag-and-drop reordering changes orderIndex for multiple tasks
- Sending individual updates creates N round-trips to Neon
- Batch with Promise.all keeps it in one logical operation

---

### Step 2.2: Load Board Data from DB into Zustand

**Modified: `src/app/project/[id]/ProjectContent.tsx`**

Replace the `useEffect` that clears stores:

```typescript
// BEFORE
useEffect(() => {
  setBoardTasks([])
  setGanttTasks([])
  setRows([])
  setLabels([])
}, [project.id, setBoardTasks, setGanttTasks, setRows, setLabels])

// AFTER
import { getBoardTasks } from '@/lib/actions/board'

const [isLoading, setIsLoading] = useState(true)

useEffect(() => {
  async function loadProjectData() {
    setIsLoading(true)
    try {
      const tasks = await getBoardTasks(project.id)

      const mappedTasks = tasks.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        name: t.name,
        description: t.description || undefined,
        status: t.status as 'todo' | 'doing' | 'review' | 'done',
        priority: t.priority as 'low' | 'medium' | 'high' | 'urgent',
        color: t.color,
        labels: [],
        startDate: t.startDate?.toISOString(),
        endDate: t.endDate?.toISOString(),
        onTimeline: t.onTimeline,
        orderIndex: t.orderIndex,
      }))

      setBoardTasks(mappedTasks)
    } catch (error) {
      console.error('Failed to load project data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  loadProjectData()
}, [project.id, setBoardTasks])
```

**Key mapping note:** DB `boardTasks` has no `labels` array field -- labels use a junction table. For POC, we pass empty `labels: []`. Labels CRUD is out of scope.

**Why Zustand stays as UI cache:**
- All drag-and-drop, reordering, visual updates happen instantly in Zustand
- Server actions fire asynchronously to persist changes
- If server action fails, we can revert Zustand state (optimistic pattern)
- Stores already have `isDirty` flag designed for this

---

### Step 2.3: Wire TaskBoard Mutations to Server Actions

The existing `TaskBoard.tsx` calls Zustand methods: `addTask`, `updateTask`, `removeTask`, `moveTask`. We need to intercept these to also persist to DB.

**Strategy: Wrapper hooks approach**

Rather than modifying every Zustand call inside TaskBoard (which is 564 lines and complex), create a wrapper hook that the project page provides via context or props.

**New file: `src/lib/hooks/useBoardSync.ts`**

```typescript
import { useCallback, useRef } from 'react'
import { useBoardStore } from '@/lib/store/boardStore'
import {
  createBoardTask,
  updateBoardTask,
  moveBoardTask,
  deleteBoardTask,
  batchUpdateBoardTaskOrder,
} from '@/lib/actions/board'

export function useBoardSync(projectId: string) {
  const store = useBoardStore()
  const pendingRef = useRef(false)

  const syncAddTask = useCallback(async (task: Parameters<typeof store.addTask>[0]) => {
    store.addTask(task)

    try {
      const dbTask = await createBoardTask({
        projectId,
        name: task.name,
        description: task.description,
        status: task.status,
        priority: task.priority,
        color: task.color,
        orderIndex: task.orderIndex,
      })
      store.updateTask(task.id, { id: dbTask.id } as any)
    } catch (error) {
      console.error('Failed to create task:', error)
      store.removeTask(task.id)
    }
  }, [projectId, store])

  const syncUpdateTask = useCallback(async (
    id: string,
    updates: Parameters<typeof store.updateTask>[1]
  ) => {
    store.updateTask(id, updates)

    try {
      await updateBoardTask(id, projectId, updates as any)
    } catch (error) {
      console.error('Failed to update task:', error)
    }
  }, [projectId, store])

  const syncRemoveTask = useCallback(async (id: string) => {
    const task = store.tasks.find((t) => t.id === id)
    store.removeTask(id)

    try {
      await deleteBoardTask(id, projectId)
    } catch (error) {
      console.error('Failed to delete task:', error)
      if (task) store.addTask(task)
    }
  }, [projectId, store])

  const syncMoveTask = useCallback(async (
    id: string,
    status: 'todo' | 'doing' | 'review' | 'done',
    orderIndex: number
  ) => {
    store.moveTask(id, status, orderIndex)

    try {
      await moveBoardTask(id, projectId, status, orderIndex)
    } catch (error) {
      console.error('Failed to move task:', error)
    }
  }, [projectId, store])

  const syncReorder = useCallback(async (
    updates: { id: string; orderIndex: number; status?: string }[]
  ) => {
    updates.forEach(({ id, orderIndex }) => {
      store.updateTask(id, { orderIndex })
    })

    try {
      await batchUpdateBoardTaskOrder(projectId, updates)
    } catch (error) {
      console.error('Failed to reorder tasks:', error)
    }
  }, [projectId, store])

  return {
    syncAddTask,
    syncUpdateTask,
    syncRemoveTask,
    syncMoveTask,
    syncReorder,
  }
}
```

**Integration approach -- two options:**

**Option A (Minimal change):** Modify `TaskBoard` to accept optional callback props. When provided, call them instead of raw Zustand methods. When not provided (demo mode), use Zustand directly. This keeps TaskBoard working for both `/demo` and `/project/[id]`.

**Option B (Cleaner):** Add an `onMutate` prop to TaskBoard that receives mutation type + payload. The parent decides whether to persist or not.

**Recommended: Option A** -- add optional `onTaskCreate`, `onTaskUpdate`, `onTaskDelete`, `onTaskMove` props to `TaskBoard`. Less refactoring, keeps demo working.

```typescript
// TaskBoard props addition:
interface TaskBoardProps {
  projectId: string
  onTaskCreate?: (task: BoardTask) => Promise<void>
  onTaskUpdate?: (id: string, updates: Partial<BoardTask>) => Promise<void>
  onTaskDelete?: (id: string) => Promise<void>
  onTaskMove?: (id: string, status: string, orderIndex: number) => Promise<void>
  onTaskReorder?: (updates: { id: string; orderIndex: number }[]) => Promise<void>
}
```

Then in handleSubmit (create), handleTaskEdit (update), removeTask calls, etc.:
```typescript
// BEFORE (in handleSubmit for new task)
addTask({ id: generateId(), projectId, ... })

// AFTER
const newTask = { id: generateId(), projectId, ... }
addTask(newTask)
if (onTaskCreate) {
  onTaskCreate(newTask).catch(() => removeTask(newTask.id))
}
```

**In ProjectContent.tsx:**
```typescript
const { syncAddTask, syncUpdateTask, syncRemoveTask, syncMoveTask, syncReorder } = useBoardSync(project.id)

<TaskBoard
  projectId={project.id}
  onTaskCreate={syncAddTask}
  onTaskUpdate={syncUpdateTask}
  onTaskDelete={syncRemoveTask}
  onTaskMove={syncMoveTask}
  onTaskReorder={syncReorder}
/>
```

**In demo page:** No props passed, TaskBoard uses Zustand-only as before.

**Validation:**
- Open project -> board is empty (no tasks in DB yet)
- Quick-add a task -> appears in board + check Drizzle Studio (row exists)
- Edit task name/color -> DB updated
- Drag task to different column -> status updated in DB
- Drag to trash -> task deleted from DB
- Refresh page -> all tasks still there (loaded from DB, not localStorage)

---

### Step 2.4: Handle the ID Replacement Problem

When creating a task client-side, we generate a UUID via `crypto.randomUUID()`. Then the server action inserts with Postgres-generated UUID. These are different IDs.

**Solution:** Use client-generated UUID as the DB primary key.

Change the server action to accept the client ID:

```typescript
export async function createBoardTask(data: {
  id: string       // <-- client-generated UUID
  projectId: string
  name: string
  // ...
}) {
  const [task] = await db
    .insert(boardTasks)
    .values({
      id: data.id,    // <-- override defaultRandom()
      // ...
    })
    .returning()

  return task
}
```

**Why this is safe:** `crypto.randomUUID()` generates v4 UUIDs, same as Postgres `gen_random_uuid()`. Collision probability is negligible. This avoids the entire "replace temporary ID with server ID" complexity.

---

## Phase 3: Gantt Tasks -> Database

### Step 3.1: Create Gantt Server Actions

**New file: `src/lib/actions/gantt.ts`**

```typescript
'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { ganttTasks, rows, projects } from '@/lib/db/schema'
import { eq, and, asc } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

async function verifyProjectAccess(projectId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)))

  if (!project) throw new Error('Project not found')
  return session.user.id
}

export async function getGanttData(projectId: string) {
  await verifyProjectAccess(projectId)

  const [projectRows, tasks] = await Promise.all([
    db.select().from(rows).where(eq(rows.projectId, projectId)).orderBy(asc(rows.orderIndex)),
    db.select().from(ganttTasks).where(eq(ganttTasks.projectId, projectId)),
  ])

  return { rows: projectRows, tasks }
}

export async function createRow(data: {
  id: string
  projectId: string
  name: string
  color: string
  orderIndex: number
}) {
  await verifyProjectAccess(data.projectId)

  const [row] = await db
    .insert(rows)
    .values({
      id: data.id,
      projectId: data.projectId,
      name: data.name,
      color: data.color,
      orderIndex: data.orderIndex,
    })
    .returning()

  return row
}

export async function updateRow(
  rowId: string,
  projectId: string,
  data: { name?: string; color?: string; orderIndex?: number }
) {
  await verifyProjectAccess(projectId)

  const updates: Record<string, unknown> = {}
  if (data.name !== undefined) updates.name = data.name
  if (data.color !== undefined) updates.color = data.color
  if (data.orderIndex !== undefined) updates.orderIndex = data.orderIndex

  const [row] = await db.update(rows).set(updates).where(eq(rows.id, rowId)).returning()
  return row
}

export async function deleteRow(rowId: string, projectId: string) {
  await verifyProjectAccess(projectId)
  await db.delete(rows).where(eq(rows.id, rowId))
}

export async function createGanttTask(data: {
  id: string
  projectId: string
  rowId: string | null
  name: string
  description?: string
  startDate: string
  endDate: string
  color: string
  progress: number
}) {
  await verifyProjectAccess(data.projectId)

  const [task] = await db
    .insert(ganttTasks)
    .values({
      id: data.id,
      projectId: data.projectId,
      rowId: data.rowId,
      name: data.name,
      description: data.description || null,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      color: data.color,
      progress: data.progress,
    })
    .returning()

  return task
}

export async function updateGanttTask(
  taskId: string,
  projectId: string,
  data: {
    rowId?: string | null
    name?: string
    description?: string
    startDate?: string
    endDate?: string
    color?: string
    progress?: number
  }
) {
  await verifyProjectAccess(projectId)

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (data.rowId !== undefined) updates.rowId = data.rowId
  if (data.name !== undefined) updates.name = data.name
  if (data.description !== undefined) updates.description = data.description || null
  if (data.startDate !== undefined) updates.startDate = new Date(data.startDate)
  if (data.endDate !== undefined) updates.endDate = new Date(data.endDate)
  if (data.color !== undefined) updates.color = data.color
  if (data.progress !== undefined) updates.progress = data.progress

  const [task] = await db
    .update(ganttTasks)
    .set(updates)
    .where(eq(ganttTasks.id, taskId))
    .returning()

  return task
}

export async function deleteGanttTask(taskId: string, projectId: string) {
  await verifyProjectAccess(projectId)
  await db.delete(ganttTasks).where(eq(ganttTasks.id, taskId))
}
```

---

### Step 3.2: Load Gantt Data in ProjectContent

**Extend the `useEffect` in ProjectContent.tsx:**

```typescript
import { getGanttData } from '@/lib/actions/gantt'

useEffect(() => {
  async function loadProjectData() {
    setIsLoading(true)
    try {
      const [tasks, ganttData] = await Promise.all([
        getBoardTasks(project.id),
        getGanttData(project.id),
      ])

      const mappedBoardTasks = tasks.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        name: t.name,
        description: t.description || undefined,
        status: t.status as 'todo' | 'doing' | 'review' | 'done',
        priority: t.priority as 'low' | 'medium' | 'high' | 'urgent',
        color: t.color,
        labels: [],
        startDate: t.startDate?.toISOString(),
        endDate: t.endDate?.toISOString(),
        onTimeline: t.onTimeline,
        orderIndex: t.orderIndex,
      }))

      const mappedGanttTasks = ganttData.tasks.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        rowId: t.rowId,
        name: t.name,
        description: t.description || undefined,
        startDate: t.startDate.toISOString(),
        endDate: t.endDate.toISOString(),
        color: t.color,
        progress: t.progress,
        dependencies: [],
      }))

      const mappedRows = ganttData.rows.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        name: r.name,
        color: r.color,
        orderIndex: r.orderIndex,
      }))

      setBoardTasks(mappedBoardTasks)
      setGanttTasks(mappedGanttTasks)
      setRows(mappedRows)
    } catch (error) {
      console.error('Failed to load project data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  loadProjectData()
}, [project.id, setBoardTasks, setGanttTasks, setRows])
```

**Key mapping note:** Gantt store has `dependencies: string[]` but DB has no dependencies table. For POC, always map to empty array `dependencies: []`.

---

### Step 3.3: Wire GanttChart Mutations to Server Actions

Same pattern as board -- add optional callback props to `GanttChart`:

```typescript
interface GanttChartProps {
  projectId: string
  startDate: Date
  endDate: Date
  onTaskUpdate?: (id: string, updates: Partial<GanttTask>) => Promise<void>
}
```

**In handleDragEnd (GanttChart.tsx):**
```typescript
// BEFORE
updateTask(task.id, { startDate: newStart.toISOString(), endDate: newEnd.toISOString() })

// AFTER
const updates = { startDate: newStart.toISOString(), endDate: newEnd.toISOString() }
updateTask(task.id, updates)
if (onTaskUpdate) {
  onTaskUpdate(task.id, updates).catch((err) => console.error('Failed to persist:', err))
}
```

**New file: `src/lib/hooks/useGanttSync.ts`**

```typescript
import { useCallback } from 'react'
import { useGanttStore } from '@/lib/store/ganttStore'
import {
  createGanttTask,
  updateGanttTask,
  deleteGanttTask,
  createRow,
  updateRow,
  deleteRow,
} from '@/lib/actions/gantt'

export function useGanttSync(projectId: string) {
  const store = useGanttStore()

  const syncUpdateTask = useCallback(async (
    id: string,
    updates: Record<string, unknown>
  ) => {
    try {
      await updateGanttTask(id, projectId, updates as any)
    } catch (error) {
      console.error('Failed to update gantt task:', error)
    }
  }, [projectId])

  const syncCreateTask = useCallback(async (task: any) => {
    store.addTask(task)
    try {
      await createGanttTask({ ...task, projectId })
    } catch (error) {
      console.error('Failed to create gantt task:', error)
      store.removeTask(task.id)
    }
  }, [projectId, store])

  const syncRemoveTask = useCallback(async (id: string) => {
    const task = store.tasks.find((t) => t.id === id)
    store.removeTask(id)
    try {
      await deleteGanttTask(id, projectId)
    } catch (error) {
      console.error('Failed to delete gantt task:', error)
      if (task) store.addTask(task)
    }
  }, [projectId, store])

  const syncCreateRow = useCallback(async (row: any) => {
    store.addRow(row)
    try {
      await createRow({ ...row, projectId })
    } catch (error) {
      console.error('Failed to create row:', error)
      store.removeRow(row.id)
    }
  }, [projectId, store])

  return {
    syncUpdateTask,
    syncCreateTask,
    syncRemoveTask,
    syncCreateRow,
  }
}
```

---

### Step 3.4: Board-to-Gantt Conversion

The board store has `convertToTimeline(taskId, startDate, endDate)` which sets `onTimeline: true` on a board task. For POC, this should also create a linked gantt task.

**In the sync layer (useBoardSync or ProjectContent):**

```typescript
const syncConvertToTimeline = useCallback(async (
  taskId: string,
  startDate: string,
  endDate: string
) => {
  const boardStore = useBoardStore.getState()
  const ganttStore = useGanttStore.getState()

  boardStore.convertToTimeline(taskId, startDate, endDate)

  const task = boardStore.tasks.find((t) => t.id === taskId)
  if (!task) return

  const ganttTaskId = crypto.randomUUID()
  const firstRow = ganttStore.rows[0]

  const ganttTask = {
    id: ganttTaskId,
    projectId: task.projectId,
    rowId: firstRow?.id || null,
    name: task.name,
    description: task.description,
    startDate,
    endDate,
    color: task.color,
    progress: task.status === 'done' ? 100 : task.status === 'review' ? 75 : task.status === 'doing' ? 25 : 0,
    dependencies: [],
  }

  ganttStore.addTask(ganttTask)

  try {
    await createGanttTask({
      id: ganttTaskId,
      projectId: task.projectId,
      rowId: firstRow?.id || null,
      name: task.name,
      description: task.description,
      startDate,
      endDate,
      color: task.color,
      progress: ganttTask.progress,
    })

    await updateBoardTask(taskId, task.projectId, {
      onTimeline: true,
      startDate,
      endDate,
    })
  } catch (error) {
    console.error('Failed to convert to timeline:', error)
    ganttStore.removeTask(ganttTaskId)
  }
}, [])
```

**Why progress is derived from status:**
- Board tasks have status (todo/doing/review/done) but no progress field
- Gantt tasks have progress (0-100) but no status field
- Mapping: todo=0%, doing=25%, review=75%, done=100%
- This is a reasonable POC default; users can adjust progress on gantt

**Validation for Phase 3:**
- Create rows via some UI mechanism (add row button on gantt, or auto-create default rows on project creation)
- Drag gantt task -> dates update in DB
- Move to different row -> rowId updates in DB
- Convert board task to timeline -> gantt task appears + linked in DB
- Refresh -> all gantt data persists

---

## Phase 4: Polish + Deploy

### Step 4.1: Loading States

Add loading skeletons to ProjectContent:

```typescript
{isLoading ? (
  <div className="flex gap-4">
    {[...Array(4)].map((_, i) => (
      <div key={i} className="min-w-[300px] h-96 rounded-xl bg-white/5 animate-pulse" />
    ))}
  </div>
) : (
  activeTab === 'board' ? <TaskBoard ... /> : <GanttChart ... />
)}
```

### Step 4.2: Error Handling

Add toast-style error notifications. Minimal approach:

```typescript
const [error, setError] = useState<string | null>(null)

{error && (
  <motion.div
    initial={{ opacity: 0, y: -20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -20 }}
    className="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 text-sm backdrop-blur-xl"
  >
    {error}
  </motion.div>
)}
```

### Step 4.3: Project Delete

Add to dashboard project cards -- right-click or settings icon:

```typescript
import { deleteProject } from '@/lib/actions/projects'

const handleDelete = async (projectId: string) => {
  if (!confirm('Delete this project? All tasks will be permanently removed.')) return
  await deleteProject(projectId)
  router.refresh()
}
```

DB cascade handles cleanup: `onDelete: 'cascade'` on all child tables.

### Step 4.4: Auto-create Default Rows

When creating a new project, also create 3 default gantt rows:

```typescript
// In createProject server action, after inserting project:
const defaultRows = [
  { projectId: project.id, name: 'Planning', color: 'purple', orderIndex: 0 },
  { projectId: project.id, name: 'Development', color: 'cyan', orderIndex: 1 },
  { projectId: project.id, name: 'Testing', color: 'green', orderIndex: 2 },
]

await db.insert(rows).values(defaultRows)
```

### Step 4.5: Vercel Deployment

No new files needed. Checklist:
- Set environment variables in Vercel dashboard (DATABASE_URL, AUTH_SECRET, NEXTAUTH_URL, Google OAuth keys)
- Update Google OAuth callback URL to production domain
- Update NEXTAUTH_URL to production domain
- Run `npm run build` locally first to catch type errors
- Neon connection works from Vercel serverless by default (@neondatabase/serverless)

**Validation for Phase 4:**
- Loading skeletons appear briefly on project load
- Deleting a project removes it and all child data
- New projects start with 3 default rows on gantt
- App builds and deploys without errors on Vercel
- Full flow works on production: sign in -> create project -> add tasks -> view gantt -> refresh -> data persists

---

## Implementation Order Summary

```
Phase 1 (do first -- unblocks everything):
  1.1  src/lib/actions/projects.ts (new)
  1.2  src/components/project/CreateProjectModal.tsx (new)
  1.3  src/app/dashboard/page.tsx (modify)
  1.3  src/app/dashboard/DashboardContent.tsx (modify)
  1.4  src/app/project/[id]/page.tsx (new)
  1.4  src/app/project/[id]/ProjectContent.tsx (new)

Phase 2 (do second -- core value):
  2.1  src/lib/actions/board.ts (new)
  2.2  src/lib/hooks/useBoardSync.ts (new)
  2.3  src/components/board/TaskBoard.tsx (modify -- add optional callback props)
  2.3  src/app/project/[id]/ProjectContent.tsx (modify -- wire sync)

Phase 3 (do third -- completes the loop):
  3.1  src/lib/actions/gantt.ts (new)
  3.2  src/lib/hooks/useGanttSync.ts (new)
  3.3  src/components/gantt/GanttChart.tsx (modify -- add optional callback props)
  3.4  src/app/project/[id]/ProjectContent.tsx (modify -- wire gantt sync + conversion)

Phase 4 (do last -- polish):
  4.1  src/app/project/[id]/ProjectContent.tsx (modify -- loading states)
  4.2  Error handling across sync hooks
  4.3  src/app/dashboard/DashboardContent.tsx (modify -- delete button)
  4.4  src/lib/actions/projects.ts (modify -- default rows)
  4.5  Vercel deployment
```

## Testing Strategy

**Manual testing per phase (no test framework for POC):**

Phase 1:
- Create project -> check DB row exists
- List projects -> verify correct user filtering
- Delete project -> verify cascade removes children

Phase 2:
- Create board task -> check DB row, refresh page, task still there
- Move task between columns -> check status field in DB
- Delete task -> confirm removed from DB
- Rapid drag-and-drop -> no orphaned/duplicate tasks

Phase 3:
- Load gantt with rows + tasks from DB
- Drag task horizontally -> dates update in DB
- Drag task to different row -> rowId updates
- Convert board task -> gantt task appears, linked

Phase 4:
- Cold start latency -> loading skeleton visible, no flash
- Error simulation (disconnect DB) -> error shown, no crash
- Full flow on Vercel -> identical behavior to local

## Edge Cases to Watch

1. **Empty project with no rows:** Gantt chart should handle gracefully (show "Add a row" prompt)
2. **Date serialization:** DB returns Date objects, Zustand stores ISO strings. Mapping layer must convert consistently.
3. **Concurrent tab sessions:** Two browser tabs editing same project. For POC, last write wins. No real-time sync.
4. **Large task counts:** 100+ tasks in one project. Zustand handles fine. DB queries need no pagination for POC.
5. **Neon connection pooling:** `@neondatabase/serverless` uses HTTP, not persistent connections. No pool exhaustion risk.
