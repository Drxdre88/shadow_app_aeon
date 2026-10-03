'use client'

import { useState } from 'react'
import { Send } from 'lucide-react'
import { getRoutine } from '@/lib/kairos/routines/catalog'
import type { KairosBrainStatus } from '@/lib/kairos/routines/status-types'
import { sendKairosTestMessage } from '@/lib/actions/kairos-brain'
import { CodeBlock, Dot, tint } from './brainUi'
import { Act, Actions, B as Bold, CheckAgain, Expect, PrimaryLink, Troubleshoot } from './setupUi'
import { RoutineForm } from './RoutineForm'

interface Props {
  status: KairosBrainStatus
  refreshing: boolean
  onRefresh: () => void
}

const CHAT_ENV = ['ROUTINE_CHAT_ID=trig_…', 'ROUTINE_CHAT_TOKEN=sk-ant-oat01-…', 'KAIROS_CHAT_ROUTINE=1'].join('\n')

export function ChatOnMaxBody({ status, refreshing, onRefresh }: Props) {
  const { routineFlagOn, routineConfigured } = status.telegram
  return (
    <>
      <p className="text-[12.5px] leading-relaxed text-white/65">
        A second routine answers you on your Max plan — on the Kairos page and on Telegram. Replies take a little longer
        than the paid key; the page shows “Kairos is thinking…” until the answer lands.
      </p>
      <div className="flex flex-wrap gap-2">
        <Flag on={routineFlagOn} text={routineFlagOn ? 'Replies via routine: on' : 'Replies via routine: off'} />
        <Flag on={routineConfigured} text={routineConfigured ? 'Trigger ID and token: set' : 'Trigger ID and token: missing'} />
      </div>
      <RoutineForm
        def={getRoutine('chat')}
        nowIso={status.generatedAt}
        finish={[
          <Act key="trigger" where="On the routine’s page">
            click <Bold>Add an API trigger</Bold> → <Bold>Generate token</Bold>. Copy the token and the trigger ID straight
            away — the token is shown once.
          </Act>,
          <div key="env" className="flex flex-col gap-2.5">
            <Act where="In Vercel → Project → Settings → Environment Variables">add these, with your trigger ID and token in place of the dots, then <Bold>Redeploy</Bold>:</Act>
            <CodeBlock lang="env" value={CHAT_ENV} />
          </div>,
          <div key="test" className="flex flex-col gap-2.5">
            <Act where="On the Kairos page or in Telegram">send Kairos a message.</Act>
            <Expect>He answers within a minute, and this step turns green.</Expect>
            <CheckAgain onClick={onRefresh} busy={refreshing} />
          </div>,
        ]}
      />
    </>
  )
}

// Daytime thinking (KAIROS_DAYTIME_THINKING=1, owner): the light pulse
// routine. Rendered only while the server reports the pulse as switched on.
export function PulseRoutineBody({ status, refreshing, onRefresh }: Props) {
  const pulse = status.routines.find((r) => r.id === 'pulse')
  if (!pulse || pulse.state === 'off') return null
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] leading-relaxed text-white/65">
        Daytime thinking is on. A second, lighter routine glances at your day once an hour and keeps short notes in
        Kairos’s memory of today. It only does work when something happened, never messages you, and never uses the
        paid key. Kairos brain picks up his daytime reflections on its own.
      </p>
      <div className="flex flex-wrap gap-2">
        <Flag on={pulse.state === 'live'} text={pulse.state === 'live' ? 'Pulse: running' : 'Pulse: not heard from yet'} />
      </div>
      <RoutineForm
        def={getRoutine('pulse')}
        nowIso={status.generatedAt}
        finish={
          <>
            <Act where="On the routine’s page">click <Bold>Run now</Bold> during the day, after you’ve done something in Aeon.</Act>
            <Expect>The pulse shows as running within a minute. With nothing new since its last look it just stops — that’s normal.</Expect>
            <CheckAgain onClick={onRefresh} busy={refreshing} />
          </>
        }
      />
    </div>
  )
}

function Flag({ on, text }: { on: boolean; text: string }) {
  const tone = on ? 'var(--success)' : 'var(--text-dim)'
  return (
    <span
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11.5px] border border-white/[0.10] bg-white/[0.03]"
      style={{ color: on ? tone : undefined }}
    >
      <Dot tone={tone} />
      <span className={on ? undefined : 'text-white/55'}>{text}</span>
    </span>
  )
}

function newSecret(): string {
  try { return crypto.randomUUID().replace(/-/g, '') } catch { return Math.random().toString(36).slice(2) + Date.now().toString(36) }
}

export function TelegramBody({ status, refreshing, onRefresh }: Props) {
  const [secret] = useState(newSecret)
  const hook = new URLSearchParams({
    url: `${status.appUrl.replace(/\/+$/, '')}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: '["message","callback_query"]',
  })
  const webhookUrl = `https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?${hook.toString()}`
  const env = [
    'TELEGRAM_BOT_TOKEN=<BOT_TOKEN>',
    'TELEGRAM_OPERATOR_CHAT_ID=<your Telegram id>',
    `TELEGRAM_WEBHOOK_SECRET=${secret}`,
    'KAIROS_OPERATOR_USER_ID=<your Aeon user id>',
  ].join('\n')

  return (
    <>
      <p className="text-[12.5px] leading-relaxed text-white/65">
        Your 06:00 message arrives in Telegram, and you can answer Kairos there (“Q12: …”).
      </p>
      <Actions>
        <>
          <PrimaryLink href="https://t.me/BotFather">Open BotFather</PrimaryLink>
          <Act where="In Telegram">send <Bold>/newbot</Bold> and pick a name and a username.</Act>
          <Expect>BotFather replies with a token like <span className="font-mono">123456789:AA…</span> — that’s your BOT_TOKEN.</Expect>
        </>
        <>
          <Act where="In Telegram">send your new bot any message, then message <Bold>@userinfobot</Bold>.</Act>
          <Expect>It replies with your Id — a number. That’s your Telegram id.</Expect>
        </>
        <>
          <Act where="In your browser">open this link, with your token in place of <span className="font-mono">&lt;BOT_TOKEN&gt;</span>:</Act>
          <CodeBlock lang="url" value={webhookUrl} />
          <Expect>Telegram answers <span className="font-mono">{'"ok":true'}</span> and “Webhook was set”.</Expect>
        </>
        <>
          <Act where="In Vercel → Project → Settings → Environment Variables">add these, then <Bold>Redeploy</Bold>:</Act>
          <CodeBlock lang="env" value={env} />
          <Expect>After the redeploy, this step turns green.</Expect>
          <CheckAgain onClick={onRefresh} busy={refreshing} />
        </>
        <>
          <TestMessage />
          <Expect>A message from Kairos arrives in Telegram.</Expect>
        </>
      </Actions>
      <Troubleshoot
        items={[
          ['The test says the bot isn’t set up', 'Check both Telegram lines are in Vercel and that you redeployed.'],
          ['The test is sent, but nothing arrives', 'Send your bot a message first — bots can’t write to you until you do. Then check the Telegram id.'],
          ['Your replies get no answer', 'Open the webhook link again with the right token; the secret in it must match TELEGRAM_WEBHOOK_SECRET.'],
        ]}
      />
    </>
  )
}

type TestState = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'failed'; error: string }

function TestMessage() {
  const [state, setState] = useState<TestState>({ kind: 'idle' })
  const send = async () => {
    setState({ kind: 'sending' })
    try {
      const res = await sendKairosTestMessage()
      setState(res.ok ? { kind: 'sent' } : { kind: 'failed', error: res.error ?? 'Telegram didn’t accept it.' })
    } catch (e) {
      setState({ kind: 'failed', error: e instanceof Error && e.message ? e.message : 'Couldn’t reach Aeon.' })
    }
  }
  const tone = state.kind === 'sent' ? 'var(--success)' : state.kind === 'failed' ? 'var(--error)' : null
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={send}
        disabled={state.kind === 'sending'}
        className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold text-white border transition hover:brightness-125 disabled:opacity-60"
        style={{ background: tint('var(--primary)', 18), borderColor: tint('var(--primary)', 55) }}
      >
        <Send className="w-3.5 h-3.5" />
        {state.kind === 'sending' ? 'Sending…' : 'Send test message'}
      </button>
      {tone && (
        <span role="status" className="text-[11.5px]" style={{ color: tone }}>
          {state.kind === 'sent' ? 'Sent — check Telegram.' : state.kind === 'failed' ? state.error : null}
        </span>
      )}
    </div>
  )
}
