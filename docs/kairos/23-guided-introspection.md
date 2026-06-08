# Guided Introspection (propose-not-commit)

**Status:** shipped 2026-06-06
**Scope:** `apps/web/src/lib/kairos/introspection.ts`, `apps/web/src/lib/kairos/introspection-prompt.ts`, cron `apps/web/src/app/api/cron/introspection`.
**Sits on:** the Dominion / cortex / archetype substrate from doc 06 and doc 12, and the `kairos_reflect` reflection tool (doc 12 §"Reflections — the owner's signal").

This is the first time the brain **thinks on its own initiative** — and it's deliberately the smallest possible version of that. Once a day, per Dominion, Kairos reads its own recent substrate and **proposes** a handful of grounded thoughts for the operator to review. It never commits a belief. Every proposal must cite real memory ids or it's discarded. The operator turns a proposal into canon with `kairos_reflect`; dismisses it with archive.

---

## The design philosophy: "chaos for seeing, control for changing"

Generation is cheap and a little wild; commitment is narrow and gated. The model is free to roam over the substrate and surface tensions, connections, and questions — that's the **chaos for seeing**: divergent, low-stakes, useful precisely because it notices what the operator might miss. But nothing it generates changes the brain's actual beliefs. Turning a proposal into a canonical signal is a single, explicit, human gesture — that's the **control for changing**: convergent, high-stakes, always operator-driven.

This is the resolution to the obvious failure mode of an autonomous memory system: **drift**. A system that writes its own beliefs and then reads them back compounds its own errors until it's confidently wrong. By splitting *seeing* from *changing*, the system gets the upside of autonomous reflection without the runaway.

### The autonomy gradient — L0 → L4 (we are at L1)

| Level | What the system may do | Status |
|---|---|---|
| **L0** | Read-only. Retrieve, summarise, brief. No self-generated content. | shipped (briefer, cortex) |
| **L1** | **Propose.** Generate grounded candidate thoughts; the operator commits/dismisses. | **← we are here** |
| **L2** | Commit low-risk proposals automatically (e.g. high-confidence connections), operator can veto. | future |
| **L3** | Act within bounded mandates (open cards, schedule, draft) under earned-trust gates. | future |
| **L4** | Self-directed initiative across Dominions. | aspirational |

Each level only unlocks once the level below has demonstrated it doesn't drift. We don't skip rungs.

### The anti-drift levers (why L1 is safe)

1. **Gated commitment.** Proposals are staged `type='inbound'`, `streamClass='agentic'` — weighted **below** the operator's reflections in synthesis until promoted. They never silently become beliefs.
2. **Evidence citation.** Every proposal MUST cite ≥1 real memory id from the fed substrate. Ungrounded proposals are filtered out before they're written (`filterGroundedProposals`). This is the single biggest lever.
3. **Operator reflections as gravity.** The committed signal is a `reflection` (highest weight). The operator's beliefs are the fixed points everything else orbits; the system's proposals are perturbations, not anchors.
4. **Drift metrics / self-exclusion.** The runner explicitly **does not feed the model its own prior proposals** (`filter(m => m.type !== 'inbound')`) — so it can't cite its own un-committed thoughts and compound. Tensions/drift-from-vision are a *first-class* thing it's asked to surface, not suppress.

---

## How a run works (per Dominion, per UTC day)

`runIntrospectionForDominion(userId, dominionId)`:

1. **Guard** — Dominion exists, not archived. Idempotent per UTC day: if an introspection proposal already exists today (`sourceMetadata->>'introspection' = 'true'` created since `DATE_TRUNC('day', NOW())`), return `existing` and stop.
2. **Gather context** (`gatherIntrospectionContext`) — `inspectDominion()` for recent substrate (limit 30) + the latest `cortex` body. Recent memories are filtered to **exclude prior proposals** (anti-drift lever 4). Skips with `no recent substrate` if there's nothing to reflect on.
3. **Prompt** (`buildIntrospectionPrompt`) — see below. Calls the operator's BYOK provider via `getProviderForTask(userId, { taskType: 'reflect', dominionId })`, `maxTokens: 2000`, `temperature: 0.4`. Missing/undecryptable BYOK keys → graceful `skipped`, never an error.
4. **Parse + ground** — extract the JSON block, validate against `introspectionOutSchema`, then `filterGroundedProposals(parsed, validIds)` drops any citation that isn't in the fed substrate and any proposal left with **zero** valid citations. Parse failure → `error` status (no rows written), the Dominion is never bricked.
5. **Write** — each surviving proposal becomes a staged memory:

```text
type:        'inbound'
streamClass: 'agentic'        // below operator reflections in synthesis
source:      'cron'
title:       proposal.title (≤255)
bodyMd:      proposal.body
links:       citations → { type: 'refers_to', target, target_kind: 'memory' }   // provenance trail
tags:        ['proposal', kind]
sourceMetadata: { introspection: true, kind, confidence, citations, runId, status: 'pending' }
```

The `refers_to` links mean the cosmic graph shows the **evidence trail** — you can trace any proposal back to the memories it was drawn from.

`runIntrospectionForUser(userId)` loops all active Dominions and aggregates results. A throw on one Dominion is caught and recorded as `error` for that Dominion only.

## The proposal contract

Four `kind`s — each is "what the operator might miss":

| kind | meaning |
|---|---|
| `reflection` | a candidate belief or priority worth considering |
| `tension` | a contradiction, or drift from the stated vision |
| `connection` | a non-obvious link worth drawing between two memories |
| `question` | a genuine open gap |

Each proposal carries `citations` (1–8 real memory uuids), a self-assessed `confidence` (0–1, low is fine and useful), `title` (≤120), `body` (≤800). The prompt's hard rules: **propose, don't assert · cite every claim · prefer tensions and non-obvious connections · be humble · ≤6 proposals, fewer-and-sharper · return an empty list if nothing's worth surfacing.** The prompt feeds the vision + current cortex explicitly and tells the model to *build on or challenge* the cortex, not restate it.

## The cron

`GET /api/cron/introspection` — Bearer `CRON_SECRET` (dev allows unauth when unset), `maxDuration = 300`. Eligibility = user has a non-archived Dominion **and** an active (non-revoked) BYOK credential. Returns `{ ran, proposalsCreated, byStatus, users }`.

**Suggested schedule: daily ~06:30 UTC, before the 07:00 Briefer** so the morning brief can surface the fresh proposals. Auth + iteration mirror `archetype-synthesis`. *(Not yet wired into `vercel.json` — add the entry there when you want it on the live schedule; it runs on-demand via curl until then.)*

---

## Operator loop: accept / dismiss

A proposal sits as a staged `inbound` memory. Two outcomes:

- **Accept → `kairos_reflect`.** The operator restates the thought as their own reflection (`kairos_reflect({ dominionId, bodyMd })`). That writes a `streamClass='reflection'` memory — the highest-weight signal — which is what actually shapes archetype + cortex synthesis. The proposal is *informational*; the operator's reflection is the commit. (Optionally archive the original proposal once promoted, so it stops re-surfacing.)
- **Dismiss → archive.** `update_memory({ archivedAt })` (or the feed's Acknowledge/Defer). It persists for retrospection but stops surfacing and is excluded from future introspection context.

Crucially: the operator never edits the proposal in place to "make it true." Committing is a deliberate re-authoring through `kairos_reflect`, which keeps the belief trail honest — the brain's canon is only ever things the operator actually said.

---

## Pitfalls

- **Don't let proposals feed themselves.** The self-exclusion filter (step 2) is load-bearing. If a future change starts including `inbound` rows in the introspection context, drift returns — that filter is the firebreak.
- **Empty proposal lists are a success, not a failure.** `status: 'created', proposalsCreated: 0` means "nothing was worth surfacing today" — that's the system being honest, not broken.
- **Grounding is enforced server-side, not trusted from the model.** Even if the model invents a uuid, `filterGroundedProposals` strips it. Never relax that to "trust the citations."
- **`streamClass='agentic'` must stay below `reflection` weight in synthesis.** That ordering is the whole point — if agentic proposals ever weighted equal to operator reflections, L1 would quietly become L2 without the trust gate.
