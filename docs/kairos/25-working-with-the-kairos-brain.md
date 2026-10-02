# Set up and use Kairos

*The owner's one-page guide. No code. Current as of Kairos 0.19 (web chat on Max, Paid backup switch).*

**Status:** living doc · 02/10/2026

Kairos is your second brain inside Aeon. It remembers what you work on, thinks about it every night,
sends you one message in the morning, and answers when you talk to it. **The thinking runs on your
Claude Max plan.** A paid API key is optional and only ever a backup.

Everything below lives in one place: **Kairos setup** in the sidebar (the *Set up Kairos* checklist).
Each step gets a ✓ by itself once Aeon sees it working.

---

## 1. The two required steps

**Step 1 — Connect Aeon to claude.ai.**
Click *Add to Claude* in the checklist. It opens claude.ai's "Add custom connector" form already
filled in (name `aeon`, your Aeon address). Review it, click Add, and sign in to Aeon when asked.
The ✓ appears once claude.ai has used the connector in the last 7 days.

**Step 2 — Create the Kairos brain routine.**
On claude.ai/code/routines click *New routine* and copy the name, prompt and model from the checklist
(or paste the checklist's */schedule* request into Claude Code). Give it only the `aeon` connector.
Pick *Hourly* — runs outside 01:00–07:00 UTC simply find nothing to do. From then on Kairos does all
its nightly thinking on your Max plan.

If you set Kairos up before October 2026, delete the old routines on claude.ai: *Kairos thinking,
ideas, morning, dusk, dawn, tidy* and *kairos-brain-tick*. The brain routine replaces them all.

That's it. Next morning the Status view should say "N on Max · 0 on backup".

---

## 2. Optional extras

| Extra | What you get | How |
|---|---|---|
| **Chat on Max** | Kairos answers on the Kairos page and on Telegram using your Max plan | Create the *Kairos chat* routine (no schedule, add an API trigger), then set `ROUTINE_CHAT_ID`, `ROUTINE_CHAT_TOKEN` and `KAIROS_CHAT_ROUTINE=1` in Vercel and redeploy. One routine serves both web and Telegram. |
| **Telegram** | The 06:00 message on your phone, and chat from anywhere | Follow `apps/web/docs/kairos/telegram-setup.md`, then press *Send test message* in the checklist. |
| **Coding-session capture** | Every Claude Code, Codex or Copilot session you finish becomes a memory | Copy the hook snippet for your tool from the checklist (details in doc 05). ✓ per tool once a session lands. |
| **Voice notes** | Long thoughts dictated on your phone | In the Claude app, dictate and say "save this as a Kairos voice note". It waits in your inbox until you confirm the words are yours. |
| **Watched boards** | Kairos follows a board daily or weekly and writes about it | In Kairos setup → Watched, set a board to *Daily* or *Weekly*. |
| **API key (backup)** | A safety net when a Max routine misses a job | Settings → AI. Only used while the Paid backup switch is on (§4). |

---

## 3. Daily rhythm

- **06:00 (UK time) — one message.** In the inbox and on Telegram. It covers what moved, what to
  watch and any belief changes, and ends with every question Kairos is still waiting on, numbered
  (`Q12 · 3 days · …`).
- **Answering questions.** On Telegram, reply `Q12: your answer` (several at once is fine) or
  `skip Q12`; Kairos confirms in one line, and anything else you type is normal chat. In the inbox,
  each open question has its own answer box.
- **Inbox.** The bell on the Kairos page. Open questions, proposals and voice notes wait there.
  Accept what is right, dismiss the rest. Nothing Kairos suggests becomes "your belief" until you
  accept it.
- **Chat.** Talk to Kairos on the Kairos page or Telegram — it is one conversation memory either way.
  Overnight, yesterday's chats become memories.
- **Mondays.** A weekly review (plan vs actual, belief changes, best ideas) and, until you have one,
  a first draft of your constitution to review.

The one habit that matters most: **when you decide something, tell Kairos** ("reflect into Aeon:
we're parking mobile"). Your own words carry the most weight.

---

## 4. The Paid backup switch

In Kairos setup. **On by default.** It decides whether Kairos may spend your own API key when the
Max plan didn't do a job.

| A job the Max routine missed | Switch on | Switch off |
|---|---|---|
| Nightly thinking (summaries, patterns, self-model, ideas, question of the day…) | Done on your key by its backup cron or the hourly sweep | Skipped; it waits for the next night |
| 06:00 message | Written on your key | Still sent, as plain text built without AI (free) |
| A chat reply | Answered on your key | Kairos says "I couldn't answer on your Max plan just now — try again in a minute." |

With no key saved there is nothing to spend, so the backup can't run either way. The checklist shows
how many jobs the backup answered in the last 7 days.

---

## 5. Troubleshooting

| You see | Do this |
|---|---|
| Connector step never ticks | In claude.ai → Connectors, check `aeon` is connected (sign in again if it says so), then ask Claude "list my Aeon projects". |
| "0 on Max" in the morning | Open the routine on claude.ai: is it enabled, on *Hourly*, with the `aeon` connector? Check its last run for errors. Max usage limits can also block a night — the backup covers it if the switch is on. |
| Chat says it couldn't answer on Max | The chat routine didn't pick up in time. Check `KAIROS_CHAT_ROUTINE=1`, `ROUTINE_CHAT_ID` and `ROUTINE_CHAT_TOKEN` in Vercel, and that the routine has an API trigger. |
| Telegram test fails | Check `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OPERATOR_CHAT_ID`, and that you've messaged the bot at least once. |
| No 06:00 message on Telegram | It is still in the inbox. Check the bot settings above and press *Send test message*. |
| A session didn't show up | Check the hook is installed for that tool and points at your Aeon checkout (doc 05). |
| Too many paid calls | Turn the Paid backup switch off, or fix the routine that keeps missing. |
