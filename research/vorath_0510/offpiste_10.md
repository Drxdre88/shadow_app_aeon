# Off-piste: 10 additions for Aeon and Vorath (05/10/2026)

**Answer first:** the research points to one theme: **turn thinking into things that land, and make the AI visible and checkable.** Aeon already has the hard machinery: Vorath's memory, the Hangar, the scheduler and the connector. Most of these 10 connect existing pieces, so they are cheaper than they sound. Vorath reviewed the list. He moved the "landing" pair to the top and pushed the chat widgets to the next batch.

Sizes: **M** = 3–6 build days, **L** = 7–15 build days (one agent-day each, run in parallel waves).

---

## The 10

### 1. The landing loop — L
A second AI from a different company reviews every finished agent mission. A check step throws out false alarms, and a card reaches Done only when its pull request is green on CI. Green PRs wait in one list for your approve or veto.
- **Why now:** this is Vorath's own top idea this week ("a landing agent", 3 of 3 wins), and the biggest gap the Hangar docs list. The review logic already exists outside the app; this moves it inside.
- **Like:** Claude Code Review, GitHub Agent HQ, Cursor rollouts.

### 2. Capture anywhere → one-tap cards — L
Forward a Telegram message, share from your phone, or accept an idea, a goal or a voice note. Vorath turns it into a ready card (title, dates, labels, links), and you approve it in one tap on Telegram or the inbox.
- **Why now:** eleven ideas survived Vorath's tournament this week and none became work. Today accepting an idea only records it.
- **Like:** Trello Inbox, Todoist Ramble, Akiflow. It runs on your Max plan with no paid transcription.

### 3. Memory self-test — M
Every night Vorath sits a ~20-question exam built from your own history ("what did you believe about X before Y?", "what's past?", "do you actually know this?"). The score is shown in Health.
- **Why now:** it proves memory is getting better, not just bigger, and guards every later memory change. Vorath asked for this before any memory redesign.
- **Like:** the LongMemEval benchmark used by Mem0, Zep and Supermemory.

### 4. "What Vorath knows" — L
Readable pages of what Vorath believes about you and your work. Every belief has a plain "why do I know this?" trail back to the chat, session or card. You can fix or remove anything in place. A "needs your eyes" list shows low-trust writes (from agents or outside content) for you to confirm, and an opt-in gate covers sensitive topics. Nothing is hidden silently.
- **Why now:** the trust and history machinery is already built underneath. You just can't see or edit it.
- **Like:** Claude's editable memory, Letta memory files, ChatGPT memory controls.

### 5. Quiet monitors + daily receipts — M
Vorath watches for things that actually matter: a blocked card, a slipped date, a stalled goal, a red CI or a stuck mission. He speaks only when something changed, through his timing gate and Telegram, and holds non-urgent alerts for the morning. The 06:00 message gains a receipt line: "Yesterday agents moved 4 cards and opened 2 PRs; here's what I changed."
- **Why now:** today Vorath runs on a schedule only, and writes agents make to the board never reach the morning message.
- **Like:** ChatGPT's "notify only when worth reporting" tasks, Google CC's "what I did yesterday".

### 6. Ask Aeon — M
Ask anything about your work and get an answer that cites the exact cards (including finished, vaulted ones) and memories. Click through to the source, and save the answer as a card or note.
- **Why now:** Vorath's chat already cites memories. Finished cards are never searched today, and they're your real history.
- **Like:** Heptabase cited chat, Notion Q&A.

### 7. Plan my week — M
Aeon lays out your week from the board and Gantt, shades what's at risk and on the critical path, and previews the reshuffle before anything moves.
- **Why now:** the scheduling engine (Chronos, about 2,700 lines of tests) is fully built, but nothing in the app uses it yet. This is mostly connecting it to screens.
- **Like:** Motion, Reclaim, Trello Planner.

### 8. Hangar autopilot basics — M
Stalled agent runs are detected and re-queued automatically. Risky missions show their plan as a checklist for you to approve before they touch code. You can answer an agent's questions and relaunch in one click, and turn its suggested follow-ups into new mission cards.
- **Why now:** today a stuck run sits forever, and an agent's questions and follow-ups are read-only text.
- **Like:** Linear for Agents run states, Factory spec mode, Antigravity artifacts.

### 9. Connector 2.0 — M
Upgrade Aeon's AI connector to the 2026-07 standard. Claude and Copilot ask "delete 14 cards?" before destructive actions, sign-in for AI clients is modernised, and slimmer tool sets replace loading all 145 tools into every chat.
- **Why now:** the connector is a year behind. Copilot CLI already speaks the new standard. This is also the step that makes in-chat widgets possible.
- **Care:** this is the area of the June outage, so it ships with the sign-in smoke test and a fallback for older clients.

### 10. Vorath sorts new cards — M
New cards on your boards arrive with suggested labels, priority and possible duplicates, each with a one-line reason. Per board you choose show, auto-apply or off. A weekly "what's at risk" note writes itself.
- **Why now:** it's the obvious next step once cards flow in from capture (2). It starts on your own boards only, keeping shared-board privacy clean.
- **Like:** Linear Triage Intelligence, Notion agents.

---

## Build waves (swarm, disjoint files)

| Wave | Runs in parallel | Why this order |
|---|---|---|
| 1 | 1 Landing loop · 2 Capture → cards · 3 Memory self-test · 7 Plan my week | Vorath's top two, the memory guard, and the cheapest big win |
| 2 | 4 What Vorath knows · 5 Monitors + receipts · 6 Ask Aeon · 9 Connector 2.0 | memory UI after the test exists; monitors reuse 2's card drafts |
| 3 | 8 Hangar autopilot · 10 Vorath sorts new cards | 8 shares files with 1; 10 builds on 2 |

Each wave: one database change at most, run in watch-only first where it changes what Vorath says, a correctness review, a PR, and a sign-in check after deploy.

## Next batch (not in the 10)
- Live board and brief widgets inside Claude, ChatGPT and VS Code (after Connector 2.0)
- Triggered missions (nightly backlog groom)
- Runner presence, so teammates' missions don't wait on a sleeping PC
- 👍/👎 on individual lines of the morning brief

## Rejected, and why
- Live two-way voice: paid per minute, breaks the no-API-spend rule.
- Workflow-engine rewrite: a small checkpoint fix gets 80% of it.
- Canvas AI agent: the canvas is too basic today.
- Earned autonomy: conflicts with "only you decide goals and the constitution".
- Cost budgets: spend is already tracked and capped in the fleet.
- Swapping CLIs for SDKs: would bypass the fleet's memory and credit limits.

## Your decisions
1. Approve all 10, or strike any?
2. Start with Wave 1 (landing loop, capture → cards, memory self-test, plan my week)?
