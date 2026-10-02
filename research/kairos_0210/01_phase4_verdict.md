## The short answer

The handover is accurate. I checked it against live data and found two small corrections and one new detail about the failure. Kairos 0.16 is on main: both pull requests merged on 01/10 at about 21:10 UK time. The memory engine failure is real and has to be fixed before Phase 4.

All four Phase 4 tracks are worth building, but each needs changes, and the fourth (missions as hands) should wait. Build goals, promises and buttons together as one small first slice, investigations only. Give him hands after two to four weeks of clean record.

## Handover check against live data

| Claim in the handover | What the live data says | Verdict |
|---|---|---|
| 0.16 is live | PRs #141 and #142 merged 01/10. This laptop's copy is still on 0.15 and needs a pull before any work | ✅ |
| Memory engine failed | The health page marks it "failed" for 02/10. It failed at 01:34 UTC, which is 02:34 UK time, so both times you've seen are right. | ✅ |
| Backlog stopped at 166 of 400 | The backlog step wrote about one change per second, so 400 would take about 7 minutes. That is why it ran out of time. | ✅ new detail |
| 8 of 9 area summaries, beliefs, ideas and today's message ran on Max | Confirmed: 8 area summaries answered by the routine, 1 by the backup | ✅ |
| Briefs, contradictions, archetypes and the idea dump ran on the backup | Confirmed: every one of them shows the backup took over | ✅ |
| Drift checks ran on Max | **No.** Last night's honesty and drift checks were answered by the paid backup. They all passed | 🟡 correction |
| 9 brief and 9 idea-dump jobs still "queued" | **Already resolved.** They now show "expired, backup ran", so there's nothing to tidy | 🟡 correction |
| Today's message delivered | Sent at 08:00 UK by the routine | ✅ |
| Health alarm | No alert yet: it only fires after two bad nights. **Tonight is the second night**, so the fix should land today | ⚠️ |

## What he can do now versus before 30/09

| Before 30/09 | Now (0.16) |
|---|---|
| Half-blind: missed coding sessions, agent missions and most board work | Sees every coding session, every Hangar mission and the sprint boards |
| Every memory counted the same and nothing ever faded | Memories earn trust, fade, merge and get promoted, and every change can be undone |
| No stable views; one paid-key summary a night | Two sets of beliefs (yours and his own), a constitution only you can change, nightly drift and honesty checks |
| Trusted his own past notes as much as your words | Knows where each memory came from; his own echoes can't raise his confidence |
| A raw nightly idea dump nobody read | A nightly idea contest that keeps 1–3 ideas, with the reason each survived |
| Several noisy messages a day | One 08:00 message and a Monday weekly review |
| All thinking on the paid key | Thinking on your Max plan first, with the paid key as backup (once the routines are switched) |
| Broken jobs: blocked questions, runaway text, made-up ids | Fixed |

The one thing he still can't do is act on his own. He thinks, remembers and suggests, but he never sets himself a goal, keeps a promise, or does anything about it. That is what Phase 4 adds.

## What Phase 4 means

Phase 4 moves him from suggesting to following through. He proposes a goal, you approve it, he keeps a promise about it, and something outside him checks whether it happened. Later he gets to start investigation missions himself.

## Verdict per track

| Track | Verdict | Biggest change the research asks for |
|---|---|---|
| A. Goals of his own | 🟢 Build, with changes | 1 goal a night, and none is fine. He must never be the one who confirms a goal is met |
| B. Promise list | 🟢 Build, with changes | Track only dated promises with a clear outcome. Escalate in the 08:00 message, not by Telegram nudges |
| C. Approve or veto buttons | 🟢 Build, with changes | Ask rarely. No answer means no action. Add a "veto + why" option |
| D. Missions as hands | 🟡 Build later | Wait 2–4 weeks for A–C to show a clean record, then start with him drafting and you pressing launch |

## A. Goals of his own

**Why it's sound.** The game-world research holds up. Voyager found more when it picked its next goal from its own record, and it fell apart without a real success check. OMNI-EPIC repeated itself less when it kept an archive of past goals and had a novelty check.

**What doesn't carry over.**
- That research comes from games, where the success check can't be fooled. Kairos can move cards himself, so "the card moved" proves nothing unless **you** moved it.
- The "learning progress" score in the handover comes from MAGELLAN, which retrains the model. Kairos only calls the model, so that score can't be measured. Replace it with two numbers: how often you accept his goals, and how often they get done and checked.

**Changes.**
1. One goal a night, zero allowed, and at most two active at once. In a 2026 study, people lost trust after a single badly timed suggestion.
2. Seed goals from accepted ideas and from goals that failed. Use the most similar past attempts, not random ones; OMNI-EPIC showed random picks do worse.
3. Investigation goals only at first.
4. Widen the ban. Besides "never a goal about keeping himself running", ban goals about his own permissions, schedule, budget or memory. Lab tests show models resisting shutdown when a goal is at stake.
5. Show goals in the 08:00 message, not as push alerts.

**Caution.** I found no published acceptance rate for any real assistant that proposes its own goals. ChatGPT's daily proactive feed, Pulse, was reportedly replaced in June 2026 (low confidence). His own numbers will be the first real evidence, so measure from day one.

## B. Promise list

**Why it's sound.** The core idea is well supported: an outside check beats the model checking itself. Models are poor at correcting their own work without outside feedback, and frontier agents have been caught gaming their own graders.

**Corrections to the handover's evidence.**
- The "keeps only 48–66% of its promises" figure is real (CivBench, September 2026). But it comes from a small trial of 23 runs inside a strategy game, and it measures whether a plan was carried out within 10 game turns. Quote it with that caveat.
- Anthropic's long-running agent guide lets the agent tick its own "passes" box after testing. Our rule that only the check can close a promise is stricter. That's a fair choice, but it's ours, not Anthropic's.

**Changes.**
1. Log only promises with a date and a named outcome, taken from goals and the weekly review. Leave out chat phrases like "I'll look into it". Keep no more than about 10–15 open.
2. Two kinds of check: an automatic one (card column, merged PR, passing test) or a one-tap confirmation from you. If neither fits, don't log it.
3. At each Monday review, renegotiate or drop overdue items; never let them pile up.
4. Escalate with one line in the 08:00 message. Send at most **one** Telegram nudge per item, only for important items more than 2 days late. Hospital alert studies show every extra or repeated reminder cuts the response rate.
5. A daily check is enough; hourly adds nothing for one person.
6. Kairos must not have write access to whatever the check reads.

## C. Approve or veto buttons

**Why it's sound.** Telegram supports everything needed, and the reply handler already exists.

**The real risk is fatigue, not the technology.** Anthropic reports that people approve 93% of Claude Code permission prompts and stop reading them. A tap is a weak safety gate unless asking is rare.

**Changes.**
1. Ask rarely, a few times a day at most, and fold asks into the 08:00 message where possible. Don't ask about read-only or undoable work; log it with an undo link instead.
2. Each card shows what changes, what it touches, the risk, the cost cap, how to undo it, and what will check it.
3. No answer means no action. Cards expire and the buttons disappear with "Expired, not run".
4. Make taps safe to repeat. A second tap does nothing, and only taps from you, in your private chat, count.
5. Three options: Approve, Veto, and "Veto + why", with quick reasons (wrong priority / not now / too risky). With one owner, bare yes/no taps pile up too slowly to teach him much.
6. Track how fast you approve. If nearly everything is approved within seconds, he should ask less.
7. Keep "runs unless you veto" switched off until the numbers show a clean record.

## D. Missions as hands

**Why wait.** Real-repo success rates for coding agents are still far from reliable, and agents passing work to other agents often fail at checking the result. He should prove he picks good goals (A–C) before he gets hands.

**Changes.**
1. A read-only mission isn't automatically safe. A mission that reads repos or web pages, and has internet access or secrets, can be tricked into leaking data. Give missions a short network allow-list and no secrets, and treat the mission report as untrusted data.
2. A mission report alone can't close a goal. It needs the independent review gate plus your sign-off.
3. Hard limits, not alerts: missions per day, missions running at once, and no mission may start another mission.
4. For the first weeks, he drafts the mission and you press launch.

**Plan terms.** Scheduled routines on your Max plan are an official, permitted feature. Anthropic doesn't say clearly whether a script launching extra Claude Code sessions on your account counts as "ordinary individual use". Missions also eat into the same weekly allowance his nightly thinking needs. Two safe options: give missions their own small daily cap, or run them on a pay-per-use key with a hard spending limit.

## Recommended order

1. **Today:** fix the memory engine. It writes one change at a time, about one a second. Batch those writes and the backlog fits in its time limit. Tonight is the second bad night, when the health alarm fires.
2. **Today or tomorrow:** switch the six routines, then check that every job says "answered by routine". Include the drift checks.
3. **Monday 05/10:** accept or amend the first constitution draft; read the first full weekly review.
4. **Phase 4, first slice:** build A, B and C together, investigation goals only, one a night, ask-first.
5. **After 2–4 clean weeks:** add D with drafted missions and owner launch, then consider "runs unless you veto" for low-risk investigations.

## Sources (all checked 02/10/2026)

- Voyager (2023): https://arxiv.org/abs/2305.16291
- OMNI (2023): https://arxiv.org/abs/2306.01711
- OMNI-EPIC (2024): https://arxiv.org/abs/2405.15568
- MAGELLAN (2025): https://arxiv.org/abs/2502.07709
- Anthropic, harnesses for long-running agents: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic, agentic misalignment: https://www.anthropic.com/research/agentic-misalignment
- Shutdown resistance (2025): https://arxiv.org/abs/2509.14260
- Proactive-assistant timing study (2026): https://arxiv.org/abs/2609.37267
- CivBench (2026): https://arxiv.org/abs/2609.02459
- LLMs can't self-correct reasoning yet: https://arxiv.org/abs/2310.01798
- METR, reward hacking: https://metr.org/blog/2025-06-05-recent-reward-hacking/
- Alert fatigue (Ancker 2017): https://pubmed.ncbi.nlm.nih.gov/28395667/
- Telegram Bot API: https://core.telegram.org/bots/api
- Anthropic, Claude Code auto mode (93% approval): https://www.anthropic.com/engineering/claude-code-auto-mode
- MAST, multi-agent failures: https://arxiv.org/abs/2503.13657
- Lethal trifecta: https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
- Claude Code routines: https://code.claude.com/docs/en/routines
- Claude Code legal and compliance: https://code.claude.com/docs/en/legal-and-compliance
