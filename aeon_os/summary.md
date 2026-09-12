# Aeon OS: one accountable operating model

**Direction consolidated: 7 September 2026.** [Open the visual overview](aeon_os_overview.html).

[Pilot test readiness (10 September 2026)](test_readiness.md): checked baseline, launch gates and evidence requirements.

## The outcome

Submit five meaningful objectives, specify constraints, authorize execution, and return to five durable, independently reviewed outcomes without coordinating terminals. Blocked work stays visible. Five objectives means independently managed work, not five unrestricted simultaneous writers.

**Aeon OS spans the existing applications, not another orchestration product.** Extend Hangar with dependable delivery, bounded coordination and explicit acceptance. Use expensive reasoning at decision points, not in an always-running supervisory conversation.

## One system, clear responsibilities

| Component | Owns | Does not own |
|---|---|---|
| **Operator** | Objectives, constraints, authorization and required acceptance | Routine process supervision |
| **Aeon** | Durable cards, scope, plans, routing decisions, attempts, questions, review receipts and output references | A model's implicit conversational state |
| **Kairos** | Persistent intent, context, synthesis, priorities and proposed next work | Unrestricted permission to create or execute work |
| **Secretary role** | Bounded interpretation and coordination using Aeon state and Kairos context | A second control plane or permanent conversation |
| **Hangar** | Claims, approved CLI launches, process supervision, events, cancellation and result transport | Deciding that an executor's claim equals accepted work |
| **Covenant** | Research method, evidence, provenance and accepted domain knowledge | Generic session storage or workforce scheduling |
| **Swarm / Hive** | Domain tools, research, strategy evaluation and live-performance feedback | Cross-repository engineering orchestration |

**Astra is the proposed initial secretary model, not another product or another name for Kairos.** Fresh secretary sessions resume from recorded checkpoints; Sol specialists and configured reviewers remain available. Interactive, mission and subagent models are separate settings. This document changes none.

## Execution and trust

The objective lifecycle is:

`NEW -> TRIAGED -> DISPATCHED -> RUNNING -> REVIEW -> DONE`

`BLOCKED`, `FAILED` and `CANCELLED` are explicit dispositions. An objective can span several attempts; an attempt can contain several specialist assignments. Process exit, objective completion, independent review, human acceptance, publication, merge and deployment are different events.

**Recorded authorization gates TRIAGED -> DISPATCHED.** Before launch, persist scope, repository, permissions, outputs, budgets and review policy. Capture artifacts before cleanup; bind independent review to the exact delivered revision. `DONE` requires the declared acceptance gates.

Mission states are not board-column names. Mission Control uses **Live** for work/questions, **Landing Zone** for review, and **Done only after operator approval**; a single attempt must not close an unfinished workstream.

| Independent choice | Examples |
|---|---|
| **Role: who is responsible?** | Developer, quant analyst, scout, reviewer, operations observer |
| **Objective: what is delivered?** | Implement, bug fix, reconnaissance, analysis, plan |
| **Route: how is work organized?** | Auto, direct, specialist, plan then execute, parallel lanes, execution only |
| **Runtime: where does reasoning run?** | Approved CLI/engine, model, identity, environment and capability set |

Respect the preferred route within authorization; record deviations and reasons. Mission and subagent concurrency are separate. An understood task does not automatically need a planning agent.

Use a universal **RunReceipt** for execution, outputs, evidence, review and limitations. Research additionally produces a **Note**: claim, evidence/as-of time, falsifier and verdict, with full provenance and verifiable citations. Coding receipts are not research Notes.

Code stays authoritative in its repository; accepted research in its governed corpus. Candidate files are not accepted knowledge. Aeon stores work/review references; Kairos receives authorized summaries and pointers. Never silently overwrite Covenant's human-authored context.

## Existing foundation versus missing behavior

| Existing foundation | Work still required |
|---|---|
| AI cards, manual launch, opt-in launch-on-drop, database claims, three CLI adapters | Objective controller, persisted route policy and bounded secretary turns |
| Heartbeats, cancellation, transcripts, result envelopes and mission worktrees | Expiring ownership, recovery, bounded retries and safe restart reconciliation |
| Result handling and session-capture infrastructure | Durable artifact delivery, strict objective completion, independent review and guaranteed outcome-to-memory linkage |
| Kairos questions, board-signal gathering and scheduled synthesis | Authorization-bound dispatch linkage, not self-authorized execution |
| Covenant sources/Note schemas and Swarm tools/skills | Governed research packs, reusable accepted findings and portable capability contracts |

The handoffs identify important delivery defects: cleanup can discard uncommitted reports; runner publication can push despite a prompt saying otherwise; `needs_input` can coexist with process-level success; result movement assumes Hangar columns rather than Mission Control's workflow. These require explicit application policy, not stronger prompts.

Current health, runner availability, model defaults and quotas are **not established here**. Historical reports are not live status. Hosted Aeon can queue work; opening it does not start an authenticated workstation runner.

## Five workstreams, one delivery sequence

| Workstream | What gets built | Sequence |
|---|---|---|
| **1. Reliable mission delivery** | Artifact retention, explicit publication permissions, objective-specific acceptance, workflow mapping and recoverable supervision | First: transport-only flight, then dependable delivery |
| **2. Bounded coordination** | Role/route contract, recorded authorization, replaceable Astra secretary and separate review assignments | After delivery is dependable |
| **3. Reusable research evidence** | Research Pack / NoteDraft interface, complete provenance, review states and accepted-finding retrieval | Attach to one research pilot |
| **4. Scheduled domain work** | Opt-in recurring missions and a separate Swarm/Hive live-results feedback track | Schedule only after review/recovery gates |
| **5. Morning decisions** | One concise inbox for results, blockers, health and decisions requiring the operator | Close the pilot, then scale to five objectives |

Swarm live-feedback can proceed independently: it supports trustworthy strategy promotion, **not** generic coding orchestration. Deflated Sharpe and decay controls are proposed domain mechanisms, not performance guarantees.

Start with one supervised, transport-only mission: no edits, report file, commit or push. Then prove durable delivery and recovery, bounded coordination, one research cycle, and finally a five-objective batch. Include worker loss, duplicate delivery, stale review and quota exhaustion in the acceptance scenarios.

## Non-negotiable boundaries

- **Authorization:** initiative signals create proposals. Schedules require pre-approved scope, roles, repositories, tools, limits and expiry. `recommended_tasks[]` remains deduplicated proposals, not automatic cards or launches.
- **Board discipline:** workstream cards, checklist phases, detailed session records. No automated flood of micro-cards.
- **Permissions:** enforce write, publication, merge, deployment and data access in the runner/control layer. Role prompts are not security boundaries.
- **Isolation:** existing Hangar creates worktrees, including at concurrency one; the active delegation convention uses one checkout. Resolve that policy explicitly before autonomous dispatch. Serial capacity alone does not resolve it.
- **Cost:** approved included entitlement first, never silent paid fallback. Subscription access is neither unlimited compute nor automatic approval for company data; shared-service authentication differs from personal CLI use.
- **Health:** verify current supervision and feedback before unattended expansion. Show stale or unknown state honestly.

## Source context and status

This consolidates the operating-model research, the supplied Kairos-capability session and the Astra/card-driven-development handoff. Navigation references: `docs\kairos\30-initiative-engine.md`, `docs\aeon-flight-manual-0709.html`, `apps\kairos-worker\src\poller.ts`, `apps\web\src\lib\data\sessions.ts`, and `apps\web\src\lib\data\validators\hangar.ts`.

Provider boundaries: [Copilot enterprise billing](https://docs.github.com/en/copilot/concepts/billing/organizations-and-enterprises/usage-based-billing), [Claude SDK authentication](https://code.claude.com/docs/en/agent-sdk/quickstart), and [Codex workspace automation](https://learn.chatgpt.com/docs/enterprise/access-tokens). Actual organizational entitlement and policy still require confirmation.

**Status: direction and visual reference only.** No scheduler, secretary, service, model-policy change, trading action, mission launch, publication or deployment is authorized or performed by these documents.
