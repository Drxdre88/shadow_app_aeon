import type { CockpitSession, CockpitStaleCard } from '@/lib/data/morning-cockpit'

// Where each cockpit row is acted on. Predictions, questions, promises and
// proposals are decided in the Vorath inbox; cards and missions on their board.

export const VORATH_HREF = '/vorath'

export const boardHref = (projectId: string) => `/project/${projectId}`

export const staleCardHref = (card: CockpitStaleCard) => boardHref(card.projectId)

export const sessionHref = (session: CockpitSession) => (session.projectId ? boardHref(session.projectId) : VORATH_HREF)
