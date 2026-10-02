## The short answer

Start the new session at **Phase 1: settle the brain.** For one quiet week, check that Kairos runs every night on your Max plan, with no paid spend and no surprises. Every later phase builds on that. After Phase 1, Kairos gets initiative (Phase 2) while your beta users' requests are cleared in parallel (Phase 3). He gets hands only once he has earned trust (Phase 4). Clean-up and the people-based Gantt come last.

| Phase | Goal | Size | Starts |
|---|---|---|---|
| 1 | Prove the new brain runs every night on Max, with no paid spend | S · ~1 week | Now |
| 2 | Kairos proposes goals and keeps promises; you approve or veto | M | After Phase 1 |
| 3 | Clear the beta users' asks and close stale review cards | M | Alongside Phase 2 |
| 4 | Make agent missions safe, then let Kairos draft them | L | After 2–4 clean weeks of Phase 2 |
| 5 | Pay down structural debt and refresh the docs | M–L | Any time, best after Phase 3 |
| 6 | Chronos: the Gantt becomes a people-based scheduler | L | When you decide on groupings |

## Phase 1 — Settle the brain (about one week)

**Why now.** Kairos changed a lot in three days (0.16 → 0.19). The first live night failed, and the fixes have not yet proved themselves over many nights. Phase 2 gives him initiative, which is only safe on a brain that runs reliably.

**Your actions (about 15 minutes in total):**
1. In Aeon, open **Kairos setup** and finish the two required steps: connect Aeon to Claude (one click), and turn on the **Kairos brain** routine.
2. Delete the old routines it lists, including `kairos-brain-tick`.
3. Optional: create the **Kairos chat** routine, paste its token into Vercel and set `KAIROS_CHAT_ROUTINE=1`, so the web page and Telegram answer on Max.
4. ~~Decide the Paid backup switch~~ — done: off since 02/10.
5. Monday 05/10: accept (or amend) your first constitution in the inbox.

**Build (small):**
- Stop anything except you from archiving the live constitution.
- Limit which thinking jobs a routine may claim and submit.
- Archive a night's idea candidates even when both judges fail.
- Time the chat routine (web and Telegram) and record it.

**Done when:**
- The memory engine is OK for 7 nights in a row.
- Kairos setup → Health shows at least 95% of jobs answered on Max.
- The 06:00 message arrives 7 of 7 days.
- The constitution is accepted.
- Zero paid calls, or the switch is off.

## Phase 2 — Initiative, first slice

**Why.** The research verdict from 02/10: build goals, promises and approve/veto together, investigations only, and hold the "hands" back.

**Scope:**
- **Goals of his own:** at most one a night, and none is fine. At most two active at once. Seeded from accepted ideas and from goals that failed before. He may never set a goal about his own continuity, permissions, schedule, budget or memory.
- **Promise list:** only dated promises with a named outcome, 10–15 open at most. A daily check reads something Kairos cannot write. He can never close his own promise.
- **Escalation:** one line in the 06:00 message. At most one Telegram nudge per promise, and only when it is more than 2 days late.
- **Approve / Veto / "Veto + why"** buttons on Telegram. No answer means no action, and a repeat tap does nothing.

**Done when:** 14 nights in, the acceptance rate and the done-and-checked rate are recorded, and no promise has been closed by Kairos himself.

## Phase 3 — Beta users wave

**Why.** Live beta users have been waiting since spring while the Kairos work ran.

**Scope:**
- The four beta requests: a cleaner way to add people to groups, virtual groups, dragging checklist items to reorder them, and a slightly larger description window.
- Markdown in chat replies.
- Rescue card attachments (rebase the parked branch and apply its migration safely).
- Close the Landing Zone cards that only wait on your visual check.

**Done when:** the four requests are in Done and the Landing Zone holds three cards or fewer.

## Phase 4 — Missions as hands

**Why only now.** Kairos must prove he picks good goals first, and the agent missions still have safety gaps.

**Scope:**
- Close the mission safety gaps: ID checks on every route, a membership check when starting a mission, recovery when a runner dies, and reliable result delivery.
- Kairos drafts an investigation mission and you press launch.
- Daily and concurrent caps, a network allow-list, and no mission may start another mission.

**Done when:** five Kairos-drafted investigations have each passed the review gate and your sign-off.

## Phase 5 — Clean house

**Scope:**
- Move every direct database access into the data layer.
- Split the oversized files.
- Share one cron security check instead of copying it.
- Close the undo gaps.
- Add the first browser smoke test.
- Prune old branches.
- Refresh the architecture and vision docs.

**Done when:** no database imports outside the data layer, no hand-written file over 500 lines, and CI green.

## Phase 6 — Chronos people lanes

**Scope:** the Gantt becomes a scheduler laid out by person, using the engine that is already built but not connected.

**Waits on:** your decision about dropping the non-person groupings.

## Decisions

**Settled (02/10):**
- ✅ **Paid backup: off.** Switched off in production on 02/10. Kairos never uses your API key; a missed job waits for the next run.
- ✅ **Initiative rules (Phase 2):** one goal a night (none is fine), investigations only, always ask first, promises raised in the 06:00 message.

**Still open:**
1. **Chat on Max:** create the chat routine so the web page and Telegram answer on Max. Until then, with paid backup off, chat replies say "I couldn't answer on your Max plan".
2. **Chronos:** drop the non-person groupings so the scheduler can be laid out by person?
3. **Mobile app:** provide the Google sign-in IDs to restart it, or keep it parked another quarter?