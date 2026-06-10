# Working with the Kairos Brain

*A practical guide for you, the operator. No code — just how to use the brain day to day.*

**Status:** living doc · 2026-06-06

Kairos is your second memory. It quietly captures what you work on, organises it by **Dominion** (a strand of your work — a project, a product, a research thread), and serves it back when you need it. It also briefs you each morning and, lately, proposes a few thoughts of its own. Nothing it thinks up changes the record unless you say so. You stay in charge.

This page covers the five things you'll actually do.

---

## 1. Adding a memory or a reflection

Two kinds of things you'll put in by hand.

**A note / memory** — anything worth keeping: a decision, an idea, a snippet, a link. You don't have to title it; the brain will. Just create it (from the notes view, or by telling Claude "save this as a memory"). Sessions you finish in Claude Code get captured automatically — you don't lift a finger.

**A reflection** — this is the important one. A reflection is *you stating a belief, a priority, or a correction*. "We're parking mobile for now." "Lean GBM for the vol-regime model." "Stop flagging the pricing thing as drift." Reflections are the **highest-weight signal in the brain** — they steer how Kairos understands each Dominion and what it tells you in the morning brief. Fire one by telling Claude to *reflect* it into the right Dominion, e.g. *"reflect into the Aeon Dominion: we're committing to the workspace-first model, no hybrid tabs."*

Rule of thumb: **notes are facts, reflections are your judgement.** When you've made up your mind about something, make it a reflection — that's how the brain learns what you actually think.

---

## 2. Proposals — how Kairos suggests things, and how you accept or reject them

Once a day, Kairos reads each Dominion's recent activity and surfaces a few **proposals** — short candidate thoughts. They come in four flavours:

- a **tension** ("these two decisions seem to contradict each other")
- a **connection** ("this old idea relates to what you did yesterday")
- a **reflection** (a belief it thinks might be worth holding)
- a **question** (a gap it noticed)

Every proposal is **grounded** — it points back to the real memories it came from, so you can always check its evidence. And every proposal is **just a suggestion**. It is *not* a belief the brain holds. It's parked in an inbox waiting for your call.

**To accept one:** restate it as your own reflection (see §1). That's the deliberate "yes, I agree, make this canon" gesture. The proposal itself stays informational; *your* reflection is what counts.

**To reject one:** archive it. It's gone from your view, kept for the record, and won't come back.

Why the extra step instead of a one-click "accept"? Because the brain's record should only ever contain things *you actually said*. Making you re-author a proposal as a reflection keeps your belief trail honest and stops the brain from slowly drifting into its own assumptions. **Chaos for seeing, control for changing:** Kairos is free to notice anything; only you can change the record.

You're never obligated to act on proposals. An empty proposal day is normal and fine.

---

## 3. The daily BRIEF

Every morning (around 07:00) Kairos writes you a short **briefing per active Dominion** — where things stand, what moved, what to watch, and a suggested next step. It draws on everything in the brain, including any fresh proposals from earlier that morning. You'll see it on the dashboard.

- **Want it now, not at 07:00?** Ask for a brief on demand — *"brief me"* / `/kairos-brief` — and it regenerates today's briefing.
- **Regenerate after new info?** The dashboard's "Regenerate today" button archives the current brief and writes a fresh one.

The brief is advisory. It's Kairos thinking out loud about your work — read it, ignore it, or turn anything useful in it into a reflection.

---

## 4. How search works now

When you ask the brain "what do I know about X?" it does **two searches at once** and blends them:

- a **keyword** search (catches exact words and names), and
- a **meaning** search (catches the *idea* even when the words differ — ask about "mobile strategy" and it finds the "Capacitor pivot" note even though they share no words).

You don't choose between them — Kairos runs both and merges the best of each. The result is a tidy, ready-to-read package of the most relevant memories, newest and pinned items weighted up.

**What this means for you:** you don't have to remember the exact phrase you used. Ask in your own words. Pin the handful of things you always want surfaced — pinned memories get priority.

*(If the meaning-search ever isn't configured, search quietly falls back to keyword-only — you'll still get results, just slightly less clever ones. Nothing breaks.)*

---

## 5. Keeping the brain healthy — daily & weekly cadence

The brain mostly runs itself. A light touch keeps it sharp.

**Daily (2 minutes):**
- Skim the morning **brief** for each Dominion you're active in.
- Glance at any **proposals**. Accept the genuinely useful ones as reflections; archive the rest. Don't let them pile up — a cleared inbox keeps tomorrow's proposals relevant.
- Fire a **reflection** whenever you actually decide something. This is the single highest-value habit.

**Weekly (10 minutes):**
- Review your **reflections** per Dominion — do they still hold? Fire a fresh one to correct anything that's changed (a new reflection supersedes old thinking; you don't have to delete the old one).
- **Pin / unpin** so the always-relevant stuff stays on top and stale pins come down.
- Skim what got **auto-captured** — sessions, briefs, proposals — and archive obvious noise.
- Make sure each active strand of work has a **Dominion** so its memories land somewhere coherent.

**The one habit that matters most:** when you make a decision, reflect it. Everything else — capture, search, briefs, proposals — gets better the more the brain knows what you actually believe.

---

### Quick reference

| You want to… | Do this |
|---|---|
| Keep a fact / idea | Save a note (or just finish a Claude session — auto-captured) |
| Record a decision or belief | Fire a **reflection** into the Dominion |
| Accept a proposal | Restate it as a reflection |
| Reject a proposal | Archive it |
| Get today's brief early | "brief me" / `/kairos-brief` |
| Find something | Just ask in your own words |
| Always-surface something | Pin it |
