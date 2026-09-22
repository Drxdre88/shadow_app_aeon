# Agent OS: the next iteration before adoption

**22 September 2026 · v0.29.0 source baseline · planning, not release qualification**

## Executive decision

Do not start using Agent OS in production to discover the remaining product gaps. Finish a cohesive repository-to-deliverable workflow, qualify it with fixtures and an isolated environment, and obtain operator acceptance before adoption. The deployed mission-card release is a foundation, not evidence that this workflow is ready.

The next iteration should deliver this observable experience: **choose Swarm or another explicitly supported repository → see the actual host/environment/model/skills and readiness → save or deliberately launch → inspect the specific run → open preserved outputs → accept or return the work**. Errors must be actionable, and interrupting the worker must not lose output, leave unexplained state or permit two writers.

Keep the existing Aeon application and local worker. A new workflow platform, cloud runner fleet, autonomous scheduler or permanent supervisory agent is unnecessary for this iteration. A Git-only report convention and manual environment instructions would also be insufficient for the product you requested.

No mission, runner, exploit, production data write or deployment was used for this audit. No Playwright MCP was used. Agent OS changes below are proposed, not implemented by this task. The separately authorized card extraction and clipboard work is independent of this plan.

## How the swarm investigated it

- **Phase 1 — independent source lanes:** one prowler inspected the control plane, permissions, card state and original requirements; another inspected claiming, environment setup, process lifecycle, result delivery and recovery. Current source and tests took precedence over architecture claims.
- **Separate web group:** two prowlers benchmarked operator-facing agent capabilities and durable execution/storage patterns against current primary documentation.
- **Phase 2 — challenge:** findings were compared with the expected user outcomes; the runtime lane proposed a smaller Git/manual-profile alternative and the product lane challenged whether it met the requested polish.
- **Phase 3 — independent critique and synthesis:** a further prowler evaluated the scope, sequencing and acceptance gates. Private attachments were scoped in their own session and integrated only through an explicit storage dependency.
- **Evidence discipline:** CONFIRMED means an inspected code path, test or historical receipt supports the finding. The negative scenarios below are proposed reproducers unless explicitly stated otherwise. No claim of a reproduced production exploit or successful recovery exercise is made. Agent roles do not imply different-model verification.

## Expected capabilities, corrected against prior decisions

The original blueprint established a new mission card and a split between cloud repository identity and a host-local path. The later owner-confirmed 20 August scope explicitly removed a per-card skills selector and retained a **subagents selector**. The current editor does not expose that retained field, even though metadata and prompt generation support it. Skills should be discovered and shown as runtime evidence, not restored as a decorative picker without a new decision.

Inputs and outputs now need explicit file support. Attachments were excluded from the old POC, but are a new requirement in this request. Card/project attachments and immutable mission outputs can share a storage service while retaining separate ownership, provenance and lifecycle rules.

| User outcome | Current implementation | Required next-iteration outcome |
| --- | --- | --- |
| Distinct mission card | Released face, editor, draft/launch controls, state and recorded results | One coherent card-to-run-to-output experience; clear reported versus verified state |
| Register a repository | Realm directory plus separate local YAML mapping | Approved host binding and effective configuration visible before dispatch |
| Select the right environment | Host environment and explicit commands; separate setup shell | Versioned host-approved profile applied to the actual child process and checked |
| Use project skills | CLI trust/discovery; Swarm has dated exercise evidence | Show actual discovered skill sources for the selected runtime; missing required capability blocks readiness |
| Choose helpers | `subagents` supported in metadata/prompt, absent from editor | Restore the owner-facing selection, clearly distinguishing a requested delegation from an observed run |
| Get a useful result | Result envelope and artifact path strings | Retained bytes or verifiable code delivery, with stable attempt and publication receipts |
| Review and accept | Landing routing; manual board movement | Explicit accept/return decision tied to the exact delivered result |
| Survive interruptions | Heartbeats and stale visual state; no complete recovery | Honest interrupted state, conditional terminal updates, controlled recovery and late-writer protection |
| Use files on cards/projects | No current implementation | Private, permission-checked files on both scopes; HTML/MD/PDF included |

Intent sources: [original blueprint](../docs/ai-hangar-blueprint-1808.md), [owner-confirmed handoff](../docs/HANDOFF-1908-ai-hangar.md), [consolidated operating model](summary.md). Older missing-worktree and nontransactional-card-fold notes are superseded by current code; they are not repeated as current defects.

## Confirmed gap register

Priority describes the proposed adoption gate, not evidence of exploitation. **P0** blocks a trustworthy product contract; **P1** blocks the requested usable workflow; **P2** is a contained correction or later polish.

| ID | Priority | Confirmed finding | Evidence and consequence |
| --- | --- | --- | --- |
| G01 | P0 | Session creation accepts linked card/project identifiers without the necessary membership and relationship check | REST `sessions/route.ts:14–49`; `data/sessions.ts:63–81,262–325`. Caller-owned session events can reach another card through the linked ID. Source-confirmed; not exercised live. |
| G02 | P0 | Generic mutation surfaces do not consistently enforce role and system-field ownership | `data/projects.ts:6–65` access helper admits members including viewers; task REST/MCP updates accept free-form metadata. Generic project settings updates can bypass the owner-only Hangar toggle. Editor-only board actions do not protect alternate surfaces. |
| G03 | P0 | Result ingestion can commit the event but fail to fold it into the card, then skip that fold on replay | `sessions/[id]/events/route.ts:84–129`. Event insert precedes the fold; duplicate sequence returns without reapplying. Worker does not require a positive processed acknowledgment before later status/cleanup. A stored event is not sufficient completion evidence. |
| G04 | P0 | Mission save/launch updates can lose or misrepresent concurrent state | `actions/hangar.ts:142–164,193–214`; `data/tasks.ts:128–172`. Save writes a previously read whole Hangar object, risking fresh result/session/disarm fields. Queue insertion and card launch bookkeeping are separate. |
| G05 | P1 | Claiming does not match the host's actual repository or installed runtime | `poller.ts:173–180,249–259`; `data/sessions.ts:184–218`; `engines.ts:140–142`. An engine-compatible host can claim an unknown repository and fail it afterward. Concurrency one does not fix this. |
| G06 | P1 | Environment readiness is not a product contract | `poller.ts:274–279`; `spawner.ts:201–205`; repository form `:15–31,71–87`. Activation inside the setup shell does not persist into the CLI process. Cloud environment fields are not consumed by the poll worker. |
| G07 | P0 | Execution success precedes verified delivery and cleanup can discard outputs | `poller.ts:511–643`; `worktree.ts:424–513`; `validators/hangar.ts:225–269`. Push failure is a later event; arbitrary artifact strings can satisfy a completion check; uncommitted worktree files can disappear. |
| G08 | P1 | Worker loss has no complete reconciliation path; some terminal writes are not conditionally fenced | Heartbeat route `:13–16`; `data/sessions.ts:152–173,184–239`; kill route `:23–46`. A stale claimed run can hold the live-session slot. Late generic status or kill writes can conflict with a result. |
| G09 | P1 | Worktree creation does not prove a fresh base or isolation of linked dependencies | `worktree.ts:180–185,211–219,247–280`. Fetch failure can continue from available history; junction writes can affect shared source/dependencies. Show actual revision and link policy. This is a capability limit, not evidence of an observed destructive write. |
| G10 | P1 | Team run inspection and result acceptance are incomplete | Status action shares a narrow state only; session/event access remains session-owner scoped. Mission detail lacks a direct complete run-review surface. `MissionResultSection.tsx:7–42` renders self-reported completion; no typed acceptance bound to artifacts. |
| G11 | P1 | Model and helper controls overstate configured versus available behavior | `hangar-models.ts:1–45` is static; editor omits retained `subagents` fields. Authenticated CLI discovery is separate. A model name in a picker does not establish host entitlement. |
| G12 | P2 | Duplicate repository slugs across realms can produce inconsistent engine choices | `actions/hangar.ts:174–189` unions allowed-engine arrays; an empty array means all, but merging with a restricted entry can lose that meaning. Server launch and picker can disagree. |

Important qualification: `recordSessionResult` already has a transaction and terminal compare-and-set around its own session/card update. **G03 is the transaction boundary between event insertion and that fold**, not a claim that the existing fold has no transaction. G08 concerns other status writers and attempt ownership, not an absence of every state guard.

Existing tests cover claim ownership/engine filtering, event sequences, worktree cleanup, basic launch uniqueness and UI contracts. The inspected suites do not establish the partial-commit/replay, wrong-host, real environment inheritance, crash-recovery or remote-publication guarantees above. This audit did not rerun the historical release suites or treat their green totals as proof of these missing behaviors.

## What external systems suggest

These are comparisons and design inferences, not Aeon features or a recommendation to replace its stack. Sources were checked on **22 September 2026**.

| Pattern from primary sources | Useful implication for Aeon | Limit on the comparison |
| --- | --- | --- |
| GitHub's local Copilot app distinguishes local folders, repository sources and isolated workspaces | Show exactly where a mission will execute and which base it will use | Local app and cloud-agent environments are different surfaces. [GitHub sessions](https://docs.github.com/en/copilot/how-tos/github-copilot-app/agent-sessions) |
| GitHub setup workflows and GitLab flow configuration make repository preparation explicit | Version setup and preflight the effective process environment | A setup file alone is not a successful readiness check. [GitHub environment](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment), [GitLab execution](https://docs.gitlab.com/user/duo_agent_platform/flows/execution/) |
| GitHub and GitLab expose skill scopes with runtime-specific discovery | Report actual skill files and scope found by the intended engine | Availability differs between CLI, IDE and cloud flows. [GitHub skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills), [GitLab skills](https://docs.gitlab.com/user/duo_agent_platform/customize/agent_skills/) |
| GitHub agent management and GitLab sessions expose state, logs and operator controls | A card should open its run, show recent activity and expose an authorized stop outcome | Session retention and permissions must be declared, not assumed. [GitHub tracking](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents), [GitLab sessions](https://docs.gitlab.com/user/duo_agent_platform/sessions/) |
| GitHub self-hosted routing matches online idle workers; labels alone are not capability proof | Advertise fresh verified repository/runtime capability and match before claim | Do not build an autoscaling fleet just to fix local eligibility. [Runner routing](https://docs.github.com/en/actions/reference/runners/self-hosted-runners) |
| Temporal distinguishes retries, timeouts, heartbeats and idempotent side effects | Persist attempts and reject late writes; reconcile uncertain effects before retry | Resuming orchestration does not resume arbitrary CLI reasoning. [Failure detection](https://docs.temporal.io/detecting-activity-failures), [idempotency](https://temporal.io/blog/idempotency-and-durable-execution) |
| GitHub artifacts have retained downloadable bytes, digests and retention | Preserve outputs with a manifest before cleanup | Artifact storage is distinct from caching and from content acceptance. [Artifact guidance](https://docs.github.com/en/actions/tutorials/store-and-share-data) |
| GitLab development flows separate proposed changes from acceptance | Bind operator accept/return to an exact delivered result | Independent AI review can be optional; human acceptance remains required. [Development flow](https://docs.gitlab.com/user/duo_agent_platform/flows/foundational_flows/software_development/) |

An important setup boundary: GitLab documents setup commands with access to flow environment credentials. Aeon should therefore execute a **host-approved profile revision**, not blindly turn an editable realm registry command into local shell execution. Credential checks return presence/capability, never values. This is a direct design inference from [GitLab execution guidance](https://docs.gitlab.com/user/duo_agent_platform/flows/execution/).

## The next iteration: six connected phases

The phases below are implementation order, not six disconnected projects. Design the visible card flow at the start, deliver it with each slice, and run the offline qualification matrix throughout. No production mission is the proposed next action.

### Phase A — trustworthy access and state

**Result:** every write has the correct authority, and retry/concurrency cannot manufacture or erase mission truth.

- Apply shared role-aware guards across actions, REST and MCP. Validate task/project association and permissions on session creation and result application. Reserve Hangar board settings for their intended owner policy.
- Separate user-editable mission configuration from system-owned session/result/delivery fields. Reject system keys through generic metadata updates; preserve existing ordinary metadata compatibility.
- Make mission configuration an immutable launched revision; later card edits affect future runs only. Treat the visible last result as a projection of durable attempt records.
- Replace stale whole-Hangar saves with atomic editable-field patches. Make queue insertion and launch bookkeeping one recoverable/idempotent operation, including a lost-response retry.
- Make event insertion and result application atomic or replayably complete. A duplicate event must still converge on a confirmed card/result fold. Worker finalization must require acknowledged persistence.

**Ownership:** parent owns shared validators/schema/migrations. One control-plane worker owns session/task/project data and guards; one API worker mirrors the approved contract across surfaces in a later non-overlapping wave. Do not allow concurrent edits to the same session file.

**Affected subsystems:** `lib/data/{sessions,tasks,projects}.ts`, `lib/actions/{hangar,projects}.ts`, validators, session/task/project REST routes and corresponding MCP tools.

**Gate:** unauthorized/viewer/system-key tests fail closed; injected insert/fold failure replays to exactly one result; interleaved save/launch/result preserves the correct configuration, disarm state and receipt.

### Phase B — approved repository profiles and readiness

**Result:** repository registration connects to an inspectable, effective local execution setup.

- Keep cloud repository identity separate from host paths. Bind a stable repository identity to a locally approved path/profile revision, not an unrestricted cloud-authored command string.
- Define a small versioned profile: base/ref policy, engine/model requirement, environment invocation or child environment, required skills/tools, link/copy policy and allowed output/publication behavior.
- Probe the actual child-process environment. Capture interpreter/version, tool availability, authenticated model catalog freshness, discovered skill files, checkout revision and credential capability without secrets.
- Advertise only verified repository/engine capability. Filter by eligibility before the atomic claim; reject stale/mismatched capabilities at claim time. Unknown repositories remain visibly waiting or blocked, rather than being claimed by the wrong worker.
- Show ready/offline/missing/unknown with a reason in the repository and mission UI. Resolve duplicate-slug/realm ambiguity explicitly; preserve “all engines” semantics.
- Restore requested subagent selection without claiming that a selected name proves actual delegation. Record observed execution separately.

**Ownership:** runner profile/claim worker owns `registry.ts`, `engines.ts`, `spawner.ts` and the agreed poller slice; UI worker owns repository/editor/detail components. Parent owns claim validators and shared types. Integrate poller edits sequentially with phases C/D.

**Gate:** disposable Swarm-like and ARQ-like fixtures prove the intended interpreter and skill sources inside the child; missing model/skill/path prevents execution; two simulated hosts cannot claim each other's repositories. Real ARQ runtime readiness is not presumed from its current mapping.

### Phase C — private files and durable deliverables

**Result:** reports remain openable from Aeon after the worker is offline and its worktree is gone.

- Build the private card/project file service scoped in [the separate attachments plan](ATTACHMENTS_SCOPE_2209.md). Keep uploads, authorization, verification, limits and cleanup in that service.
- Add an immutable per-attempt output manifest referencing retained bytes, hashes, source revision, actual runtime and checks. A user attachment is an input/document; a mission output has execution provenance and cannot silently change under an accepted review.
- Collect outputs before cleanup, verify stored contents, and only then mark delivery complete. Preserve recoverable local work on upload failure. Never trust a path string as proof of a delivered artifact.
- Record process completion, result persistence, file delivery and branch publication separately. For code objectives, verify the remote commit/ref when publication is allowed; otherwise label the supported handoff honestly.
- Enforce publication policy in code. Report-only instructions must not rely on a prompt to suppress automatic push. Automatic draft PR creation is a later extension unless included explicitly in the code-delivery acceptance contract.

**Ownership:** attachment worker owns new file modules and UI; parent owns schema, migration and SDK pins; mission-delivery worker integrates manifest/finalization only after the storage contract is stable.

**Gate:** HTML/MD/PDF outputs can be retrieved through authorization after cleanup and host shutdown; tampered/foreign/unverified files fail; upload/push errors remain actionable and cannot be presented as delivered or accepted.

### Phase D — controlled interruption and recovery

**Result:** cancellation, crashes and delayed messages cannot create competing writers or silently complete work.

- Persist per-attempt ownership/generation and use conditional state transitions for heartbeat, result, generic status and kill. A stable worker ID alone is insufficient across restarts.
- Distinguish cancellation requested, observed process stop and settled outcome in the UI/receipt. Reconcile worker-owned children and worktrees on restart before taking more work.
- Show stale/attention state from heartbeat age. Do not free the one-live slot or requeue solely because a timer expired while an old process may still be writing.
- Provide a controlled operator recovery action that confirms or establishes old-process termination, preserves output and fences late events before allowing another attempt.
- Defer automatic retries when side effects are ambiguous. Bounded transport retry and idempotent replay are separate from rerunning an agent.

**Ownership:** one runtime worker owns recovery/process ownership and the poller; one control-plane wave applies the agreed fencing contract. Parent owns any status/schema changes. Prefer derived state where a new durable status is unnecessary.

**Gate:** fake-worker crash, reconnect, cancel/result race, duplicate completion and late superseded events yield one coherent outcome, no duplicate push and no second active writer. Stale jobs are explainable and recoverable.

### Phase E — an integrated operator experience

**Result:** the whole mission can be understood and reviewed from its card, with no need to reconstruct terminal history.

- Refine the existing form and card throughout A–D: clear readiness, actual host/base/profile, available model, helper selection and expected deliverables.
- Add card-to-attempt deep links and project-member scoped run reads. Keep stop/retry permissions distinct from viewing.
- Present summary, logs, checks, artifacts and publication evidence without confusing the current attempt with a previous result.
- Add explicit accept/return with feedback, tied to immutable output identity. A revised output invalidates the old review. Done remains an operator decision.
- Complete loading, empty, offline, partial-delivery and error states; keyboard access, focus and restrained desktop/mobile layout. Keep normal boards usable for planning.

**Gate:** fixtures show every state; the staged walkthrough is comprehensible without terminal assistance. “Completed” never stands in for “delivered,” “reviewed” or “accepted.”

### Phase F — qualification before adoption

**Result:** an evidence packet supports an explicit readiness decision before any production use.

- Run focused regressions at each phase, then the integrated web/worker/gate suites and typecheck, lint and build once against the coherent revision.
- Exercise fake runners and disposable repositories with controllable failures. Use isolated storage/database fixtures or preview infrastructure; do not use real production cards as test fixtures.
- Test environment inheritance, missing capabilities, lost HTTP responses, partial database writes, duplicate delivery, storage errors, push rejection, worker loss, cancellation, late events and cleanup failures.
- Perform an authenticated staging UI walkthrough with operator review when the implementation is ready. Production deployment/auth smoke and production visual acceptance remain separate, later release gates—not actions authorized by this planning request.
- Publish a readiness decision that lists exact revision, supported repositories/objectives, known limits and passed gates. Do not infer readiness from a test total or one successful process.

**Relevant existing commands:** `npm run typecheck`; `npm run lint`; `npx vitest run --minWorkers=1 --maxWorkers=4` inside `apps/web`, followed there by `node scripts/run-session-capture-tests.mjs`; `npm run test --workspace=apps/kairos-worker`; `node --test aeon_os/workflows/review-gate.test.mjs`; `npm run build`. Exact new focused test filenames should follow implemented ownership, not be invented ahead of it.

## Five non-negotiable adoption gates

| Gate | Observable pass condition | Evidence required |
| --- | --- | --- |
| 1. Authority and state | Invalid actor/card/project/system-field writes are rejected; concurrent and retried updates converge | Role matrix, relationship tests, controlled transaction failures and interleaving regressions |
| 2. Effective readiness | UI and actual child agree on approved repository/ref/environment/model/skills; wrong hosts never claim | Fixture probe receipt and two-host claim tests, missing/offline/stale negative cases |
| 3. Durable delivery | Authorized user opens the exact bytes after cleanup/host loss; publication has its own proof | Stored manifest/hash/readback, retention/ACL tests, rejected upload/push tests |
| 4. Controlled recovery | Crash/cancel/late events cannot create a second writer or falsely settle work | Process-ownership and fencing tests, interruption/restart receipts |
| 5. Operator acceptance | Card alone supports configure, trace, open result and accept/return with honest states | Authenticated staged walkthrough and owner confirmation before production adoption |

## What stays out of this iteration

- Autonomous schedules, priority/dependency optimization and a multi-host fleet.
- A workflow DSL, new orchestration platform, cloud environment provisioning or mandatory containers.
- Permanent secretary/coordinator sessions, automatic knowledge promotion, automatic merge/deploy or trading permissions.
- A revived per-card skills picker that was explicitly cut from the earlier scope.
- Automatic blind retry of an interrupted agent or migration of the old attachment WIP wholesale.

Runtime configuration and real infrastructure availability still need verification at implementation/release time: no live storage configuration or secret values were inspected in this audit. The prior session's exposed runner key must be rotated before it is used again; this planning work did not rotate it.

## Source register and evidence recency

Current source baseline is `888c298` on the active branch; its tree matches the recorded v0.29.0 production squash merge. Source-confirmed findings describe this baseline, not an independent inspection of production internals. The local card extraction/clipboard changes from this session do not change Agent OS behavior.

- [Session REST creation](https://github.com/Drxdre88/shadow_app_aeon/blob/888c298/apps/web/src/app/api/v1/sessions/route.ts#L14)
- [Event ingestion and folding](https://github.com/Drxdre88/shadow_app_aeon/blob/888c298/apps/web/src/app/api/v1/sessions/%5Bid%5D/events/route.ts#L84)
- [Session access, claim and result transaction](https://github.com/Drxdre88/shadow_app_aeon/blob/888c298/apps/web/src/lib/data/sessions.ts#L152)
- [Project access helper and settings writes](https://github.com/Drxdre88/shadow_app_aeon/blob/888c298/apps/web/src/lib/data/projects.ts#L6)
- [Mission save/launch actions](https://github.com/Drxdre88/shadow_app_aeon/blob/888c298/apps/web/src/lib/actions/hangar.ts#L105)
- [Task metadata updates](https://github.com/Drxdre88/shadow_app_aeon/blob/888c298/apps/web/src/lib/data/tasks.ts#L128)
- [Worker finalization](https://github.com/Drxdre88/shadow_app_aeon/blob/888c298/apps/kairos-worker/src/poller.ts#L511)
- [Worktree preparation and cleanup](https://github.com/Drxdre88/shadow_app_aeon/blob/888c298/apps/kairos-worker/src/worktree.ts#L180)
- [Engine process environment](https://github.com/Drxdre88/shadow_app_aeon/blob/888c298/apps/kairos-worker/src/spawner.ts#L195)
- [Completion shape guard](https://github.com/Drxdre88/shadow_app_aeon/blob/888c298/apps/web/src/lib/data/validators/hangar.ts#L225)
- [Dated supervised Swarm evidence](PRODUCTION_SWARM_2109.md), [release receipt](https://github.com/Drxdre88/shadow_app_aeon/pull/130#issuecomment-5763110845), [earlier operating guide](AGENT_OS_GUIDE_2209.html).

**Status:** multi-phase source/web audit and next-iteration plan complete. Agent OS implementation and adoption remain intentionally pending. Start with Phase A contracts and a designed repository-to-result journey, not a production mission.
