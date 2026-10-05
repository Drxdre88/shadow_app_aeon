# Living Dominions — design for approval (05/10/2026)

**Answer first:** Vorath decides what to pay attention to in about ten separate places, and every one of them treats all your Dominions as equal and always alive. Nothing looks at where you actually work. The fix is one nightly activity score, a new "dormant" state for quiet areas, one ranked list that every part of Vorath uses, and a membership table so boards and code projects can belong to areas properly. Vorath then proposes where new work belongs, and you approve.

Nothing has been built. This page is for your approval.

---

## 1. What we found

### Why Vorath keeps talking about idle areas
- There is no single "focus" step. About ten parts of Vorath (the 06:00 message, the nightly area summaries, the self-model, the weekly review, the question of the day, chat, ideas and others) each build their own list of Dominions: "every one that isn't archived, in your sort order".
- Every idle Dominion still gets a fresh nightly summary, because its written vision counts as "something to say". Those summaries then feed the 06:00 message, the self-model, the questions and chat.
- The weekly review judges goals by the date they were last edited. That is where "all six STP HQ gateways untouched since 8 Sep" came from.
- Idea generation deliberately aims at *empty* areas, and the question picker hunts for areas you haven't reflected on. Both push Vorath toward idle areas.

### Where your work actually is (last 30 days, live database, read-only)

| Area | Activity score | What drives it |
|---|---|---|
| STP Asset Trading | 265 | AS Sprint: ~150 cards finished, 355 moves |
| Shadow Lab | 180 | research lab sessions, AI Mission Control, RND boards |
| Swarm | 143 | Swarm sessions (157), quant harness boards |
| VORATH | 51 | Aeon coding sessions (67); its own boards are idle |
| Shadow Apps | 18 | Antares, ARQ sessions |
| STP Dev | 1 | almost nothing |
| STP HQ | 0 | goals last edited 8 Sep |
| STP Spec, STP Quant | 0 | idle since spring |

Scoring used: finished card 3, card you created 1, card an agent created 0.3, move 0.2, coding session 2, hand-written memory 0.5, fading over about 10 days.

### What's broken in the filing
- **Seven active code projects belong to no area:** ermac, relic, dmc, wraith, rift, triad, vulcan (~70 sessions this month). Their sessions get filed by guesswork: ermac's 21 sessions landed in 6 different areas.
- **AI Mission Control is filed under Shadow Lab**, although most of its cards are Aeon/Vorath work.
- **Finished cards leave the board** when vaulted, so "cards finished" must come from the activity history, not the board.
- **92% of memories are machine-made** and spread evenly across areas, so they say nothing about where you work. They are left out of the score.
- **Deleting a Dominion loses its goals and code-project links permanently** and leaves its boards and memories unfiled, with nothing that re-files them. **Archive instead of delete** during clean-up, but don't archive every area: several nightly jobs only run if at least one area is not archived.

---

## 2. The design

**A. One activity score, every night.** Per board, per code project and per area. It counts cards finished and created, card moves, coding sessions and your own notes. It fades over ~10 days, caps one-off bursts (like the 26–27 Sep harness run), and ignores machine-made memories.

**B. "Dormant" is its own state.** It is separate from archived.
- An area with no meaningful activity for about 21 days goes dormant automatically. Any new activity wakes it.
- A dormant area gets no nightly summary. It drops out of the 06:00 message, the weekly review, the question of the day and the idea gap-filling. Its memories stay fully searchable.
- **Pin:** you can pin an area to keep it awake whatever the score. Vorath only says "important but quiet" about pinned areas. (Vorath's point: strategy and the Delta model live in your head, not on cards, so a score alone would put them to sleep wrongly.)

**C. One ranked list.** Every part of Vorath uses the same list of areas, most active first, with dormant ones marked. This replaces the ~10 copies.

**D. A membership table.** Boards and code projects (later also concept clusters) can belong to one or more areas. Each link has a weight, a note of who proposed it (you or Vorath) and a status (proposed, active or rejected). It replaces today's code-project list. The board's single area link stays as a mirror for older code.

**E. Vorath proposes, you decide.**
- Each week Vorath looks at work that belongs nowhere: unmapped code projects, boards with no area, scattered sessions. It proposes filing them, or a new area for them.
- **Approve / Reject** works in the inbox and on Telegram. **Rename** works in the inbox.
- There is a weekly cap, and a rejected proposal is never made again.
- **Merge** comes later. Only you retire or delete an area.

**No graph database:** everything lives in the existing Aeon database. Membership is a small table, and the existing nightly concept clustering can seed bucket ideas later.

---

## 3. Phases

| Phase | What | You see |
|---|---|---|
| 0 — now, no code | You approve mapping the 7 code projects and moving AI Mission Control to VORATH (data edits). Archive, don't delete, during clean-up. | Vorath's next nights file sessions correctly |
| 1 — foundation (watch-only first) | A–D behind one switch. Week 1 = watch-only: scores and dormant flags appear in Vorath → Health, nothing he says changes. Then switch on. | "Where your time went" ranking in Health; then a 06:00 led by your live areas, a weekly review that judges active work |
| 2 — proposals | E: Approve/Reject/Rename proposals for unfiled work and new areas | Up to a few proposals a week in the inbox and Telegram |
| 3 — later | Merge, concept-seeded areas, per-user (multi-user plan) | — |

**Phase 1 build outline:** one database migration (activity score, last-active date, dormant/pinned status on areas, plus the membership table seeded from today's code-project list). One nightly scoring job. One shared ranked-list function. Gates the nightly summaries skip for dormant areas. The weekly review, 06:00, questions and ideas read the ranked list. A Health panel. Tests throughout. One switch: off, watch-only, on.

---

## 4. Your decisions

1. Approve the design (A–E) and the phases?
2. Phase 0 now: map ermac, relic, dmc → STP Asset Trading? wraith, rift, triad, vulcan → Shadow Apps? Move AI Mission Control → VORATH?
3. Dormant after about 21 quiet days: right length?
4. Which areas to pin from day one? Vorath suggests asking you about STP HQ rather than letting the score decide.

---

### Technical appendix (for the build)
- Ranked-list seam: replace `findDominionsByUser().filter(!archivedAt)` / `listActiveDominions` and inline copies (archetype/cortex handlers, archetypes.ts:353, cortex.ts:479, concept handler, weekly-review/inputs.ts:555, ask-mine.ts:181, aether.ts:105, daily-message-inputs.ts:101, data/ask.ts:431).
- Synthesis gates: `hasArchetypeSignal` (archetypes.ts:166), cortex `hasSignal` (cortex.ts:392, handler :101) → false for dormant.
- Objective readers: idea-inputs.ts:69, weekly-review/inputs.ts:294, kairos-rapport.ts:85 → drop/down-rank dormant.
- Orderers: daily-message-inputs.ts `readAreaHeadlines` (rank, not cortex time); ask-mine staleness (data/ask.ts:411) and atlas targets (ideas/atlas/targets.ts:25) skip dormant.
- Don't reuse `archivedAt`: crons enrol users only with ≥1 non-archived Dominion (cron/aether-regen:24-27 etc.).
- Resolver gaps: repo and project resolution ignore `archivedAt` (dominions.ts:112-123, 371-378); `resolveDominionByRepo` picks an arbitrary row when a slug maps twice.
- Membership table: `dominion_members(user_id, dominion_id, kind board|repo|concept, ref, weight, source owner|vorath, status proposed|active|rejected, evidence jsonb, last_signal_at, timestamps, UNIQUE(user_id, kind, ref, dominion_id))`; `dominions += activity_score, last_active_at, state active|dormant, pinned`. Keyed by user (projects.dominion_id is shared across realm members).
- Proposals reuse `PROPOSAL_KINDS` (proposal-decision.ts:155) + inbox + Telegram `p:` buttons; Rename needs a payload field; Merge is new.
- Activity sources: `activity_events` (use 'completed', not `completed_at`), session-summary memories by `sourceMetadata.repo`, hand-written memories. Exclude cron/system memories and board snapshots. Normalise repo slugs vs `repo:*` labels.
- Hand-written SQL migration (repo convention), reviewed, versioned.
