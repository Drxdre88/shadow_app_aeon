# Card and project files: separate scoping session

**22 September 2026 · planning only · no schema, storage or live configuration changes**

## What stopped the earlier feature

The earlier implementation never reached the current branch. Commit `603408c` on `feat/checklist-cross-group-drag`, dated **9 July 2026**, explicitly marked itself “Not for ship” pending Blob configuration and browser verification. It is not an ancestor of the inspected release. The current schema, migrations, routes, UI and package dependencies do not contain that attachment feature.

This was unfinished release work, not a fundamental inability to store files. The old missing-token note is historical. No live Blob store or token configuration was inspected, so it must not be presented as a verified current blocker.

The WIP was task-only, public Blob storage with a 5 MB limit and selected Markdown/CSV/image/PDF/text types. It did not implement HTML or project-level files. It is useful design reference, not a safe cherry-pick.

## Why the prototype needs rework

| Finding from the historical commit | Consequence for the new design |
| --- | --- |
| Callers supplied Blob URL, path and size without proving the upload | A file record could refer to an unrelated or unverified object. Reserve and verify a server-owned object key. |
| Public Blob URLs | Revoking project membership did not revoke access to a leaked URL. Use private storage and authenticated downloads. |
| REST/MCP used a helper that accepts viewer membership | Viewer access could become mutation authority. Use role-aware member/editor/owner checks consistently. |
| Database record deleted before best-effort Blob deletion | Failed deletes can orphan storage. Persist deletion state and reconcile. |
| User/task/project cascades removed metadata without reliable storage cleanup | File lifecycle must be managed explicitly before parent deletion removes the references. |
| No project Files, HTML contract, quotas or tests | The first usable iteration must cover both requested scopes and their error cases. |

Historical source can be inspected with `git show 603408c:<path>` without switching branches. Do not reuse its migration numbering: the current migrations already use those numbers for unrelated features.

## Recommended first complete release

Build a **project-owned private file library**, with an optional association to one existing card in that same project. A user can upload HTML, Markdown, PDF and a small explicit set of ordinary file types to either the project's Files view or a card's Files section. Authorized members can list/download; editors can add/remove under the agreed role policy. Viewers remain read-only.

Use the existing application stack and Vercel private Blob as the initial storage candidate. Validate the supported SDK version and deployment configuration during implementation, then pin it in the lockfile. This plan does not install or provision anything.

Vercel's current SDK distinguishes the older `handleUpload` client-token flow, which requires a static read-write token, from `handleUploadPresigned`, which supports OIDC-backed signed uploads. Therefore the July token problem is not an unavoidable requirement for the new design. Store/project linkage and callback configuration still need verification. [Official SDK documentation](https://vercel.com/docs/vercel-blob/using-blob-sdk), checked 22 September 2026.

## User experience

- **Card:** a quiet Files section in the shared card content, usable from the regular modal and pinned card window. Add/select or drop a file, show progress, then show filename, type, size, date and download/remove actions.
- **Project:** Files entry from the project surface, with project-level files and an explicit way to see associated card files. Show their scope so a file never appears to have moved merely because it was uploaded from a different screen.
- **Failures:** visible unsupported type, size/quota, upload failure, access loss and deletion failure states, with bounded retry. Never mark a pending file ready because the browser says its upload completed.
- **HTML:** download as an attachment initially. Do not execute uploaded HTML on Aeon's origin. If interactive preview is later required, design an isolated origin/sandbox and resource policy as a separate acceptance gate.
- **Markdown/PDF:** downloadable in the first slice. A sanitized Markdown reader or constrained PDF viewer can follow; raw HTML within Markdown must not become application markup.

Supporting various files does not mean accepting executable files or unlimited types by default. Start with explicit HTML, MD, PDF, TXT, CSV and common raster images; make the exact allowed types and limits visible and configurable. The old 5 MB limit is a historical value, not a silently imposed new product decision.

## Data and access contract

- A project-owned attachment row has a nullable card association, creator/audit information, original filename, generated storage key, content type, verified byte size, timestamps and lifecycle state. Validate that any linked card belongs to the same project.
- Reserve ownership, an unpredictable immutable object key and quota before issuing upload authority. Scope that authority to the reserved object, permitted type/size and a short expiry.
- On completion, verify the actual stored object against the reservation. Do not accept an arbitrary client URL as authority. Record ready only after verification; expired pending records and partial blobs need cleanup.
- Download by attachment ID through a fresh project-access check. Choose authenticated streaming for the initial strict access contract, with suitable private/no-store caching and attachment headers. Do not expose a permanent public URL.
- Define quota accounting for concurrent uploads and deletion. Record deletion requested/deleted states and retry Blob removal; do not discard the only cleanup reference on a network error.
- Parent/card/user deletion, project transfer, card copy/fusion and archive must have an explicit file policy. Default proposal: archive retains within project access; a card copy does not silently grant another project access to the source file; transfers reauthorize and preserve audit ownership.

Private Blob retrieval and server-side authorization are supported patterns, but the application must implement them correctly. File extension, declared MIME and client size are insufficient validation by themselves. [Vercel private storage](https://vercel.com/docs/vercel-blob/private-storage), [OWASP file-upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

## Multi-phase implementation scope

### F1 — contract and infrastructure readiness

Agree the access/lifecycle/type/size/quota contract. Verify a private store for preview/development and production separately, compatible SDK support and callback configuration without printing credentials. Choose authenticated download and a verified upload-finalization path. This is a preparation gate, not authorization to mutate production infrastructure.

### F2 — storage and data foundation

Implement project-owned attachment schema/migration, role guards, reservations, constrained upload authority, verified completion, listing, download and deletion/reconciliation. Mirror metadata operations across actions/REST/MCP under the existing parity convention. Binary transfer uses its dedicated upload/download API; it is not transported as arbitrary MCP text.

### F3 — card and project interface

Integrate Files into shared card content and the project surface, with consistent compact presentation and explicit upload/error/empty states. Confirm keyboard selection, copyable filenames, touch access and download naming. Keep HTML download-only until a separate preview contract is approved and tested.

### F4 — lifecycle and failure qualification

Cover parent deletion, archive/copy/transfer policy, abandoned uploads, duplicate callbacks, expired authority, revoked membership, concurrent quotas, Blob outage and database failure. Verify no stored file loses its cleanup reference. Test authenticated preview upload/download/delete only after configured test storage exists; live production is not a test fixture.

## Implementation ownership and paths

| Owner/lane | Paths and responsibility |
| --- | --- |
| Parent integration | `apps/web/src/lib/db/schema.ts`, new correctly numbered migration, package/lockfile, shared validators and MCP registration |
| Storage/data worker | New `lib/data/attachments.ts` and narrow Blob adapter/reservation/finalization modules; cleanup/reconciliation |
| Action/API worker, after data contract | New `lib/actions/attachments.ts`, `app/api/v1/projects/[id]/attachments/**`, corresponding MCP metadata tools |
| UI worker | Shared `components/board/TaskEditContent.tsx` integration plus a focused file section; project Files integration in `app/project/[id]/ProjectContent.tsx` and dedicated components |
| Verification lane | Role/ownership and Blob-mocked failure tests first; configured isolated preview exercise later |

These are proposed paths, not existing implementation. Keep schema and registrations under one owner; do not let parallel workers independently invent competing file models.

## Relationship to Agent OS artifacts

Share the private storage mechanics, not an undifferentiated document row. Ordinary attachments represent user-supplied project/card files. Mission outputs need immutable attempt identity, manifest/hash, source revision, review linkage, delivery state and preservation before teardown. An agent must not be able to overwrite a previously accepted report by reusing its filename.

The Agent OS plan's durable-delivery phase consumes this storage contract. Mission artifact success must follow verified storage; the fact that an upload widget works is not sufficient mission finalization evidence.

## Acceptance matrix

| Test | Pass condition |
| --- | --- |
| Card and project upload | HTML/MD/PDF work at both scopes, linked card belongs to project, lists remain consistent |
| Read/write role matrix | Member/viewer reads where permitted; editor writes; non-member and revoked access denied |
| Forged object or cross-project binding | Arbitrary URL/key/card ID cannot be finalized or attached |
| Limits and parallel reservations | Oversize/type/quota checks are enforced server-side without overbooking |
| Failed and duplicated completion | Pending state is honest; retry/callback is idempotent; partial objects are reclaimed |
| Deletion/parent lifecycle | Storage failures retain cleanup state; no cascade silently abandons private objects |
| HTML delivery | Download response does not execute content in Aeon's origin; filename/content-type headers are controlled |
| Mission reuse | Output readback matches manifest after worker teardown; user-file edits cannot change accepted result identity |

Vercel documents that ordinary completion callbacks cannot reach localhost without an accessible callback URL. Plan local testing around a deliberate verified finalize path or an isolated reachable preview; do not call a local-only mock a storage acceptance test. [Client-upload documentation](https://vercel.com/docs/vercel-blob/client-upload).

## Remaining decisions and status

Implementation needs agreed operational limits (per-file and per-project), retention/restore policy, eventual HTML preview requirements and verified store/deployment configuration. These do not block the scope recommendation: deliver private downloads on both card and project scopes first, with complete ownership and cleanup.

**Status:** separate reconnaissance and scope complete. No attachment code, dependency, migration, storage resource or live credential was changed. Rebuild from the current architecture; use the July WIP only as reference.
