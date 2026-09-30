# Running Kairos on your Claude Max plan

> **The idea:** once your coding moves to the work Enterprise seat, your personal Max plan is free. Kairos's thinking moves there. Aeon keeps the memory, the maths and the delivery. Claude does the reasoning on your plan, on a schedule. The paid key stays only as a safety net.

## What Claude offers today (checked 30 Sep 2026)

| Feature | What it is | Fits Kairos? |
|---|---|---|
| **Routines** (Claude Code, cloud) | A saved prompt that runs on Anthropic's servers on a schedule, or when poked by a web call. Can read and write Aeon through your Aeon connector. Your laptop can be off | ✅ **the engine room**. The morning ping already runs this way |
| **Scheduled tasks** (Claude app, formerly Cowork) | Same idea inside the main Claude app. From **6 Oct** every new task on Pro and Max runs in the cloud with your connectors, even with your devices off. The "only on your computer" option goes away | 🟡 **backup runner**. No web trigger and no custom times, so routines stay primary. Good for tasks you start from your phone |
| **Workflows** (Claude Code) | One task fans out to many parallel helpers | 🟡 could run the per-area thinking in parallel inside the night routine. Try it in phase 1 |
| **Channels** (Telegram plugin for Claude Code) | Telegram messages go into a Claude Code session that must stay running on a computer | 🔴 needs an always-on machine. Not our route |
| **Voice mode** (Claude app) | Talk to Claude, and it can use connected tools | 🟡 should reach the Aeon connector. One report says custom tools fail in voice, so test it once |

**Limits:** a routine can run at most hourly on a schedule, or up to 30 times an hour when poked. Everything counts against your normal Max allowance, the same as chatting. How long a single run may last is not published, so we keep each run short.

## The one rule that shapes the design

Anthropic allows your Max plan to be used **through Claude's own apps** (chat, Claude Code, routines). It does **not** allow Aeon's server to call Claude using your plan's login in place of a paid key.

So **Claude comes to the brain for work.** The brain never calls Claude on your plan.

## How it works: the thinking queue

| Step | Who | What |
|---|---|---|
| 1. Jobs are posted | Aeon (cron, no model) | Each night Aeon posts thinking jobs: "patterns for Hive", "picture of everything", "challenge these 12 beliefs", "write the daily message" |
| 2. Claude picks them up | Routine on your Max plan | Claims the next job through the Aeon connector, gets a ready-made pack of evidence plus instructions, and thinks |
| 3. Answer handed back | Routine | Submits the answer through the connector |
| 4. Checked and saved | Aeon | Checks the shape, creates the record IDs, writes it, and records the change and the reason |
| 5. Safety net | Aeon | Any job not done by its deadline is run by Aeon itself on the paid key. If that also fails, a simple no-model version runs. You never get silence or junk |

This is the plug-in "reasoner" from the engine tab. The same job can be answered by Claude on Max or by the paid key, and Aeon checks both the same way. The Aether picture and dialogue already work like this today: Aeon prepares the pack, Claude thinks, then submits the result back. We generalise it.

## What runs where

| Job | Today | After the move |
|---|---|---|
| Night thinking: patterns, area pictures, picture of everything | Paid key, Aeon cron | ✅ Max routine "night shift", ~03:00 |
| Challenge, merge, idea contest, question for you | Paid key | ✅ Max routine "dawn shift", ~05:30 |
| Daily message | Paid key | ✅ Max routine, ~07:30, delivered at 08:00 |
| Pulse every 3 hours | Paid key | ✅ Max routine, hourly-capable |
| Morning and evening ping check | Max routine already | ✅ unchanged |
| Weekly review and self-check | Not built | ✅ Max routine, weekly |
| Weigh, age, back up, learn from you, snapshots, dedup, health | No model | Aeon, as before (maths only) |
| Search embeddings | Voyage | Aeon, as before (not a Claude service) |
| Telegram chat replies | Paid key | 🟡 see below |
| Voice | Claude app | ✅ your personal Claude app with the Aeon connector |

## Telegram chat on Max: the honest trade-off

| Option | How | Good | Bad |
|---|---|---|---|
| **A. Keep on paid key** | As today | Instant replies. Pennies a month (7 chats in September) | Not on Max |
| **B. Poke a routine** | Telegram message arrives at Aeon, which pokes a "chat" routine; Claude reads the thread, thinks, replies through Aeon | On Max, with full brain access and deeper thinking | Every message starts a cloud session, so a reply could take seconds to minutes (unmeasured) |
| C. Channels plugin | Always-on Claude Code on a computer | On Max | Needs a machine left running |

**Recommendation: B for chat, A as the automatic fallback.** Aeon replies "thinking…" straight away, pokes the routine, and falls back to the paid key if no reply lands in time. We measure the real delay in phase 1 before switching.

## What does not change

- **Your coding sessions are still captured.** The capture hooks live on your machine, not in your Claude login.
- **Aeon stays the single home of the memory.** Claude never keeps its own copy.
- **The paid key stays configured** as the fallback. Idle, it costs almost nothing.
- **Quality stays top tier.** Routines run on the best model your plan offers.
