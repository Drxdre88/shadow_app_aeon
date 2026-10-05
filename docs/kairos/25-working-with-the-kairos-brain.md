# Set up and use Vorath

*The owner's one-page guide. No code. Current as of Vorath 0.28 (Aeon 0.46).*

**Status:** living doc · 05/10/2026

Vorath (formerly called Kairos — same mind, same memories) is your second brain inside Aeon. It remembers what you work on, thinks about it every night,
sends you one message in the morning, and answers when you talk to it. **The thinking runs on your
Claude Max plan.** A paid API key is optional and only ever a backup.

Everything below lives in one place: **Vorath setup** in the sidebar (the *Set up Vorath* checklist).
Each step gets a ✓ by itself once Aeon sees it working.

---

## 1. The two required steps

**Step 1 — Connect Aeon to claude.ai.**
Click *Add to Claude* in the checklist. It opens claude.ai's "Add custom connector" form already
filled in (name `aeon`, your Aeon address). Review it, click Add, and sign in to Aeon when asked.
The ✓ appears once claude.ai has used the connector in the last 7 days.

**Step 2 — Create the Vorath brain routine.**
On claude.ai/code/routines click *New routine* and copy the name, prompt and model from the checklist
(or paste the checklist's */schedule* request into Claude Code). Give it only the `aeon` connector.
Pick *Hourly* — runs outside 01:00–07:00 UTC simply find nothing to do. From then on Kairos does all
its nightly thinking on your Max plan.

If you set him up before October 2026, delete the old routines on claude.ai: *Kairos thinking,
ideas, morning, dusk, dawn, tidy* and *kairos-brain-tick* (all retired). The brain routine replaces them all.
Routines named *Kairos brain*, *Kairos chat* or *Kairos pulse* are **not** retired: rename them in place to
*Vorath brain / chat / pulse* and paste the new text from the checklist — don't delete them (the chat
routine's API trigger lives on it).

That's it. Next morning the Status view should say "N on Max · 0 on backup".

---

## 2. Optional extras

| Extra | What you get | How |
|---|---|---|
| **Chat on Max** | Vorath answers on the Vorath page and on Telegram using your Max plan | Create the *Vorath chat* routine (no schedule, add an API trigger), then set `ROUTINE_CHAT_ID`, `ROUTINE_CHAT_TOKEN` and `KAIROS_CHAT_ROUTINE=1` in Vercel and redeploy. One routine serves both web and Telegram. |
| **Telegram** | The 06:00 message on your phone, and chat from anywhere | Follow `apps/web/docs/kairos/telegram-setup.md`, then press *Send test message* in the checklist. |
| **Coding-session capture** | Every Claude Code, Codex or Copilot session you finish becomes a memory | Copy the hook snippet for your tool from the checklist (details in doc 05). ✓ per tool once a session lands. |
| **Voice notes** | Long thoughts dictated on your phone | In the Claude app, start with "note for Vorath" and dictate. It waits in your inbox until you confirm the words are yours. |
| **Watched boards** | Vorath follows a board daily or weekly and writes about it | In Vorath setup → Watched, set a board to *Daily* or *Weekly*. |
| **API key (backup)** | A safety net when a Max routine misses a job | Settings → AI. Only used while the Paid backup switch is on (§4). |

---

## 3. Daily rhythm

- **06:00 (UK time) — one message.** In the inbox and on Telegram. It covers what moved, what to
  watch and any belief changes, and ends with every question Vorath is still waiting on, numbered
  (`Q12 · 3 days · …`).
- **Answering questions.** On Telegram, reply `Q12: your answer` (several at once is fine) or
  `skip Q12`; Vorath confirms in one line, and anything else you type is normal chat. In the inbox,
  each open question has its own answer box.
- **Inbox.** The bell (labelled *Inbox*) on the Vorath page. Open questions, proposals and voice notes wait there.
  Accept what is right, dismiss the rest. Nothing Vorath suggests becomes "your belief" until you
  accept it.
- **Chat.** Talk to Vorath on the Vorath page or Telegram — it is one conversation memory either way.
  Overnight, yesterday's chats become memories.
- **Mondays.** A weekly review (plan vs actual, belief changes, best ideas) and, until you have one,
  a first draft of your constitution to review.

The one habit that matters most: **when you decide something, tell Vorath** ("reflect into Aeon:
we're parking mobile"). Your own words carry the most weight.

---

## 4. The Paid backup switch

In Vorath setup → Health. **On by default.** It decides whether Vorath may spend your own API key when the
Max plan didn't do a job.

| A job the Max routine missed | Switch on | Switch off |
|---|---|---|
| Nightly thinking (summaries, patterns, self-model, ideas, question of the day…) | Done on your key by its backup cron or the hourly sweep | Skipped; it waits for the next night |
| 06:00 message | Written on your key | Still sent, as plain text built without AI (free) |
| A chat reply | Answered on your key | Vorath says "I couldn't answer on your Max plan just now — try again in a minute." |

With no key saved there is nothing to spend, so the backup can't run either way. The checklist shows
how many jobs the backup answered in the last 7 days.

---

## 5. What Vorath knows

The book icon at the top of the Vorath page (*What Vorath knows about you*) opens a drawer with two tabs.

- **What Vorath knows** — what he believes about you, grouped by area, each with an "I believe this
  because…" line. Open one to see **why he knows it**: who wrote it (you, an AI agent, Vorath himself or
  outside content), where it came from (chat, coding session, card, voice note), how sure he is, and its
  history with dates and Undo.
- **Fix it in place:** *Edit* the words, *It's right* (it becomes yours), or *This is wrong* (set aside
  with your reason; reversible). Your constitution and goals change only through their own flows.
- **Needs your eyes** — low-trust notes, beliefs to re-check and held private topics, each with
  *Confirm* or *Remove*. Nothing is hidden silently.
- **Ask me before using private topics** (bottom of the drawer, off by default): new notes about health,
  family, money, legal matters or religion/politics are held out of his thinking until you confirm them.

## 6. Where your time went (living areas)

Every night at 01:10 UTC Vorath scores each area, board and code project from real activity: cards
finished and created, card moves, coding sessions and your own notes. Recent work counts most; his own
machine-made notes don't count. **Vorath setup → Health → Where your time went** ranks your areas, marks
each one *Active*, *Dormant* or *Pinned*, shows when you last worked in it and its top boards and code
projects, and lists work that belongs to no area. Pin an area there to keep it awake whatever the score.

It ships switched off. Set `KAIROS_LIVING_DOMINIONS` in Vercel:

| Value | What happens |
|---|---|
| unset or `0` | Off — nothing changes. |
| `observe` | Scores and dormant flags are worked out and shown in Health. Nothing Vorath says changes. |
| `1` | An area with no activity for 21 days goes dormant (`KAIROS_DORMANT_DAYS`, 7–90); any new activity wakes it. Dormant areas get no nightly summary and drop out of the 06:00 message, the weekly plan, the question of the day and idea gap-filling; the weekly review calls them "quiet by choice". Their memories stay searchable, and the 06:00 message leads with your most active areas. |

Dormant is not archived — archived areas behave as before. For AI clients and scripts: `get_dominion_focus`
/ `GET /api/v1/dominions/focus` reads the ranking, and `update_dominion` / `PATCH /api/v1/dominions/{id}`
accept `pinned`.

## 7. Vorath sorts new cards

Off by default, per board. The board's creator switches it on in **Edit Project → Vorath sorts new cards**.
During the hourly brain run on your Max plan (no paid backup, no routine change needed) Vorath looks at
new cards and suggests labels the board already has, a priority and possible duplicates, each with a
reason. They appear in a *Vorath suggests* block on the card: **Accept** or **Dismiss** each one (for a
duplicate, *Yes, same work*). Nothing changes until you accept.

## 8. Other switches

| Setting | Default | What it does |
|---|---|---|
| `KAIROS_LIVING_DOMINIONS` | off | `observe` or `1` — see §6. `VORATH_LIVING_DOMINIONS` works too. |
| `KAIROS_DORMANT_DAYS` | 21 | Days without activity before an area goes dormant (7–90). |
| `KAIROS_HANGAR_STALE_MIN` | 30 | Minutes a Hangar mission's runner may go quiet before the 15-minute check marks it timed out (card moves to Tower, Requeue to retry) or flags a never-claimed mission "Runner offline". |

Settings may also be named `VORATH_*` on the Aeon web app (Vercel); each sets its `KAIROS_*` twin.
The local worker and scripts still need the `KAIROS_*` names.

---

## 9. Troubleshooting

| You see | Do this |
|---|---|
| Connector step never ticks | In claude.ai → Connectors, check `aeon` is connected (sign in again if it says so), then ask Claude "list my Aeon projects". |
| "0 on Max" in the morning | Open the routine on claude.ai: is it enabled, on *Hourly*, with the `aeon` connector? Check its last run for errors. Max usage limits can also block a night — the backup covers it if the switch is on. |
| Chat says it couldn't answer on Max | The chat routine didn't pick up in time. Check `KAIROS_CHAT_ROUTINE=1`, `ROUTINE_CHAT_ID` and `ROUTINE_CHAT_TOKEN` in Vercel, and that the routine has an API trigger. |
| Telegram test fails | Check `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OPERATOR_CHAT_ID`, and that you've messaged the bot at least once. |
| No 06:00 message on Telegram | It is still in the inbox. Check the bot settings above and press *Send test message*. |
| A session didn't show up | Check the hook is installed for that tool and points at your Aeon checkout (doc 05). |
| An area shows Dormant but you still use it | Pin it in Health → Where your time went, or check its boards and repos are linked to that area. |
| No card suggestions appear | Check the board's *Vorath sorts new cards* switch is on (only the board's creator can turn it on) and that the brain routine ran in the last hour. |
| Too many paid calls | Turn the Paid backup switch off, or fix the routine that keeps missing. |
