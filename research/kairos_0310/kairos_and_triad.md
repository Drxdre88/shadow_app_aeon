# Kairos and Triad — what Kairos needs to become

3 October 2026. Read only: nothing was changed in Aeon or Triad.

## The short answer

**Kairos's mind stays in Aeon. His body moves to Triad.**

Aeon keeps what makes him *him*: his memory, his beliefs, his constitution and the nightly thinking. Triad becomes where he *lives*: where you talk to him live, where he speaks up, where you approve what he wants to do, and later where he does work, right next to your other agents and your job alerts.

That changes the old plan in three useful ways:

1. **He doesn't need the cloud chat routine.** Triad already runs his replies on your own PC, on your Max plan. So the "create the chat routine and paste two values into Vercel" chore goes away. Four small Aeon changes replace it.
2. **Approve / Veto moves to Triad.** The buttons I built for Telegram also belong in Triad, but there is a gap: Aeon has to be sure it's really you pressing them.
3. **His "hands" become Triad sessions,** not Aeon board missions. Triad already has live sessions where you approve each step. That's the safe way to let him do work.

## The old plan, in plain words

Yesterday's plan had six steps. Here's what each meant and where it stands:

| Step | What it meant | Where it stands |
|---|---|---|
| 1. Settle the brain | Prove the new nightly thinking runs every night on your Max plan, with no paid spend | ✅ Night 1 of 7 was clean: 25 of 25 jobs done on Max |
| 2. Initiative | He proposes his own goals and keeps promises; you approve or veto | 🟡 Built, switched off |
| 3. Beta users | Clear the four requests your beta users made | Not started (Aeon product work) |
| 4. Hands | He drafts small investigation jobs; you press launch | Not started |
| 5. Clean house | Tidy Aeon's code | Not started (Aeon product work) |
| 6. Chronos | The Gantt laid out by person | Waiting on your decision |

Steps 3, 5 and 6 are about Aeon the board app, not Kairos. They carry on separately.

## Where Triad is going

- **One place where people, AI agents and job alerts work together,** inside our network. Version 1 is merged.
- **A cockpit for live AI sessions:** Copilot today, Claude, Codex and Gemini next. You see every session, and you approve risky steps with Allow once / Allow for session / Deny. Built, not merged yet.
- **Alerts you can answer:** Dagster, Hive, Swarm and ARQ alerts arrive as cards, and later a "Start fix session" button opens a session in the alert thread.
- **Kairos as a member:** a small program on your PC (the "bridge", already built in Triad) logs him in as `@kairos`. He answers only you, on your Max plan, and posts his morning message, questions and promises as cards. It has never run live.

## What to keep in Kairos, and where

| Piece | Keep it in | Shows up in |
|---|---|---|
| Memory, beliefs, constitution, self-model | Aeon | Used in his replies; never shown raw |
| Nightly thinking (the brain routine) | Aeon + claude.ai | Morning message, weekly review |
| When he's allowed to speak (gaps, daily limits, quiet while waiting for you) | Aeon | Applies to every channel |
| Questions (Q12…) | Aeon | Triad cards with Answer / Skip; Telegram |
| Goals and promises (the records) | Aeon | Triad cards with Approve / Veto; morning card |
| Live conversation | Aeon keeps the thread | Triad (`@kairos` DM), with Telegram as the phone fallback |
| Doing work ("hands") | Aeon records what he proposed | Triad sessions you approve step by step |
| Seeing what's happening ("eyes") | Aeon stores it as memory | Triad alert and work channels you choose to share |

**Park, don't build:**

- **The cloud "Kairos chat" routine.** Triad's bridge does the same job on your PC.
- **Live sessions in Aeon's Hangar.** Already agreed: Triad owns live sessions, and Aeon keeps one-shot board missions.

## The new order

1. **Finish the 7 clean nights** (running now; nothing to do). Night 1: 25 of 25 on Max.
2. **Give him a voice in Triad.** I make the four Aeon changes the Triad bridge is waiting for: a chat route, a "triad" channel, claiming one specific job, and a longer reply deadline. You make two keys, then he's live in Triad. This also fixes chat on Max without the cloud routine. *(Small: about a day.)*
3. **Prove it's really you.** Aeon currently refuses any approval that arrives with a program's key, on purpose, so a program can never approve its own goal. Triad needs a separate, narrow "owner relay" key that only carries a decision Triad has already checked was pressed by you. *(Small to medium.)*
4. **Turn on initiative, with Triad as where you decide.** Goals and promises go live (already built). His proposals arrive as Triad cards, and Telegram stays as backup. Measure for 14 nights.
5. **Eyes.** He can read the Triad channels you choose (alerts, team threads), the same way watched boards work today. Then his morning message knows what actually broke overnight.
6. **Hands.** He proposes a read-only investigation session in Triad, and you press start and approve each step in the cockpit. This replaces the old step 4.

**What "comes alive" means here:** after step 2 he's present and talking where you work. After step 4 he has goals of his own. After step 5 he sees what you see. After step 6 he can act, but only with your hand on every step.

## Risks worth knowing

- **Your PC must be on** for him to talk in Triad, because replies run there. The nightly thinking doesn't need it.
- **Max plan terms:** he answers only you. Answering others on your plan is a grey area, so don't.
- **The owner-relay key is the most sensitive new piece.** It must only carry a decision, never act on its own.
- **Your PC needs to reach Aeon's web address** through the corporate network. That's untested.
- **Both apps are moving fast.** Triad's cockpit work isn't merged yet, so step 2 should land after it.

## Questions

1. Happy with "mind in Aeon, body in Triad"?
2. Shall I skip the cloud chat routine and make the four Aeon changes instead (step 2)?
