# VISION.md

Last updated: 22/05/2026 (Kairos POC + sidebar consolidation + memory display rework)

For technical architecture, file paths, and feature inventory see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 1. PROJECT PULSE

Aeon is a **web-first project management platform** with a stunning visual identity (151 themes, particle effects, Framer Motion animations, @dnd-kit kanban, ReactFlow canvas). The web side (Phase 1 + 1.5) is feature-complete and hardened (lint 46 to 9, file splits, SSR, perf).

**Strategic pivot (03/04/2026):** Mobile strategy shifted from React Native (full UI rewrite) to **Capacitor** (WebView wrapper preserving 100% of web UI). The React Native approach would have taken 3-6 months to reach 50-70% visual fidelity; Capacitor ships the same stunning UI in weeks. Desktop strategy: **PWA first** (near-zero effort), Tauri deferred to post-beta only if users explicitly request offline/system tray/hotkeys. The mobile-auth backend (session tokens, Google OAuth endpoint) remains valid for Capacitor's bearer auth needs.

---

## 2. TRAJECTORY

| Direction | Evidence | Confidence |
|---|---|---|
| Capacitor mobile app | Pivot from React Native on 03/04. WebView wrapper preserves full web UI. mobile-auth backend reusable | High (spike in progress) |
| Realm-based multi-tenancy | Full CRUD, invites, scoped visibility, REST + MCP parity | Shipped |
| MCP-first AI integration | 52 tools, Bearer auth, dogfooded daily via Claude Code | Shipped |
| Kairos — personal memory layer | 3D + 2D cortex views, MCP capture path, dynamic sidebar shell, schema for AI title/exec summary | In Progress (POC on feature/cortex-swarm-port) |
| BYOK AI credentials (Vercel AI SDK + AES-256-GCM) | Foundation built on feature/brain-ai-integration (commit 8465858) — router, encrypted-key schema, /settings/ai page, admin gate | Built, awaiting merge |
| Master Board (cross-project view) | 4 raw idea cards (schema, propagation, UI, permissions) | Medium |
| Real-time sync (Pusher) | Pusher Channels live, all mutations broadcast, 30s polling fallback | Shipped |
| Agent-as-member (AI in realms) | 1 raw idea card, no spec | Speculative |
| PWA desktop | ServiceWorkerRegistration.tsx exists, manifest needed | In Progress (enabling now) |
| Desktop app (Tauri) | Scaffold committed, explicitly deferred to post-beta | Parked |

---

## 3. WHAT SHIPPED

| Date | Milestone | Impact |
|---|---|---|
| 07/04/2026 | Phase 3 -- Pusher real-time sync, virtual scrolling, optimistic UI rollback | Sub-second multi-user sync, large board performance, reliable mutations |
| 07/04/2026 | React Native deleted -- apps/mobile/ removed, Capacitor-only mobile strategy | Clean codebase, no dead code |
| 03/04/2026 | React Native Phase A -- Expo scaffold, auth, API client | Mobile platform foundation (later deleted) |
| 04/04/2026 | Phase 2.5A/B -- checklist UX fixes, glow source setting, priority color remap, React Compiler, PPR, Zustand selector audit (22 files), horsemen security fixes | Snappy UI foundation, security hardening |
| 03/04/2026 | Capacitor pivot -- abandoned React Native, PWA enabled, Capacitor configured | Mobile strategy reset, preserves web UI investment |
| 02/04/2026 | Phase 1.5 complete -- realm invites, color/icon picker, lint cleanup, file splits | Production-quality realms, codebase health |
| 02/04/2026 | Server-side loading -- board + dashboard SSR, auth() caching | Eliminated loading spinners on initial render |
| 01/04/2026 | Scoped visibility, access denied page, realm member access | Multi-tenant security layer |
| 01/04/2026 | ProjectSidebar, REST realm API (6 routes), hide toggle | Clean navigation separation |
| 31/03/2026 | Kill Personal/Team split -- flat realm list, viewport-locked layout | Simplified mental model |
| 30/03/2026 | Sidebar navigation, realm sections, MCP realm tools (11 tools) | Full realm management from AI + UI |
| 28/03/2026 | DB query audit, touchProject on all mutations | Data integrity, reliable polling |
| 24/03/2026 | Phase 1 completion -- all gaps closed | Board, gantt, labels, checklist all wired to DB |

---

## 4. STRATEGIC BETS

### Bet 1: Mobile via Capacitor (WebView wrapper)

- **What:** Capacitor wraps the existing Next.js web app in a native shell for iOS/Android, preserving 100% of the web UI
- **Why:** Aeon's primary differentiator is its visual design (151 themes, effects, animations). React Native would require a full UI rewrite (3-6 months) to reach 50-70% fidelity. Capacitor ships the same UI in weeks
- **Risk:** WebView performance ceiling on low-end devices. Apple App Store review (mitigated by native plugins adding real native functionality). Mobile-specific UX (touch targets, gestures) may need CSS adjustments
- **Status:** PIVOTED from React Native on 03/04/2026. mobile-auth.ts backend (session tokens, Google OAuth) remains valid. React Native UI code (~680 lines) to be discarded after Capacitor validated. PWA enabling in parallel
- **Previous approach (React Native):** Deleted on 07/04/2026. Expo scaffold + auth + API client (823 lines) abandoned — required complete UI rewrite with no path to visual parity

### Bet 2: MCP-first over Webhook-first

- **What:** 52 MCP tools shipped before any webhook/event system. AI agents interact with Aeon as first-class citizens
- **Why:** Dogfooding -- the developer uses Claude Code to manage the Aeon board daily. This tight feedback loop drives API quality faster than speculative webhook consumers would
- **Risk:** MCP is a niche protocol. If the broader ecosystem doesn't adopt it, the 52-tool investment serves a single user. Webhooks (Phase 4 roadmap) would unlock broader integrations
- **Status:** Shipped and actively used. Webhook system remains unstarted

### Bet 3: Realms over traditional workspaces

- **What:** "Realms" as fluid workspace groups with morphic project assignment, not rigid org/team hierarchies
- **Why:** Core design philosophy of morphism over rigidity. Projects can belong to multiple realms. Visibility is scoped per-project-per-realm rather than per-org
- **Risk:** Unconventional model -- new users may expect traditional org/team/project hierarchy. "Realm" terminology may confuse
- **Status:** Shipped with full CRUD, invites, scoped visibility, custom icons/colors

### Bet 4: Master Board as the next multiplier

- **What:** Cross-project board aggregating cards from multiple projects with edit propagation
- **Why:** Once you have 5+ projects in multiple realms, per-project views become a bottleneck. A unified view is the natural next step for power users
- **Risk:** Edit propagation across projects is architecturally complex (which project owns the mutation?). Performance at scale with no virtual scrolling yet
- **Status:** 4 raw idea cards, no spec written. Dependent on virtual scrolling (in analysis)

### Bet 5: Kairos as a personal productivity tool first, broader product later

- **What:** Kairos (the renamed brain / cortex feature) is a personal memory layer with 3D + 2D visualisation, MCP-driven capture, and AI-cleaned exec summaries. **In 2026 it is exclusively the founder's own productivity tool, used via Claude Code.** Wider beta access is considered only after the founder uses it daily and considers it perfected
- **Why:** The user runs a portfolio across asset trading, spec trading, quant modelling, and software engineering. Most knowledge capture happens via voice dumps into Claude Code. The MCP path is the primary capture surface — web voice has been killed. Building this for one user (the founder) first means decisions get made fast, the UX is opinionated, and the feedback loop is hours not weeks
- **Risk:** Solo-user-driven UX may not generalise. Hard taste calls now (e.g. Constellation/Dominion grouping, killing Realm for memories, killing the secondary sidebar) bake in assumptions. Mitigation: revisit naming and information architecture before opening to others
- **Status:** POC on `feature/cortex-swarm-port`. Schema ready for AI-generated title + exec summary (migration 0015). MCP tools to be extended with `aiTitle` + `execSummary` fields so Claude Code (the model itself) does the AI cleanup on the caller side. Server stays dumb

### Bet 6: AI does the cleanup at the call site, not on the server

- **What:** Claude Code self-prompts to clean voice dumps and session transcripts into title + 5–10 bullet exec summary, then sends the pre-cleaned payload through the MCP `create_memory` / `update_memory` tools. The Aeon server stores what it's sent and runs no LLM itself
- **Why:** Claude Code already has the model that heard the dump, with full project context. Putting an LLM call on the write path duplicates that capability, adds latency, and complicates the MCP/REST parity invariant. Backfill is also user-triggered ("Claude, regenerate the last 30 days") — no cron needed
- **Risk:** Capture quality depends on Claude Code being good at the cleanup. Mitigated by saving the original verbatim as an optional `rawTranscript` so the unpolished phrasing stays searchable
- **Status:** Schema ready. MCP tool extension pending. Session-capture hook update pending (will use `claude --print` to self-clean before calling the tool). **BYOK is NOT a blocker for this — see Bet 7**

### Bet 7: BYOK foundation built but waiting

- **What:** Vercel AI SDK v6 + per-user encrypted API keys (AES-256-GCM) + provider-agnostic router (Anthropic / OpenAI / Google) + admin-gated `/settings/ai` page. Lives on `feature/brain-ai-integration` (commit 8465858)
- **Why:** The longer-term play. Even though Kairos itself does AI work via Claude Code MCP today, BYOK is the foundation for any *other* AI feature (daily briefings, agent-as-member, project chat, code review hooks). Building it as encrypted-per-user and admin-gated from day one keeps options open for multi-user beta later
- **Risk:** If never merged, the foundation rots and the migration number (0014) becomes a coordination headache against newer migrations. Mitigation: merge on a quiet day before any new AI feature is built
- **Status:** Built, tested (1570 tests passing including crypto roundtrip + tampering rejection), waiting for a merge window. The current Kairos POC explicitly does not depend on it

---

## 5. EMERGING PATTERNS

**AI-driven development velocity.** The shadow-specs directory contains 30+ spec packages across 7 categories. Every major feature goes through recon/spec/review before implementation. The commit history shows features landing in multi-commit bursts (50 changes in a single session on 02/04). This is not traditional sprint-based development -- it's spec-then-execute at AI speed.

**Infrastructure-before-features discipline.** Phase 1.5 was entirely about hardening: lint cleanup, file splits, server-side loading, query dedup, connection timeout tuning. The project resists shipping new features on shaky foundations. The 46-to-9 lint reduction and zero TODO/FIXME count reflect this.

**Surface area expansion pressure.** The raw ideas backlog (18 cards) is growing faster than the done column. Concepts like Agent Dispatch, Rift Board, Cross-board urgency lens, and Stream Chat represent a widening ambition that could fragment focus. The project is at an inflection point where saying "no" to good ideas matters more than saying "yes."

**Morphism as architecture.** The "realms" model, the kill of Personal/Team split, the flat-list-over-hierarchy choices -- these all reflect a consistent design philosophy where structure is emergent rather than prescribed. This extends to the board itself (fluid columns, no enforced workflow). The risk is that power users who want guardrails (WIP limits, enforced workflows) may find the flexibility disorienting.

**Stalled frontiers resolved.** Desktop (Tauri) explicitly parked post-beta. PWA being enabled now as the free desktop win. React Native abandoned in favor of Capacitor. All three stalled items now have clear dispositions instead of lingering ambiguity.

**API as the unifier.** The mobile auth work forced the first mobile-specific backend code (`mobile-auth.ts`), but everything else goes through the same `/api/v1/` routes. This validates the REST API investment from Phase 1. The API is becoming the true product boundary -- both surfaces are clients of the same contract. This pattern should hold as long as mobile-specific endpoints stay exceptional, not routine.

**Auth divergence is intentional.** Web uses NextAuth session cookies (browser-native). Mobile uses bearer tokens with 90-day sessions (app-native). Both authenticate the same users. This is the right split -- don't try to unify them. The mobile auth tables (`mobileSessions`, `mobileLoginTokens`) are clean additions, not hacks.

**Spec archaeology as institutional memory.** The shadow-specs directory is becoming a rich decision log -- ADRs, recon reports, code quality reviews dating back months. This is more valuable than traditional docs because it captures the "why not" alongside the "why."

---

## 6. DIRECTIONAL SHIFTS

| When | From | To | Why |
|---|---|---|---|
| 03/04/2026 | React Native mobile app | Capacitor WebView wrapper | Full UI rewrite (3-6 months) vs wrapping existing stunning web UI (weeks). Visual design is the differentiator — don't rewrite it |
| 03/04/2026 | Tauri desktop (active plan) | PWA first, Tauri parked | PWA covers 80% of desktop use cases for free. Tauri only if beta users demand offline/tray/hotkeys |
| 01/04/2026 | Personal/Team workspace split | Flat realm list with TEAM badge | Simpler mental model, morphism principle |
| 31/03/2026 | AppSidebar everywhere | ProjectSidebar for board view | Board context needs dedicated nav, not dashboard nav |
| 28/03/2026 | Legacy project.group field | Realm-based project assignment | Groups were rigid single-assignment; realms allow multi-membership |
| ~24/03/2026 | Phase 2 features next | Phase 1.5 hardening sprint | Codebase health before feature expansion |
| Early 2026 | Webhooks first (Phase 4 plan) | MCP first (52 tools shipped) | Dogfooding drove higher ROI than speculative integrations |

---

## 7. OPEN QUESTIONS

| Question | Impact | Notes |
|---|---|---|
| **Mobile-responsive CSS gaps** | High | Capacitor wraps the web app as-is. Which pages/components break on small screens? Touch targets, modals, DnD, sidebar — need a responsive audit before Capacitor ships |
| **WebView performance on effects** | High | 151 themes with particle effects, aurora, snowfall — will they run smoothly in mobile WebView? May need to auto-disable heavy effects on mobile or detect low-end devices |
| **Should Master Board block on virtual scrolling?** | High | Both are in analysis. Master Board without virtualization could be unusable at scale |
| **Web next: what ships while mobile builds?** | Medium | Web is mature but not frozen. Master Board, virtual scrolling, real-time all wait. Incremental UX polish runs in parallel (Phase 2.5) |
| **Real-time sync timing** | Resolved | Pusher shipped 07/04/2026. Sub-second push with 30s polling fallback. SSE rejected for serverless incompatibility. |
| **Push notifications architecture** | Medium | Capacitor has @capacitor/push-notifications plugin. But backend notification service (FCM/APNs) doesn't exist yet. Plan early or bolt on later? |
| **Tauri: kill or park?** | Low | Explicitly parked post-beta. PWA covers desktop install. Only revisit if beta users ask for offline/system tray/hotkeys |
| **Kairos: when do other users get in?** | Medium | 2026 is founder-only. Trigger for opening up = founder uses it daily for 30+ consecutive days without UX changes feeling necessary. Until then naming (Kairos, Dominion), grouping model, and capture surface are mutable |
| **BYOK merge window** | Medium | Foundation is built but unmerged. Should land before any *new* AI feature that's not Claude Code MCP-driven (daily briefings, agent-as-member, etc.). Migration 0014 reserved for it — newer Kairos migrations start at 0015 to avoid collision |
| **rawTranscript field?** | Low | Analyst recommended storing the unpolished voice/session transcript next to `bodyMd` so the original phrasing stays searchable. Pending decision — adds one nullable text column, no schema risk |

---

## 8. WEB + MOBILE + DESKTOP CONVERGENCE MAP

With Capacitor, mobile IS the web app. The convergence is now about what native features to layer on top.

| Layer | Web (browser) | Mobile (Capacitor) | Desktop (PWA) | Shared |
|---|---|---|---|---|
| **UI** | Full Next.js app | Same app in WebView | Same app via manifest | 100% shared |
| **Auth** | NextAuth session cookies | Bearer tokens (mobile-auth.ts) | NextAuth cookies | users/accounts tables |
| **Native features** | None | Push, haptics, biometrics (via plugins) | Install prompt, offline cache | -- |
| **Offline** | None | Future: service worker + Capacitor storage | Service worker cache | Service worker |
| **Performance** | Full browser engine | WebView (WKWebView/Chrome) | Full browser engine | -- |

### Convergence principles
- **One UI, multiple shells.** The web app IS the mobile app IS the desktop app. No separate UI codebases
- **Native features via plugins, not rewrites.** Capacitor adds push/haptics/biometrics as a layer on top
- **Auth is the only divergence.** Browser uses cookies, native app uses bearer tokens. Both authenticate the same users
- **PWA is the free win.** Costs almost nothing, covers desktop install + offline basics
- **Capacitor justifies App Store.** Native plugins (push, haptics) make it a "real" app, not just a website in a frame

---

## 9. PHASE MAP

| Phase | Name | Status | Key Deliverables |
|---|---|---|---|
| 1 | Close the Gaps | COMPLETE | Middleware fix, Gantt wired to DB, labels end-to-end, checklist integration, loading states |
| 1.5 | Hardening | COMPLETE | Realms with invites, REST API parity, lint cleanup (46 to 9), file splits, server-side loading, perf (auth caching, query dedup) |
| 2A | Mobile Auth Backend | COMPLETE | mobile-auth.ts (session tokens, Google OAuth endpoint), mobileSessions + mobileLoginTokens DB tables |
| 2B | PWA + Capacitor | IN PROGRESS | Enable PWA (manifest, service worker, icons), Capacitor spike (native shell pointing at deployed app) |
| 2C | Native Plugins | QUEUED | @capacitor/push-notifications, @capacitor/haptics, biometrics — justifies App Store packaging |
| 2D | Mobile Polish | QUEUED | Responsive CSS audit, touch target sizing, effect auto-disable on mobile, store submission prep |
| 2.5 | Web Polish | PARALLEL | Incremental UX fixes, minor feature gaps — runs alongside mobile |
| 3 | Performance | COMPLETE | Virtual scrolling (TanStack Virtual), optimistic UI rollback, Pusher real-time sync |
| 4 | Cross-Board | NOT STARTED | Master Board (cross-project aggregation), Rift Board, urgency lens, staleness surface |
| 5 | Collaboration | NOT STARTED | Chat (Pusher-based), notifications, agent dispatch, agent-as-member |
| K-0 | Kairos POC | IN PROGRESS | 3D cortex (skybox + orb shader), 2D cortex (d3-force), dynamic sidebar shell with `AEON : KAIROS` glow, view-switch regression fix, top bar cleanup |
| K-1 | Kairos memory display | COMPLETE | aiTitle + execSummary schema (migration 0015), MemorySidePanel rework (title + colour pills + bullets + collapsed body), graceful empty-state |
| K-2 | Kairos MCP capture path | NEXT | Extend MCP create_memory + update_memory to accept aiTitle + execSummary. Session-capture hook self-cleans via `claude --print` before sending. Optional `rawTranscript` field |
| K-3 | Dominion (grouping) | QUEUED | New top-level concept above Project. Schema (dominions, dominionRepos, projects.dominionId, memories.dominionId). Colour cascade. Auto-assign from sourceMetadata.repo. Replaces broken Realm colour mode |
| K-4 | 2D WebGL rebuild | QUEUED | Replace Canvas2D radial gradients with orthographic Three.js scene reusing the 3D orb shader. Real edge rendering. Fixes the "low-res Pokéball" look |
| K-5 | BYOK merge + extension AI features | BLOCKED | Waiting for feature/brain-ai-integration merge. Then: daily briefings, suggested links, agent-as-member, anything not Claude-Code-driven |

Note: Phase 2 pivoted from React Native to Capacitor on 03/04/2026. React Native code deleted 07/04/2026. 2A (auth backend) is reusable for Capacitor. 2B (PWA + Capacitor) is the current mobile focus. Phase 3 (Performance) shipped 07/04/2026. Tauri desktop explicitly parked.

K-phase (Kairos) runs in parallel with the PM-side phases. K-0 through K-4 explicitly do NOT depend on BYOK because the AI work happens inside Claude Code at the call site. K-5 onward unlocks server-side AI features once BYOK is merged.
