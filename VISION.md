# VISION.md

Last updated: 23/06/2026 (Kairos Phase 1A + 1B + 1C-C1 + 1C-C2 shipped; nightly synthesis pipeline wired; chat Visor with memory grounding live. "Never-asleep" reliability Tiers 0–1 shipped; Tiers 3–5 + snappiness batch parked — see §9)

For technical architecture, file paths, and feature inventory see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 1. PROJECT PULSE

Aeon is a **web-first project management platform** with a stunning visual identity (151 themes, particle effects, Framer Motion animations, @dnd-kit kanban, ReactFlow canvas). The PM side (Phases 1–3) is feature-complete and hardened (real-time Pusher sync, virtual scrolling, optimistic UI, lint clean, server-side loading, BYOK AI integration).

**Kairos is now Phase 2 of Aeon, not a side experiment.** What started in May as a personal memory layer has graduated, in eight weeks, into a multi-layer thinking partner: substrate (every memory classified into one of six stream classes), synthesis (3–7 archetypes per Dominion + one living cortex document, regenerated nightly), reflections (`kairos_reflect` MCP tool — the operator's first-class signal that outweighs activity-derived drift), and a slide-out chat Visor that grounds every reply in retrieved memories with cite-back chips. The full nightly cron pipeline — snapshot 23:00 → archetypes 02:30 → cortex 03:00 → briefer 07:00 — went live tonight.

**Mobile strategy (03/04/2026):** Capacitor WebView wrapper over the existing Next.js app (preserves 100% of web UI). Tauri desktop parked post-beta; PWA enabled as the free desktop win.

---

## 1.5 NORTH STAR — JARVIS · ULTRON · KAIROS

The single anchor for what Kairos is *for*. Picture a line: **JARVIS** (perfect but passive butler) at one end, **ULTRON** (self-directed, unstoppable, rewrites its own truth) at the other. **Kairos is deliberately parked in the middle — a helpful mind on a leash the operator holds.** This is the field's "human-on-the-loop / governed autonomy" spot, built as product.

| | 🤵 **JARVIS** | 💀 **ULTRON** | 🧠 **KAIROS** |
|---|---|---|---|
| **What it is** | Perfect helpful butler | Self-directed machine that decides it knows better | Helpful mind on a leash you hold |
| **Acts on its own?** | ❌ Only when asked | ☠️ Yes, unstoppably | ⚠️ Only with your say-so (by design) |
| **Its memory** | Flawless recall | Rewrites reality to suit itself | Preserves the past, shows its changes |
| **Who's in control** | You (but it's passive) | It is (that's the horror) | **You — always** |
| **The danger** | Too passive, waits around | Runs away from you | Kept intentionally in check |

**Where Kairos sits today:** ~70% of the way to JARVIS's usefulness (the *mind* is JARVIS-grade after governed-memory Phases 0–1), and **already Ultron-proof at the core** — it cannot destroy its own memory, hide its reasoning, or act unsupervised. The remaining gap to JARVIS is the **voice** (Phase 3) and **gentle proactivity** (Phase 4). The "gaps" vs Ultron — no self-set goals, no unsupervised action, no destructive self-editing — are **features we will never close on purpose.** That restraint *is* the product.

---

## 2. TRAJECTORY

| Direction | Evidence | Confidence |
|---|---|---|
| Kairos as thinking partner (memory → synthesis → chat → loops) | Phase 1A/B/C-C1+C2 shipped; nightly synthesis live; chat Visor anchored per Dominion; 1688 tests | Shipped (Phase 1A–1C-C2) / In flight (C3–C5, D1–D3) |
| BYOK AI integration (3 providers, AES-256-GCM, admin-gated) | Anthropic + OpenAI + Google via Vercel AI SDK; full REST + UI; tier-routed per user | Shipped |
| Realm-based multi-tenancy | Full CRUD, invites, scoped visibility, REST + MCP parity | Shipped |
| MCP-first AI integration | 95 tools across 15 categories, Bearer auth, dogfooded daily | Shipped |
| Capacitor mobile app | WebView wrapper preserves full web UI; mobile-auth backend reusable | Configured (build pipeline pending) |
| Master / Rift Board (cross-board view) | Rift in Analysis (high priority); Master in Raw Ideas | Speculative |
| Agent-as-member (AI in realms) | 1 raw idea card; `actorType` extension on `activityEvents` already in schema | Speculative |
| Real-time sync (Pusher) | Live, all mutations broadcast, 30s polling fallback | Shipped |
| PWA desktop | Manifest + service worker + offline fallback live | Shipped |
| Desktop app (Tauri) | Scaffold committed, deferred post-beta | Parked |

---

## 3. WHAT SHIPPED

| Date | Milestone | Impact |
|---|---|---|
| 02/06/2026 | Kairos Phase 1C-C2 — memory-grounded chat replies + citation chips + "Reading" line + horsemen fix-pack | Every chat reply pulls Dominion cortex + archetypes + top-5 substrate; inline `[[uuid]]` tokens rendered as chips bearing memory titles; hallucinated ids surface as muted `?` (server-side intersection guard). KairosVisor split 512 → 220 lines across 5 files; mapping + payload modules extracted to be unit-testable. Tests 1622 → 1688 (+66) |
| 02/06/2026 | Kairos Phase 1C-C1 — slide-out chat Visor anchored per Dominion | Right-edge slide-out panel on `/kairos`, `/notes`, `/settings/ai`. Single active thread per Visor open; persists in `agent_sessions` + `session_events` (no schema change); row-lock on parent agent_sessions serialises message seq; orphan-message recovery handles edited retry bodies |
| 02/06/2026 | Kairos Phase 1B B1+B2+B3 — archetype generator + Dominion cortex regen + `kairos_reflect` MCP tool | Nightly pipeline: snapshot 23:00 → archetypes 02:30 → cortex 03:00 → briefer 07:00. One living cortex document per Dominion used as chat system-prompt prefix. Owner reflections locked to `streamClass='reflection'` via dedicated MCP tool, weighted higher than activity-derived signals in synthesis, never archived by compaction |
| 01/06/2026 | Kairos Phase 1A A1–A4 — `streamClass` axis + 8 Dominions partitioned + Briefer live-board reframe + quality gates doc | 326/378 memories classified into reflection/idea/agentic/execution/archetype/cortex; 370/378 resolved into 8 Dominions (Swarm, Shadow Lab, AEON, Shadow Apps, STP Dev, STP Asset Trading, STP Spec, STP Quant); morning Briefing now reads live board cards via `inspectDominion` instead of stale import memories; `docs/kairos/14-quality-gates.md` documents memory ingress/egress invariants |
| 30/05/2026 | BYOK AI integration — 3 providers, AES-256-GCM at rest, admin-gated `/settings/ai` | Per-user encrypted keys; three-tier (cheap/standard/heavy) routing; provider-tinted glass UI with reveal toggle + inline test chip; REST CRUD at `/api/v1/ai/credentials` + `/preferences` |
| 30/05/2026 | Kairos Daily Briefer cron + ambient advisory feed | One advisory per active Dominion per day at 07:00 UTC; idempotent; unread badge + acknowledge flow in sidebar; deep-link to Kairos graph |
| 30/05/2026 | Kairos spawn primitive — `agent_sessions` + `kairos-worker` + Live Sessions button | Out-of-process Claude/Codex sessions spawned via HTTP; transcript polls every 2s; full REST + MCP CRUD with 5 session tools; kill switch |
| 30/05/2026 | Auto-capture (board + project events) + nightly project snapshot | Fire-and-forget memory capture on every task/project mutation; nightly snapshot writes open/done/blocked counts + last 5 events per project |
| 30/05/2026 | Dominions full body — vision + missionLong + objectives + Create modal + Edit drawer | Top-level grouping above projects with editable standing context; 16 MCP tools |
| 30/05/2026 | Notes bento page + Promote-to-Card + today's auto-captures strip | `/notes` route with bento grid; neighbours panel re-seeds on linked memory; memory → board task promotion flow |
| 30/05/2026 | Task assignees (Trello-style, M hotkey) | Multi-user assignment overlay on M keypress; `taskAssignees` table |
| 30/05/2026 | Sidebar overhaul — Home button + AnchoredPopover + bottom pill rows | Glowing pinned Home entry; Briefing + EOD moved to popover-anchored icons; portal-based popover primitive with flip-when-near-top + Esc close |
| 23/05/2026 | Kairos 2D WebGL + Dominion grouping + memory backfill MCP tool + Setup/Guide modal | Cross-repo memory connections via Dominions; Claude can loop through old memories and backfill aiTitle/execSummary; in-app onboarding modal |
| 22/05/2026 | Kairos rebrand + aiTitle + execSummary schema + MemorySidePanel rework | 1–6 word AI title + 5–10 bullet exec summary as front-of-house |
| 07/04/2026 | Phase 3 — Pusher real-time sync + virtual scrolling + optimistic UI rollback | Sub-second multi-user sync; large board perf; reliable mutations |
| 03/04/2026 | Capacitor pivot — abandoned React Native, PWA enabled | Mobile strategy reset; preserves web UI investment |
| 02/04/2026 | Phase 1.5 complete — realm invites, color/icon picker, lint cleanup, file splits | Production-quality realms; codebase health |
| 24/03/2026 | Phase 1 completion — all gaps closed | Board, gantt, labels, checklist all wired to DB |

---

## 4. STRATEGIC BETS

### Bet 1: Mobile via Capacitor (WebView wrapper)

- **What:** Capacitor wraps the existing Next.js web app in a native shell for iOS/Android, preserving 100% of the web UI.
- **Why:** Aeon's primary differentiator is its visual design (151 themes, effects, animations). React Native would require a full UI rewrite (3–6 months) to reach 50–70% fidelity. Capacitor ships the same UI in weeks.
- **Risk:** WebView performance ceiling on low-end devices; App Store review; mobile-specific UX (touch, gestures) may need CSS adjustments. PWA covers ~80% of desktop install cases for free.
- **Status:** Configured (capacitor.config.ts wired, mobile-auth backend reusable for bearer auth). No active build pipeline. PWA shipped 03/04.

### Bet 2: MCP-first over Webhook-first

- **What:** 95 MCP tools shipped before any webhook/event system. AI agents interact with Aeon as first-class citizens.
- **Why:** Dogfooding. The owner uses Claude Code to manage the Aeon board daily. Tight feedback loop drives API quality faster than speculative webhook consumers would.
- **Risk:** MCP is a niche protocol. If the broader ecosystem doesn't adopt it, the investment serves a small audience. Webhook system remains unstarted.
- **Status:** Shipped (95 tools / 15 categories) and actively used.

### Bet 3: Realms over traditional workspaces

- **What:** Fluid workspace groups with morphic project assignment, not rigid org/team hierarchies.
- **Why:** Core design philosophy — morphism over rigidity. Projects can belong to multiple realms; visibility is scoped per-project-per-realm.
- **Risk:** Unconventional. New users may expect traditional org/team/project structure.
- **Status:** Shipped with full CRUD, invites, scoped visibility, custom icons/colors.

### Bet 4: Cross-board intelligence (Master / Rift / Urgency lens)

- **What:** A unified family of cross-board surfaces — Master Board (mirror cards across projects, edits propagate), Rift Board (canonical N:1 column mapping with bidirectional writes), Cross-board urgency lens (global priority signal), Agent Dispatch (card-move hooks → GitHub Actions).
- **Why:** Once you have 5+ projects across multiple realms, per-project views become a bottleneck. Cross-board synthesis is the natural next multiplier.
- **Risk:** Edit propagation is architecturally complex (which project owns the mutation?); virtual scrolling is a prerequisite; could fragment focus if all four ship as separate features instead of one cohesive view.
- **Status:** Rift Board in Analysis (high priority); Master Board + Urgency Lens + Agent Dispatch in Raw Ideas. No spec written. Speculative.

### Bet 5: Kairos as a thinking partner — the centre of Aeon

- **What:** A multi-layer personal cognition system. **Substrate** (every memory classified by stream class) → **synthesis** (per-Dominion archetypes + living cortex doc, regenerated nightly) → **chat surface** (Visor anchored per Dominion, replies grounded in retrieved memories with cite-back chips) → **loops** (Phase 1D evening + morning) → **active agent** (Phase 2, gated) → **identity layer** (Phase 3, speculative).
- **Why:** The cortex *stores*; nothing yet *thinks*. The brain needs organising intelligence on top of the substrate. The arc is to grow Kairos from a memory store into a partner that holds context, surfaces what matters, and reasons with explicit citations. The owner declared on 01/06/2026: "Kairos is now Phase 2 of Aeon" — no longer a side experiment, the centre of product investment.
- **Risk:** Solo-user-driven UX may not generalise. Hard taste calls now (Dominion grouping, killing Realm for memories, killing the secondary sidebar, reflection-as-first-class signal) bake in assumptions. BYOK cost is real (~$0.50–2.00/day for nightly synthesis across 8 Dominions). Morning-loop noise floor is unknown until real cortex data accumulates.
- **Status:** Phase 1A (memory shape) + 1B (synthesis layer + reflections) + 1C-C1 (chat surface) + 1C-C2 (memory grounding) all shipped. First end-to-end nightly synthesis run lands tonight (02/06 → 03/06). C3 (`chat_with_kairos` MCP tool), C4 (two-way capture buttons), C5 (cosmic view enhancements) remain — ~6 hr. Phase 1D (loops) starts ~7 days after C ships, once cortex has accumulated.

### Bet 6: AI does the cleanup at the call site, not on the server

- **What:** Claude Code self-prompts to clean voice dumps and session transcripts into title + 5–10 bullet exec summary, then sends pre-cleaned payload through MCP `create_memory` / `update_memory`. The Aeon server stores what it's sent and runs no LLM on the write path.
- **Why:** Claude Code already has the model that heard the dump, with full project context. An LLM call on the write path duplicates that capability, adds latency, complicates the MCP/REST parity invariant. Backfill is also user-triggered ("Claude, regenerate the last 30 days") — no cron needed.
- **Risk:** Capture quality depends on Claude Code being good at the cleanup. Mitigation: save the original verbatim as an optional `rawTranscript` so unpolished phrasing stays searchable (still pending — no schema change made).
- **Status:** Shipped. Schema live (migration 0015), MCP tools accept + return aiTitle + execSummary, `list_memories_needing_summary` lets Claude loop and backfill historical memories. **Phase 1B synthesis runs on the server side using BYOK — that's the new exception**, but it's batched nightly (not write-path) and gated by the user's heavy-tier key.

---

## 5. EMERGING PATTERNS

**Synthesis-before-chat discipline.** The original Kairos plan sequenced chat first; the owner rejected this in favour of A (memory shape) → B (synthesis) → C (chat). The consequence is that the chat surface ships with real archetype and cortex material underneath it from day one, rather than a bare persona. This sequencing decision is now a template for all future Kairos feature work: data fidelity gates the intelligence surface.

**Reflections as the operator's voice in the brain.** Reflections are the operator's direct line into how Kairos comes to see each Dominion — weighted higher than activity-derived signals, can override drift flags, never archived by compaction. This is the channel that prevents Kairos from drifting away from the owner's actual intent. Currently only via MCP (`kairos_reflect`); web UI button planned for C4; phone capture is Phase 2.

**Cite-grounded reasoning baked into the chat contract.** Every Kairos claim links back to substrate. C2 implements this as inline `[[uuid]]` tokens with a server-side hallucination guard (model can invent ids; the server strips any not in the retrieved set before persisting; UI renders invented ids as muted `?`). This makes confabulation visible at a glance — defence-in-depth between the model and the persistence layer.

**Horsemen-driven ship discipline.** Per-card warden + per-batch four-agent horsemen (butcher, warden, judge, stalker) before commit. Stalker added to the rotation now surfaces test coverage gaps as high-severity findings on every batch — C1+C2 batch caught 3 critical untested paths and prompted +50 tests. The pattern is shipping with confidence, not shipping with hope.

**AI-driven development velocity.** The shadow-specs and docs/kairos directories now contain dozens of handover, spec, and quality-gate documents. Every major feature goes through recon → spec → review → implementation → horsemen. Features land in multi-commit bursts and the test count grows with them (1576 → 1688 in two weeks).

**Infrastructure-before-features discipline.** Phase 1.5 was entirely about hardening (lint, file splits, SSR, perf). Phase 2 (Kairos) follows the same pattern — the streamClass column + Dominion backfill landed before the synthesis layer, and the quality-gates doc landed before B1+B2. The horsemen passes are the same discipline applied per-feature.

**Morphism as architecture.** Realms over hierarchies; flat-list over Personal/Team split; fluid columns over enforced workflow; Dominions over fixed project taxonomy. Structure is emergent, not prescribed. The risk is power users wanting guardrails (WIP limits, enforced workflows) finding the flexibility disorienting.

**Spec archaeology as institutional memory.** `shadow-specs/` and `docs/kairos/` are decision logs — ADRs, recon, code-quality reviews, session handovers. More valuable than traditional docs because they capture the "why not" alongside the "why." Every Kairos session begins with the previous session's handover so a fresh instance picks up without re-explanation.

---

## 6. DIRECTIONAL SHIFTS

| When | From | To | Why |
|---|---|---|---|
| 02/06/2026 | C1 planned as thread list + multi-thread UX with optional Dominion routing | C1 narrowed: single active thread per Visor open, required Dominion anchor, no retrieval (pushed to C2) | Scope discipline. Real archetypes only exist after the first nightly cron, so C2 design benefits from actual archetype output before locking retrieval shape |
| 02/06/2026 | Cite-grounded reasoning = evolution-plan principle, not yet implemented | Cite-grounded reasoning is the C2 chat contract — inline `[[uuid]]` markers post-processed as hover chips with server-side hallucination guard | Principle 3 of the evolution plan ("every Kairos claim links back to substrate. No floating assertions") becomes a C2 implementation spec |
| 01/06/2026 | Phase 1A A3: prune ~200 empty-shell board-import memories as noise | Live board awareness via `inspectDominion` — keep all memories, deprecate the bulk-import script, Briefer reads board state live | Owner overruled the prune: "every card is signal." Architectural consequence: Briefer no longer consumes static imported memories; queries board live on every run |
| 01/06/2026 | Board memories and synthesis input were the same population | Memory/board boundary clarified — board owns cards (live source of truth), brain owns synthesis (no double-write). Archetype + cortex stream classes excluded from Briefer's "recent memories" feed to prevent recursive context-collapse | Horsemen caught that feeding archetype/cortex back into the synthesis input would create a hallucination loop. Stream-class exclusion is now a structural invariant |
| 01/06/2026 | Reflections = one MCP tool, lightweight capture | Reflections = first-class signal — higher synthesis weight than activity-derived drift, `streamClass='reflection'` locked by the tool schema, prompts for B1+B2 treat them as a dedicated weighted block, never archived | Evolution plan principle 4: "The owner reshapes the brain. Reflections carry higher weight than activity-derived drift." B4 (reflection weighting) became implicit in B1+B2 prompts, saving a discrete implementation block |
| 01/06/2026 | Kairos = "personal memory store with WebGL cortex, founder-only, on a feature branch" | Kairos = "Phase 2 of Aeon" — owner-committed strategic pivot, the centre of product investment | Owner declared on 01/06/2026 that Kairos is no longer a side-car experiment |
| 23–30/05/2026 | BYOK "built, awaiting merge window" (was Bet 7) | BYOK shipped and live — `/settings/ai` page, 3 providers, AES-256-GCM at rest, three-tier routing | BYOK is no longer a strategic bet; it's infrastructure |
| 30/05/2026 | Daily Briefing + EOD Reflection auto-pinned to dashboard | Both moved to sidebar popovers behind Sun/Moon icons; dashboard opens directly on realms | Reduced noise on the dashboard; both surfaces now opt-in instead of always-visible |
| 03/04/2026 | React Native mobile app | Capacitor WebView wrapper | Full UI rewrite (3–6 months) vs wrapping existing stunning web UI (weeks). Visual design is the differentiator — don't rewrite it |
| 03/04/2026 | Tauri desktop (active plan) | PWA first, Tauri parked | PWA covers 80% of desktop use cases for free |
| ~01/04/2026 | Personal/Team workspace split | Flat realm list with TEAM badge | Simpler mental model; morphism principle |

---

## 7. OPEN QUESTIONS

| Question | Impact | Notes |
|---|---|---|
| **Phase 1D morning-loop calibration: what is the right noise floor?** | High | Evolution plan: "A morning ping that fires every day will get muted in a week." D2 picks 0–1 question per Dominion per day above an urgency × confidence threshold. The threshold is unknown until real cortex data accumulates. First synthesis cycle was tonight (02/06 → 03/06) |
| **Phase 2 autonomy gates: what does the owner explicitly gate?** | High | Evolution plan: "Kairos can suggest. Kairos cannot spawn / commit / send without explicit gates." The gate mechanism (confirmation UI, per-action policy, per-Dominion override) is unspecified. Needs design before Phase 2 starts |
| **Identity layer (Phase 3): does configurable personality precede multi-user Kairos?** | Medium | Phase 3 names "board of directors" multi-agent council + configurable Kairos persona. If second-user Kairos shares the owner's persona it may be fine for one beta user but wrong at scale. Decision deferred but should be named before Phase 2 ships |
| **Cross-user cron snapshot leak: scope of contamination?** | Medium | 5 memories from other beta users in owner's table via `project-snapshot`. Not bleeding into synthesis (Dominion-scoped) but the root cause in `auto-capture.ts` is unaudited. Compounds as more beta users add data |
| **Mobile-responsive CSS gaps** | High | Capacitor wraps the web app as-is. Which pages/components break on small screens? Touch targets, modals, DnD, sidebar — needs a responsive audit before Capacitor ships |
| **WebView performance on effects** | High | 151 themes with particle effects, aurora, snowfall — may not run smoothly in mobile WebView. May need auto-disable heavy effects on mobile or detect low-end devices |
| **Sessions parity lock: when does drift risk block?** | Low | REST + MCP session shapes match but no parity test exists. Spawn lifecycle is growing (C3 adds `chat_with_kairos`, Phase 2 adds more hooks). `sessions-parity.test.ts` should land before Phase 2 |
| **Should Master / Rift Board block on virtual scrolling?** | Medium | Cross-board view without virtualisation could be unusable at scale. Virtual scrolling is shipped on the kanban; Rift would need its own |
| **Push notifications architecture** | Medium | Capacitor has the plugin. FCM/APNs backend doesn't exist. Plan early or bolt on later? |
| **rawTranscript field?** | Low | Storing the unpolished voice/session transcript next to `bodyMd` so original phrasing stays searchable. No schema change made yet — one nullable text column, no risk |
| **Kairos: when do other users get in?** | Medium | The 30-day-of-founder-daily-use trigger from May still holds in principle, but Kairos has grown. New gates: (a) when does morning-loop calibration reach a stable noise floor? (b) what does Phase 2 autonomy look like for a non-owner? (c) does identity layer need to ship before multi-user is meaningful? |

---

## 8. WEB + MOBILE + DESKTOP CONVERGENCE MAP

With Capacitor, mobile IS the web app. The convergence is about which native features to layer on top.

| Layer | Web (browser) | Mobile (Capacitor) | Desktop (PWA) | Shared |
|---|---|---|---|---|
| **UI** | Full Next.js app | Same app in WebView | Same app via manifest | 100% shared |
| **Auth** | NextAuth session cookies | Bearer tokens (mobile-auth.ts) | NextAuth cookies | users/accounts tables |
| **Native features** | None | Push, haptics, biometrics (via plugins) | Install prompt, offline cache | — |
| **Offline** | None | Future: service worker + Capacitor storage | Service worker cache | Service worker |
| **Performance** | Full browser engine | WebView (WKWebView/Chrome) | Full browser engine | — |

### Convergence principles
- **One UI, multiple shells.** No separate UI codebases.
- **Native features via plugins, not rewrites.** Capacitor adds push/haptics/biometrics as a layer.
- **Auth is the only divergence.** Browser uses cookies, native uses bearer tokens. Both authenticate the same users.
- **PWA is the free desktop win.** Service worker + manifest cover install + offline basics.

---

## 9. PARKED — "NEVER-ASLEEP" RELIABILITY + SNAPPINESS (next round)

A research pass on "a board edit must never silently vanish when Neon is waking up or the network drops" produced a tiered plan. **Tier 0 + Tier 1 shipped** (durable offline mutation queue + auto-retry + save-status pill, task mutations; PR #66). The rest is deliberately parked for a future round — captured here so it isn't re-derived.

| Item | What | Why it's worth doing | Status |
|---|---|---|---|
| **Tier 3 — lighten dashboard poll** | The dashboard runs **two full server actions every 10s** with no version short-circuit (`DashboardContent.tsx`) — the heaviest recurring DB load. Adopt the board's cheap version-check, add a Pusher connection badge + apply deltas instead of full re-download, and move the board Pusher channel from public `board-<projectId>` to **private/authed**. | Biggest recurring compute draw after the keep-warm cron removal; also a security tidy (public channel). | Parked |
| **Tier 4 — Neon cold-start (operator decision)** | For zero work-hours cold-start, **disable scale-to-zero** on the Neon compute (Launch plan), giving an always-on floor ≈ 187.5 CU-h ≈ **~$20/mo**. This is the honest replacement for the keep-warm cron — **do NOT re-add a cron**. Console path: Neon Console → Branches → select branch → Computes → Edit → toggle Scale to zero off → Save. Caveat: an always-on compute won't auto-pick-up Neon image updates — restart it weekly. | Removes cold-start latency for live beta users without re-introducing the 24/7 compute bleed. | **Operator parked** — revisit if first-load latency hurts users. Retry/queue already prevents data loss meanwhile. |
| **Tier 5 — local-first sync engine** | When the next fluid React app is built, adopt a real local-first sync engine (Zero/Rocicorp or ElectricSQL) from day one rather than bolting reliability on. Linear's lesson: sync engine first. | Structural fix that makes Tiers 0–3 obsolete; only viable at a rebuild boundary. | Parked (rebuild-gated) |
| **Snappiness quick-wins** | From a 4-prowler interaction-delay audit (separate from the Smooth-UI toggle): card-click → `onDoubleClick` (also fixes the "E shortcut" bug), shorten 300ms checkbox/drop durations to 150ms, focus `setTimeout` → `requestAnimationFrame` (TaskEditModal / VaultDaysModal / KairosVisor / TaskChecklist), QuickCapture 600→300ms close, and **prefetch Gantt/Canvas data at project mount** (currently gated behind tab-click + board load → slow first visit). | High felt-impact, low risk; independent of the master motion toggle. | Parked |
| **Queue coverage** | Extend the durable mutation queue beyond the 4 task mutations to **column / vault / archive** handlers (today they still use the simpler retry path or raw `.then/.catch`). | Closes the one coverage gap in the shipped never-asleep work. | Parked |
| **Smooth-UI modal fades** | Framer *modal* open/close opacity fades (Settings/Help/Stats/Gantt/Changelog spring family, NarrativeModal 500ms, KairosVisorShell 320ms) still fade in fast mode — `reducedMotion` kills transform/slide but not opacity. Clean fix: a shared motion-duration helper wired to `smoothUiRenders`. | Finishes the "instant app" promise of the Smooth-UI toggle. | Parked |

---

## 9. PHASE MAP

### PM-side

| Phase | Name | Status | Key Deliverables |
|---|---|---|---|
| 1 | Close the Gaps | COMPLETE | Middleware fix, Gantt wired to DB, labels end-to-end, checklist, loading states |
| 1.5 | Hardening | COMPLETE | Realm invites, REST parity, lint cleanup, file splits, SSR, perf |
| 2A | Mobile Auth Backend | COMPLETE | mobile-auth.ts, mobileSessions + mobileLoginTokens |
| 2B | PWA + Capacitor | IN PROGRESS | PWA shipped; Capacitor configured, build pipeline pending |
| 2C | Native Plugins | QUEUED | @capacitor/push-notifications, haptics, biometrics |
| 2D | Mobile Polish | QUEUED | Responsive CSS audit, touch sizing, effect auto-disable, store submission |
| 2.5 | Web Polish | PARALLEL | Incremental UX fixes alongside mobile |
| 3 | Performance | COMPLETE | Virtual scrolling, optimistic UI, Pusher real-time |
| 4 | Cross-board intelligence | SPECULATIVE | Master Board, Rift Board (in Analysis), Urgency lens, Agent Dispatch |
| 5 | Collaboration | NOT STARTED | Chat, notifications, agent-as-member |

### Kairos

| Phase | Name | Status | Key Deliverables |
|---|---|---|---|
| K-0 | Kairos POC | COMPLETE | 3D + 2D cortex, dynamic sidebar shell |
| K-1 | Memory display | COMPLETE | aiTitle + execSummary schema, MemorySidePanel rework |
| K-2 | MCP capture path | COMPLETE | `create_memory` + `update_memory` accept clean payload; backfill MCP tool |
| K-3 | Dominions (grouping) | COMPLETE | Tables, FKs, 16 MCP tools, Create + Edit UI |
| K-4 | 2D WebGL rebuild | COMPLETE | @react-three/fiber + d3-force-3d; edge rendering after first tick |
| K-5 | Onboarding modal | COMPLETE | Setup + Guide modal under sidebar pill |
| K-6 | Dominion REST API | NOT STARTED | Mirror 16 MCP tools to `/api/v1/dominions/` |
| K-7 | BYOK + extension AI | COMPLETE | Vercel AI SDK, AES-256-GCM keys, 3 providers, `/settings/ai`, Briefer cron |
| **1A** | Memory shape | COMPLETE | `streamClass` column + cascade backfill (326/378); 8 Dominions partitioned (370/378); Briefer reads live board; quality-gates doc; compaction stub |
| **1B** | Synthesis layer | COMPLETE | Archetype generator (B1), Dominion cortex regen (B2), `kairos_reflect` MCP tool (B3). Reflection weighting (B4) implicit in B1+B2 prompts |
| **1C-C1** | Chat shell | COMPLETE | Slide-out Visor anchored per Dominion; persists in `agent_sessions` + `session_events`; row-lock seq serialisation; orphan-retry recovery (now handles edited bodies) |
| **1C-C2** | Memory-grounded responses | COMPLETE | Cortex + archetypes + top-5 substrate retrieved per turn; inline `[[uuid]]` citation chips with server-side hallucination guard; "Reading" line above each reply |
| **1C-C3** | `chat_with_kairos` MCP tool | QUEUED | Second front door to the same chat threads from any Claude session |
| **1C-C4** | Two-way capture buttons | QUEUED | "Save as memory" + "promote to card" + "send as reflection" in the Visor |
| **1C-C5** | Cosmic view enhancements | QUEUED | Tier filter chips, stream chips, archetype orbs, reflection beacons, Dominion cortex orb |
| **1D** | Loops + thinking chains | BLOCKED | Evening (extend cron, partially done by B2) + Morning (0–1 calibrated question per Dominion) + thinking-chain runner. Gated on ~7 days of accumulated cortex data |
| **2** | Active agent | SPECULATIVE | Autonomous archetype refinement, cross-Dominion synthesis, workflow triggers (gated per action), calibrated proactive messaging, phone capture. Gate: owner trusts Phase 1 |
| **3** | Identity layer | SPECULATIVE | Configurable persona, multi-agent council ("board of directors"), council deliberation, identity per Dominion |

Phase 1 ran in parallel with PM phases. The synthesis-before-chat sequencing (A → B → C) is now a template for future Kairos blocks.
