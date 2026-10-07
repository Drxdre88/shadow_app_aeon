import type { decideKairosInboxProposal, listKairosInbox } from '@/lib/actions/kairos-inbox'

export type InboxData = Awaited<ReturnType<typeof listKairosInbox>>
export type InboxItem = InboxData['items'][number]
export type VoiceNoteItem = Extract<InboxItem, { kind: 'voice_note' }>
export type ProposalItem = Extract<InboxItem, { kind: 'proposal' }>
export type GoalVerdict = 'approve' | 'veto'
export type GoalDecision = Awaited<ReturnType<typeof decideKairosInboxProposal>>
