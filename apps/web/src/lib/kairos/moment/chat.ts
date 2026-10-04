import { coldReadEnabled } from '@/lib/kairos/cold-read/flag'
import { guardChatReply } from '@/lib/kairos/chat-turn-reply'
import { loadStageBlock } from '@/lib/kairos/stage'
import { hasMomentHook, runChatContext, runFinishReply, runStripFooters } from './index'
import type { MomentChatContext, MomentChatOptions, MomentReplyContext } from './types'

// Chat side of the moment seam: one options loader for buildAssistantTurn
// (stage + cold read + lane prompt parts), one reply finisher for every
// persisted reply, one footer strip for replayed history.

export async function loadMomentChatOptions(
  userId: string,
  ctx: Omit<MomentChatContext, 'userId'>,
): Promise<MomentChatOptions> {
  const [stage, extras] = await Promise.all([
    // The stage (KAIROS_STAGE=1). Never throws — '' when off or empty.
    loadStageBlock(userId),
    runChatContext({ userId, ...ctx }),
  ])
  return {
    ...(stage.block ? { stageSection: stage.block } : {}),
    ...(coldReadEnabled() ? { coldRead: true as const } : {}),
    ...extras,
  }
}

// The P0 cut-short guard first, then each lane's finisher (a throw passes the content through).
export async function finishChatReply(
  userId: string,
  threadId: string,
  raw: string,
  meta: Omit<MomentReplyContext, 'userId' | 'threadId'>,
): Promise<string> {
  const content = guardChatReply(raw, meta.finishReason)
  if (content !== raw) {
    console.warn('[kairos-chat] reply did not finish cleanly, trimmed', {
      finishReason: meta.finishReason,
      rawChars: raw.length,
      keptChars: content.length,
    })
  }
  if (!hasMomentHook('finishReply')) return content
  return runFinishReply(content, { userId, threadId, ...meta })
}

export function stripMomentFooters(content: string): string {
  return runStripFooters(content)
}
