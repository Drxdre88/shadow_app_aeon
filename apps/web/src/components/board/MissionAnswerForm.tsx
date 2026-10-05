'use client'

import { useState } from 'react'
import { CircleHelp, Loader2, Send } from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import { loadHangarActions, recordLocalLaunch } from './MissionAutopilotPanel'

/** One answer box per agent question; answered ones are appended to the next run's instruction. */
export function MissionAnswerForm({ projectId, taskId, questions }: { projectId: string; taskId: string; questions: string[] }) {
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ''))
  const [busy, setBusy] = useState(false)
  const answered = questions
    .map((question, index) => ({ question, answer: (answers[index] ?? '').trim() }))
    .filter((item) => item.answer.length > 0)

  const submit = async () => {
    if (answered.length === 0) return
    setBusy(true)
    try {
      const session = await (await loadHangarActions()).answerAndRelaunch(projectId, taskId, answered)
      recordLocalLaunch(taskId, session.id)
      setAnswers(questions.map(() => ''))
      toast('Answers sent — the mission is queued again')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not relaunch the mission')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-amber-400/25 bg-amber-500/[0.08] p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-200 mb-2">
        <CircleHelp className="w-3.5 h-3.5" /> Input required
      </div>
      <ol className="space-y-3">
        {questions.map((question, index) => (
          <li key={`${question}-${index}`} className="space-y-1.5">
            <p className="text-sm text-amber-50/90">{question}</p>
            <textarea
              aria-label={`Answer to question ${index + 1}`}
              value={answers[index] ?? ''}
              onChange={(e) => setAnswers((current) => current.map((value, i) => (i === index ? e.target.value : value)))}
              placeholder="Your answer"
              rows={2}
              className="w-full px-2.5 py-1.5 rounded-lg bg-black/20 border border-white/[0.1] text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50"
            />
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={submit}
        disabled={busy || answered.length === 0}
        className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--primary) 18%, transparent)',
          borderColor: 'color-mix(in srgb, var(--primary) 35%, transparent)',
          color: 'var(--primary)',
        }}
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Answer &amp; relaunch
      </button>
    </div>
  )
}
