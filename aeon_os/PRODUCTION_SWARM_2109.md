# Production Swarm research exercise — 21 September 2026

Status: production transport exercised; autonomous research acceptance failed.
Supervisor-completed HTML built and visually inspected; final separate
saved-evidence audit PASS. No autonomous PASS is claimed.

Final card state: **Landing / done / 100%**, moved by the supervisor after review.
Its visible result explicitly says supervisor-completed; rejected session history
remains recorded. The temporary report preview was stopped and port10709 verified
free, alongside runner port8790.

## Scope and configuration

Owner authorized a real AI Hangar Q&A card researching Belgium DA→IDA1/IDA2,
read-only production evidence, Swarm skills, and a full HTML research pack.
No trading, portfolio mutation, commit, push, or web deployment was authorized
or performed by this exercise.

- Project: AI Hangar, `6cdcc753-1ce7-4d15-9e1b-bacf930549cb`.
- Card: `ad6a4acc-e9e1-457b-9f6b-1c6ca56ed161`, **Q&A: Belgium DA to IDA scaling**.
- Registered repo: `swarm`, `c121ff9a-8b09-4750-829c-5c365a0bcd7f`.
- Source: canonical Swarm checkout, branch `feature/v3-follow-ups`, base
  `3aa52f9ae038537510fc94aed421b39e44b3b4fe`, with existing user edits preserved.
- Ignored `repos.local.yaml` maps Swarm to its canonical Windows path.
- Temporary local poll runner: concurrency1, port8790; explicit Sonnet5/high/long_context,
  800-credit ceiling. Persistent Opus5 default was not changed. Authenticated account
  model discovery did not offer that configured Opus model; Sonnet5 was chosen openly
  in accordance with the owner's preference, not silently substituted.
- Added legacy `settings.boardMode=hangar` to the existing enabled Hangar settings
  so currently shipped backend result routing works before the local UI changes ship.

## What was actually exercised

Production Aeon MCP session dispatch → real local poll claim/heartbeat → mission
worktree → Copilot CLI → canonical Swarm Python environment → production reads →
durable report files → result envelope → automatic Landing routing.
This is backend execution evidence, not authenticated browser Save & Launch proof.

Native Copilot skill discovery in the actual Swarm mission worktree found all seven
project skills: hive-ops, prod-db-reads, strat-research-report, swarm-qa, swarm-quant,
swarm-trader, vorath. Their required source contents matched the canonical checkout.
Personal `~/.copilot/skills` already resolves to the shared `~/.claude/skills` tree,
including inferno-swarm. No duplicated skill port was necessary. Scoped `--add-dir`
access allows canonical output and global skill reads. Python imports resolve the
existing `swarm_env_312` environment and canonical packages/configuration.

## Session and acceptance history

| Session | Execution | Research acceptance |
|---|---|---|
| `72885cca-30ba-450f-ac1b-d543046c0ab4` | Succeeded, 12:42–12:50UTC, observed claude-sonnet-5; HTML generated; automatically moved Flight→Landing | Rejected by supervisor: uppercase BE country filter gave false zero counts; primed state and dayless pending status misread; fresh CH evidence omitted; unsupported absence/forward claims |
| `fd1489e4-534a-482c-a298-66a87f47d70f` | Killed by supervisor at 13:07 UTC; kill propagated and mission worktree removed | Rejected: duplicated order counts after a fill join, missing attribution/day-size reconciliation, wrong frozen-gate comparison and omitted daily audit |

Supervisor moved the first returned card to Tower with explicit rejection comments,
then back to Flight only after the correction session was actually running. The
initial completed envelope is historical evidence of an inadequate answer, not a
passing research result. The first automatic Flight-to-Landing movement came from
the production result handler. After rejection, correction and independent review,
the final Landing/done/100% state was set explicitly by the supervisor.

## Durable output and evidence

Canonical Swarm output: `strat_research/2026-09-21_belgium_da_ida_scaling/`.
Executive/full markdown and HTML, meta.json, PORTING.md, README.md, query scripts,
timestamped extracts and capability notes are kept there, outside the disposable
mission worktree. Canonical report builder generates HTML and research INDEX.md.

Supervisor's independent `data/pg_verified_pull.py` uses the sanctioned SELECT-only
`overlord pg query --target ro` path. Corrected case-insensitive reads find73orders,
258GMA fill records and an armed DA→IDA2 buy with day-size overrides rising0.9→1.1MW.
Empty execution-day records and `no_vault` reconciliation remain explicit evidence
gaps, not reasons to deny recorded fills. The parent independently queried ten
predetermined matched IDA1/IDA2 strategies (627 unique daily rows each through
19 September), price coverage and conservative common-day sensitivity. It
reassembled the final report from these verified extracts. See `data/verified_*`
and `data/assemble_report.py` in the Swarm output directory.

The canonical builder generated both HTML files and the research index. Executive
source has 749 words and two tables. Desktop Chromium inspection at 1440px found
no horizontal page overflow; all 18 local full-report evidence links returned200.
Screenshot is ignored `.cache/belgium-mission/executive.png`. Initial preview
favicon404 was harmless; full-report navigation had no console errors. Browser
report rendering is separate from signed-in Aeon UI acceptance.

Native `/root/belgium_final_audit` independently audited the accepted saved data
and scripts and returned PASS with no arithmetic, window, direction or claim
blockers. Its scope excluded new live reads and independently checking the
source/auction references; the parent checked those. Swarm
`data/notes/final_review.md` records the review; `data/validation.json` records
artifact SHA256 hashes and delivery checks. Final card acceptance is explicitly
supervisor-completed, with rejected mission history preserved.

All owned mission sessions are terminal; no other queued/running coding cards
were found before shutdown. Temporary runner PID47676 was stopped and port8790
is free. Product mission worktree was removed; canonical reports survived. Existing
unrelated worktrees, user services and pre-existing Swarm changes were preserved.

## Limits

- At the time of this exercise, v0.29.0 mission-card/repository UI was unshipped; the later release is tracked in PR #130.
- Test browser reached Aeon login; no authenticated UI acceptance yet.
- No automatic independent content review gate was added. The supervisor caught
  substantive errors after the initial completed result automatically reached Landing.
- Runner was an owned temporary process, not a continuously supervised host service.
- Canonical output is a deliberate mission-specific workaround; general artifact
  publication, draft PRs and recovery/supervision are still unfinished.
- No trading changes or application source changes in Swarm.
