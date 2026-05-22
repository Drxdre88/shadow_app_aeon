# Multi-agent coordination — Brain build-out

**Drafted:** 2026-05-21
**Owner:** the user (Andrey).
**Purpose:** orchestrate three parallel Claude agents on the Aeon Brain build-out so they don't step on each other.

---

## 1. The three tracks at a glance

| Track | Doc | Branch | Owner | Touches |
|---|---|---|---|---|
| **A — Cortex visual polish** | `07-cortex-polish-handoff.md` | `feature/cortex-swarm-port` | Agent 1 | `apps/web/src/components/brain/Cortex3D.tsx` + new `cortex/` subdir |
| **B — Hyperspace + Notes UX** | `08-hyperspace-notes-handoff.md` | `feature/hyperspace-notes-ux` | Agent 2 | `apps/web/src/app/notes/*`, `apps/web/src/components/hyperspace/*`, dashboard widgets |
| **C — AI integration** | `09-ai-integration-handoff.md` | `feature/brain-ai-integration` | Agent 3 | `apps/web/src/lib/ai/*`, new endpoints under `apps/web/src/app/api/v1/brain/*` and `memories/[id]/*` |

All three branch from `feature/hyperspace_notes` (current development branch).

---

## 2. Where each track ends and the next begins

### Track A owns
- The Cortex 3D scene (everything inside `<Canvas>`)
- Custom shaders (planets, stars, nebulae)
- Post-processing chain
- Camera + idle orbit

### Track B owns
- `/notes` page and bento layout
- Quick Capture overlay (extending the existing one)
- Dashboard widgets (EOD, Daily Briefing, FAB)
- Promote-to-card flow

### Track C owns
- Anthropic SDK setup
- All AI-augmented endpoints (`auto-tag`, `briefing`, `suggest-links`, `promote`)
- Voice STT hook
- The Talk button on the capture rail (depends on Track A's selective-highlight hook)

### Boundaries that need coordination

1. **`MemorySidePanel.tsx`** — Track B uses it (right-click promote), Track C adds the `<SuggestedLinks>` section. **Convention:** B owns the panel structure; C adds slots via prop drilling or context. PR order: B first if they're racing.

2. **`CaptureRail.tsx`** — Track A renders it in the Cortex layout, Track C wires the Talk button. **Convention:** A leaves a `<TalkButton>` placeholder slot; C fills it. Both PRs must reference the same slot name.

3. **Daily Briefing card** — Track B creates it (calls raw `prepare_context`), Track C upgrades it (calls the new `/api/v1/brain/briefing` endpoint). **Order:** B ships first with raw prepare_context; C upgrades when their endpoint lands. No merge conflict — single-line API swap.

4. **`createMemory` flow** — Track C adds the auto-tag fire-and-forget. Track B uses `createMemory` directly. **Convention:** C wraps `createMemory` server action; B is unaffected.

5. **Cortex node highlight** — Track A exposes a `focusNodeIds(ids: string[])` event/store; Track C consumes it (voice command lights up nodes). **Order:** A creates the hook + emitter; C subscribes when Tier 3 lands.

---

## 3. Shared resources

### Files that all three can read but only one can edit

| File | Owner |
|---|---|
| `apps/web/src/lib/db/schema.ts` | Track C (only adds `dailyBriefings` table if needed) |
| `apps/web/src/lib/data/memories.ts` | **Nobody** — frozen for this batch. If a track needs a query change, comment in PR and wait for sync. |
| `apps/web/src/lib/actions/memories.ts` | Track C (wraps createMemory for auto-tag) |
| `apps/web/src/lib/data/validators.ts` | **Nobody** — frozen. |
| `apps/web/src/app/layout.tsx` | Track B (mounts FAB) |
| `apps/web/src/components/sidebar/AppSidebar.tsx` | Track B (adds Notes nav) |

### Files unique to each track — no overlap

All under their respective directories listed above.

---

## 4. Merge order

Plan: each track ships independently, but landing order matters for visible value to the user.

**Recommended order**:

1. **Track A (Cortex polish)** lands first. This is the most visually impactful and the user has been waiting on it. No cross-track dependencies for the merge.
2. **Track B (Notes UX)** lands second. Adds the `/notes` page and dashboard widgets. Daily Briefing card initially renders raw `prepare_context`.
3. **Track C (AI integration)** lands third in tiers:
   - Tier 1 (auto-tag) — invisible to UI; ships safely anytime
   - Tier 2 (briefing) — upgrades B's card via a one-line endpoint swap
   - Tier 3 (voice) — needs A's focusNodeIds hook
   - Tier 4 (suggest-links) — needs B's side panel slot
   - Tier 5 (promote PBI) — independent

If a track gets blocked, the others continue. The architecture is intentionally decoupled.

---

## 5. Shared conventions

These apply to ALL three agents:

- **CLAUDE.md is law.** Read it before code. Especially the three-layer data flow + MCP/REST parity invariant + Aeon-dev card-tracking workflow.
- **Tests stay green.** Every track runs `npm run typecheck --workspace=apps/web` + `npm run test --workspace=apps/web` before commit. The pre-push hook will block otherwise.
- **No new server actions or routes unless absolutely needed.** Comment in the PR if you find yourself adding one. The user wants minimal API surface expansion this round.
- **Aeon board card tracking** — `aeon-dev-live` skill handles this. The MCP may not be connected in some agent sessions; if so, agents skip board updates and note "MCP not available" in their summary.
- **No comments-on-everything.** Per CLAUDE.md: only comment when WHY is non-obvious.
- **Commits** use the conventional `feat(brain):` / `fix(brain):` / `docs(brain):` prefix.

---

## 6. Communication mechanism between agents

Since the three agents don't share a session:

1. **Specs are the contract.** Tracks A/B/C handoff docs define the boundaries. Don't deviate without updating the doc.
2. **PR descriptions describe what shipped + what's open.** Subsequent agents read prior PRs as ground truth, not just docs.
3. **`ARCHITECTURE.md` is the rendezvous point.** When a track finishes a significant phase, run `inferno-architect` to update it. Other agents read the freshest version before starting.
4. **The user is the conflict-resolver.** If two tracks want to edit the same file, both stop and ask the user.

---

## 7. State of the codebase at handoff time

### Last commit on `feature/hyperspace_notes`

```
5e38cad docs(brain): Cortex screen + Hyperspace capture handoff spec
```

### Uncommitted on the working tree (current session has NOT committed yet)

```
M apps/web/package.json                                      # R3F + force-graph deps added
M apps/web/src/app/api/v1/memories/route.ts                  # +?graph=true mode
M apps/web/src/app/layout.tsx                                # +<QuickCaptureOverlay/>
M apps/web/src/components/sidebar/AppSidebar.tsx             # +Brain nav icon
M apps/web/src/lib/actions/memories.ts                       # +getBrainGraph; removed memoriesTable re-export
M apps/web/src/lib/data/memories.ts                          # +getGraphForUser, edge synthesis (day/tag/repo), GraphNode.repo
M apps/web/src/components/ui/help/shared.tsx                 # LucideIcon type (R3F JSX collision fix)
M apps/web/src/components/trophy/TrophyTimeline.tsx          # LucideIcon type (same)
M package-lock.json

?? apps/web/src/app/brain/                                   # /brain route
?? apps/web/src/components/brain/                            # current Cortex3D + helpers
?? apps/web/src/components/hyperspace/QuickCaptureOverlay.tsx
?? apps/web/public/cortex/                                   # asset folders (empty placeholders)
?? apps/web/src/app/api/v1/projects/resolve/                 # name → id resolver
?? apps/web/scripts/brain-anchor-backfill.mjs                # backfill ran successfully against prod
?? docs/brain/07-cortex-polish-handoff.md                    # Track A spec
?? docs/brain/08-hyperspace-notes-handoff.md                 # Track B spec
?? docs/brain/09-ai-integration-handoff.md                   # Track C spec
?? docs/brain/10-multi-agent-coordination.md                 # this file
```

### Live in prod DB (already mutated)

17 Claude-session memories have been backfilled with `projectId` + `realmId` anchors:
- 11× SWARM APP (realm: AI Engineering)
- 3× VISOR APP (realm: AI Engineering)
- 1× Shadow Dev Lab (realm: AI Engineering)
- 2× AEON APP (realm: AEON Dev)

### Action item before agents start

The user (Andrey) needs to:
1. Commit and push the current uncommitted work to `feature/hyperspace_notes` (this becomes the base for all three new branches).
2. Open three parallel Claude sessions, each pointed at the appropriate handoff doc.
3. Provide `ANTHROPIC_API_KEY` to Track C if not already in `.env.local`.

Suggested commit (current session's main agent should run before signing off):
```bash
git add .
git commit -m "feat(brain): Cortex MVP + Hyperspace + repo-anchoring + multi-agent handoff specs"
git push origin feature/hyperspace_notes
```

---

## 8. Long-term parallelisation philosophy

The pattern that's emerging:
- **Substrate work** (data model, server actions, lib/data) — single agent, single session, careful.
- **Surface work** (routes, components, pages) — parallelisable across many agents IF surfaces don't share files.
- **Intelligence work** (AI calls, agents, retrieval tuning) — parallelisable IF endpoints don't share data layer functions.

The three tracks above respect this. They share the data layer (frozen) and split the surface + intelligence work cleanly.

Future build-outs (after this batch ships):
- Track E — selective bloom + WebGPU exploration (if Track A's performance becomes an issue)
- Track F — embeddings + semantic search (when memory count > 100)
- Track G — multi-user realm collaboration on the brain (when the platform grows)
- Track H — Mobile/PWA Cortex optimisations (2D fallback below 768px viewport)

---

## 9. Status of THIS session (what spawned the handoff)

The user has been pushing for visual polish on the Cortex (the `/brain` view). Multiple iterations landed:
- v1 (cortex_v1.png): 17 unconnected dots — fixed via repo-anchoring + auto-edge synthesis
- v2 (cortex_v2.png): clustering working, repo-colours visible, but flat circles
- v3 (cortex_v3.png): bloom + nebulae + post-FX, but "shit circles" (the halo + corona shells), generic stars, flat planets

The user pointed at `cortex_concept.png` (AI-generated target) and `shadow_app_swarm` as the SOTA reference. The current session was iterating on visual polish without copying Swarm's actual recipe — that's the mistake the Track A handoff exists to correct.

**The user's framing — `MY ULTIMATE EDGE IS MORPHING -> TAKING SOMETHING AMAZING AND MAKING IT BETTER`** — should guide all three tracks. Don't reinvent. Port and morph from the codebases that already nailed the patterns.

---

## 10. Closing note from the previous session's main agent

If you're an agent picking up one of these tracks: read your doc end-to-end. Then read the corresponding source files (Swarm for Track A; existing brain code for Tracks B + C). Then write code. Trust the conventions; question the implementations when they don't match the docs.

The user will catch you reinventing.
