import { z } from 'zod'

// Shapes for the nightly repo_lessons job and the per-repo playbook memory
// (sourceMetadata.kind 'repo_playbook', one row per repo slug).

export const REPO_LESSONS_MAX_REPOS = 6
export const REPO_LESSONS_SESSIONS_PER_REPO = 8
export const REPO_SESSION_SNIPPET_MAX = 600
export const REPO_LESSONS_PER_REPO = 10
export const REPO_LESSON_TEXT_MAX = 300
export const REPO_LESSON_SOURCES_MAX = 8

export const REPO_LESSON_KINDS = ['worked', 'broke', 'convention', 'trap'] as const
export type RepoLessonKind = (typeof REPO_LESSON_KINDS)[number]

export const repoLessonSchema = z.object({
  kind: z.enum(REPO_LESSON_KINDS),
  text: z.string().trim().min(1).max(REPO_LESSON_TEXT_MAX),
  sourceIds: z.array(z.string().min(1)).min(1).max(REPO_LESSON_SOURCES_MAX),
})
export type RepoLesson = z.infer<typeof repoLessonSchema>

export const repoPlaybookMetaSchema = z.object({
  v: z.literal(1),
  repo: z.string().min(1),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lessons: z.array(repoLessonSchema).max(REPO_LESSONS_PER_REPO),
  citations: z.array(z.string()),
  sessionCount: z.number().int().min(0),
  jobId: z.string(),
  answeredBy: z.string(),
})
export type RepoPlaybookMeta = z.infer<typeof repoPlaybookMetaSchema>

// Model answer: lessons are checked one by one so a single bad item never
// sinks the repo.
export const repoLessonsAnswerSchema = z.object({
  repos: z.array(z.object({
    repo: z.string().trim().min(1),
    lessons: z.array(z.unknown()).default([]),
  })),
})

export const repoLessonsContextSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  repos: z.array(z.object({
    slug: z.string().min(1),
    sessionIds: z.array(z.string()),
    priorCitationIds: z.array(z.string()),
  })).min(1),
})
export type RepoLessonsContext = z.infer<typeof repoLessonsContextSchema>

// ── Handover (assembled on read) ──────────────────────────────────────────

export interface RepoHandoverSession {
  id: string
  date: string
  title: string
  summary: string
  client: string | null
}

export interface RepoHandoverCard {
  id: string
  name: string
  boardId: string
  board: string
  column: string | null
  priority: string
  checklist: { done: number; total: number }
}

export interface RepoHandoverAsk { label: string; question: string; askedAt: string }
export interface RepoHandoverPromise { number: string; outcome: string; dueDate: string }

export interface RepoHandoverPlaybook {
  id: string
  updatedAt: string
  day: string
  lessons: RepoLesson[]
}

export interface RepoHandoverData {
  repo: { slug: string; labels: string[] }
  assembledAt: string
  sessions: RepoHandoverSession[]
  cards: RepoHandoverCard[]
  asks: RepoHandoverAsk[]
  promises: RepoHandoverPromise[]
  playbook: RepoHandoverPlaybook | null
}

export interface RepoHandover extends RepoHandoverData {
  startHere: string
}
