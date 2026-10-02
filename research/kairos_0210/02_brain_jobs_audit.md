## The short answer

No, not all of them were helping. Kairos had 18 kinds of thinking job and 7 routines. 14 of the jobs feed a real part of the brain; 4 were noise. The noise jobs were also the expensive ones: together they made about 90 of the roughly 120 model calls a day.

The new shape is **one routine on your Max plan** that does all scheduled thinking, plus **one routine for Telegram replies**. The paid key is kept only as a silent backup. If the routine misses a job, the backup runs it, and the new Connect screen shows it to you.

## The brain, part by part

| Brain part | Job | What it does for you | Verdict |
|---|---|---|---|
| Perception | Chat summaries | Turns yesterday's conversations into memories. It's the only way what you say reaches the brain | ✅ Keep, nightly |
| Memory | Patterns | Finds what keeps recurring in each area; chat and the area summaries read it | ✅ Keep, nightly |
| Memory | Concepts | Folds clusters of memories into lasting ideas that chat can always find | ✅ Keep, weekly |
| Memory | Memory upkeep (server, no AI) | Trust scores, merging, fading, promotion, undo | ✅ Keep. Being fixed today |
| Self-model | Area summaries | What Kairos understands about each area. Feeds the self-model and filing of new memories | ✅ Keep, nightly |
| Self-model | Self-model | The one picture of you that chat, the 08:00 message and ideas all read | ✅ Keep, nightly |
| Beliefs & conscience | Your beliefs | Pulls what you believe out of your own words; the only source of "your" beliefs | ✅ Keep, nightly |
| Beliefs & conscience | Drift and honesty checks | Checks he still answers in line with your constitution and stays honest | ✅ Keep, nightly |
| Beliefs & conscience | Two minds | Compares your beliefs with his own | ✅ Keep, Mondays |
| Creativity | Idea contest (two steps) | Generates ideas, then a sceptical judge keeps the best 1–3 | ✅ Keep, nightly |
| Voice | Question of the day | The one question he most wants to ask you; your answers become memories | ✅ Keep, nightly |
| Voice | Weekly review | Plan versus actual, belief changes, ideas | ✅ Keep, Mondays |
| Voice | 08:00 message | The single morning message | ✅ Keep, nightly |
| Voice | Telegram replies | Answers you on Telegram | ✅ Keep, on demand |
| Voice | 9 morning briefs | One per area each morning. The 08:00 message kept only 2 lines of each, and says itself it replaces them | 🗑️ Retire. The message now reads the area summaries directly |
| Creativity | Raw idea dump | Nine unfiltered idea lists a night, from before the idea contest existed | 🗑️ Retire. The contest replaced it |
| Self-questioning | Contradiction scan | Flags clashing memories in the inbox | 🗑️ Retire. All 20 notices since August are still unread, and most compare two tidy-up notes |
| Memory | Intraday tidy-ups | Up to 7 "today so far" notes per area a day | 🗑️ Retire. Only the next night reads them, and it copes without them |
| Memory | Sunday duplicate sweep (server) | Marks old duplicates | 🗑️ Retire. Nightly upkeep already merges duplicates |
| Voice | Brain-tick (3 a day on claude.ai) | A second voice speaking first | 🗑️ Delete on claude.ai. The 08:00 message already carries his question |

## Before and after

| | Before | After |
|---|---|---|
| Thinking jobs | 18 | 14 |
| Routines on claude.ai | 7 (3 live, 3 never created, plus brain-tick) | 2 |
| Model calls a day | about 120 | about 30 |
| Paid key | 7 job types last night | Backup only |
| When a new job is added | Edit a routine prompt by hand, or it runs on the paid key | Nothing to do. The routine takes whatever is due |
| Seeing if it works | Read job lists through the AI | Connect screen: last night on Max vs backup, per job |

## Why one routine works

Every job already has its own time window, and the server only hands out jobs that are due. So one routine that wakes at 01:40, 02:40, 03:40, 04:40, 05:40 and 06:40 UTC picks up each job in its window:

| Run (UTC) | Picks up |
|---|---|
| 01:40 | chat summaries, then patterns |
| 02:40 | area summaries, concepts (Sun), self-model, beliefs, drift checks |
| 03:40 | idea contest, question of the day |
| 04:40 | two minds (Mon) |
| 05:40 | weekly review (Mon), 08:00 message |
| 06:40 | anything that slipped |

The routine asks for "whatever is due" rather than a fixed list of job types. That fixed list is what went stale last night: new job types existed, but no routine was asking for them.

## What still uses the paid key

- The backup, only when the routine misses a job.
- The constitution drafter, once, until you accept the first constitution on Monday 05/10; after that it does nothing.
- Telegram replies, until you create the chat routine and paste its token into Vercel. The Connect screen walks you through it.

Search embeddings come from Voyage, not Claude, so they are not affected.
