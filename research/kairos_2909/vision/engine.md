# The memory engine

> **The point:** good thinking does not come from dumping notes into a database. It comes from a loop that runs every day: **weigh, age, back up, challenge, merge, learn from your reaction.** This tab is that loop.

## Two numbers on every memory

| Number | Meaning | When it changes | Who reads it |
|---|---|---|---|
| **Standing** | How much he trusts and values this memory overall | Every night, and straight away when you react | Chat, daily message, search, galaxy, night thinking |
| **Relevance** | How well it fits the question being asked right now | At the moment of asking | Chat and search only |

What he pulls up = **relevance × standing**. Today there is no standing at all: fresh and loud beats true and important. We also have two ranking systems that disagree, and the final step ignores how old things are. The engine replaces both with one.

## What goes into standing

| Ingredient | In plain words | Example |
|---|---|---|
| **Who said it** | You beat your tools, your tools beat his guesses | Your reflection 1.0 · test result 0.8 · your chat 0.6 · his own idea 0.3 |
| **How fresh** | Everything fades, at different speeds | Session notes fade in weeks, ideas in a month, beliefs in months, your reflections in a year |
| **Used again** | Being used or confirmed refreshes it | Cited in an answer you liked, so the fading resets |
| **Backed up** | Separate evidence, on different days | Three sessions on three days agree: strong. He repeats himself three times: counts once |
| **Outcome** | What happened when it was acted on | Card shipped, idea you acted on: up. Vetoed or ignored: down |
| **Challenged** | Open contradictions pull it down until settled | "Hive is the priority" vs a week spent on Swarm |
| **New** | Does it add anything he did not already know | Near-copies of existing memories add nothing |

Each ingredient is a small separate part. You can tune, test or swap one without touching the others.

## The loop, and when each step runs

| Step | What it does | When | Thinking needed? |
|---|---|---|---|
| **1. Gate** | New note: add it, update an old one, or ignore it as a repeat | On arrival | Light |
| **2. Weigh** | Recompute standing for anything touched | Every 3 hours, and nightly for everything | No, maths only |
| **3. Age** | Apply fading. Nothing is deleted, old things just sink | Nightly | No |
| **4. Back up** | Count independent support. "Maybe" beliefs that earned it are promoted, the rest decay | Nightly | No |
| **5. Challenge** | The critic asks "what would prove this wrong?" and checks it against the records | Nightly | Yes, deep reasoning |
| **6. Merge** | Fold repeats into one clearer concept. Keep the old version so it can be undone | Nightly | Yes |
| **7. Contest** | New ideas compete. Only 1 to 3 survive (phase 3) | Nightly | Yes |
| **8. Learn from you** | Your answer, tap, veto or silence changes standing and trust at once | When you react | No |
| **9. Check himself** | Did last month's promotions hold up? Adjust how much each source is trusted | Weekly | Yes |

Every change is written down with its reason. That is what makes "undo" and "why do you believe this?" possible.

## How it is built

- **A class-based engine made of small parts.** One conductor runs the loop. Each step is its own class with one job, and plugs in. The standing score is built the same way from the ingredient parts.
- **The maths runs inside the app.** Weigh, age, back up and learn-from-you are plain arithmetic: fast, free, fully testable, and they run even if every model is down.
- **The thinking steps plug in.** Challenge, merge, contest and check-himself go through one "reasoner" socket. The app prepares the work, a model thinks, and the app checks and saves the answer. The app, not the model, creates every record ID, which removes the whole class of bug that broke the night thinking.
- **The same socket takes two brains.** One is the paid API, as today. The other is Claude on your Max plan (next tab). The engine does not care which one answered.

```ts
const engine = new MemoryEngine({
  steps: [new Gate(), new Weigh(standing), new Age(), new BackUp(), new Challenge(reasoner), new Merge(reasoner), new Contest(reasoner)],
  standing: new Standing([new SourceTrust(), new Freshness(), new Support(), new Outcome(), new Challenged(), new Novelty()]),
  reasoner, // ApiReasoner today, ClaudeMaxReasoner on your subscription
  changes: new ChangeLog(), // every change + reason, powers undo
})
await engine.runNight(userId)
```

## TypeScript or Python?

**TypeScript, all the way.** There is no Python in Aeon today, and this engine does not need any.

| | TypeScript | Python |
|---|---|---|
| Runs where the data is | ✅ same app, same database, same deploy | ❌ a second server to host and keep alive |
| Shares the record shapes and checks | ✅ one definition | ❌ copied, and the copies drift |
| Tests | ✅ existing suite, including random property tests for the maths | ❌ a second test setup |
| Heavy maths or machine learning | 🟡 not needed: the scores are simple and the database handles the vectors | ✅ only worth it if we later train our own ranking model |

If we ever want to train a ranking model on your reactions, that is an offline study in the research lab. It still would not justify a Python service here.
