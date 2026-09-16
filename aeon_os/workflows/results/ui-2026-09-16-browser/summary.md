# Browser check — 2026-09-16 (Playwright, production, authenticated as owner)

Scope: the one acceptance item REST could not cover — a real Save & Launch from the board UI on the
test project `e4b0af95-d3ad-46ba-8275-1ecc28911683`. Not a soak; one pass, console watched throughout.

| Step | Result |
|---|---|
| Dashboard → project context menu → Edit → **Auto AI** toggle on → Save | Saved; `settings.hangar.enabled=true` confirmed via API; modal closed; 0 console errors |
| Board → Add card in Queued → Card menu | "Make AI card" appears only once Auto AI is on (correct gating) |
| Mission editor | Repo list empty with the amber hint "No repos in this realm's Hangar registry" because the project was in no realm. Added it to the AI Engineering realm for the check → `Aeon (aeon)`, `ARQ (arq)` listed |
| Model picker | Catalog switches per engine (copilot: sonnet-5, gpt-5.6-sol…; claude: sonnet-5, opus-5, fable-5-1, haiku-4-5). "Custom model ID" reveals a text input; choosing a catalog model hides it again |
| Save & Launch (copilot, recon, aeon, gpt-5.6-sol) | Editor closes; card shows `aeon · recon`; session `ff624071` created `queued` with `metadata.hangar.model=gpt-5.6-sol` |
| Cleanup | Session killed via MCP, card deleted, project removed from the realm, minted login session deleted |

Console errors across dashboard, project modal, board and editor: **0**.

Finding for the backlog: a project outside any realm cannot launch from the browser (repo registry is
realm-scoped), while REST spawn accepts any slug. The editor already says so in amber; the gap is that the
harness's own test project is created realm-less.
