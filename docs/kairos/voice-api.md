# Vorath voice line — server contract

For the desk app (Windows tray, later Android). Two owner-only routes. Both are auxiliary
routes outside the MCP/REST parity invariant, like `kairos/speak`.

## Auth

- Send `Authorization: Bearer aeon_k1_…`: an Aeon API key created by the owner (Settings → API keys).
- Every non-owner gets **404**, the same answer as a route that doesn't exist.
- Rate limits are per IP, and each voice route has its own bucket, so other REST calls don't count:
  the turn route allows 30 a minute and the feed allows 60 a minute.
  Over the limit you get **429** with a `Retry-After` header.

## 1. Talk: `POST /api/v1/kairos/voice/turn`

Request body (JSON):

| Field | Type | Notes |
|---|---|---|
| `text` | string, 1–4000 | What the owner said, already transcribed |
| `threadKey` | string, optional | Letters, digits and `_ . : -`, up to 80. Picks a separate voice thread (for example one per device). Leave it out to use the single "Voice · Vorath" thread. |

The turn runs through Vorath's normal chat engine: the same grounding, memory, tools,
owner model and reply recording as web chat. It always uses the owner's paid key on Claude
Sonnet 5.5, never the Max routine. Speaking is an explicit owner action, so the paid-backup
switch (which governs automatic paid fallbacks) does not apply. Both sides of the turn are saved in the voice thread, so they appear in
the chat history and in the nightly memory capture. The reply uses a spoken register:
2–3 sentences of plain speech, no formatting, at most one question.

### Response: `text/event-stream`

```
event: delta
data: {"text":"The Swarm build is waiting on your approval."}

event: delta
data: {"text":"Want me to open it?"}

event: done
data: {"threadId":"…","userSeq":7,"assistantSeq":8,"text":"The Swarm build is waiting on your approval. Want me to open it?","model":"claude-sonnet-5-5","streamed":true,"ms":2140}
```

- `delta`: one or more whole sentences of plain speech, in order. Send each one to TTS as it arrives.
- `done`: always the last event on success. `text` is always the saved reply as plain speech.
  **If no `delta` arrived (`streamed:false`), speak `done.text`.** If `replaced:true`, the saved reply
  differs from what the deltas said (for example a time-out answer), so stop and speak `done.text`.
  Otherwise it's for display and logs.
- `error`: the last event on failure, as `{"reason","message","threadId"}`. `reason` is usually
  `ai_failed`, `ai_empty`, `no_credential` or `thread_not_found`.
  The owner's words are already saved. Retrying the same text after two minutes answers the saved
  turn without saving it twice.

Deltas are a best effort. When Vorath looks something up with a tool, the answer arrives in
one go and is split into sentences. The first sentence can take a few seconds while he
reads his brain.

### Errors before the stream starts (JSON `{error, code?}`)

| Status | When |
|---|---|
| 400 | Bad body (empty `text`, a bad `threadKey`) |
| 401 | Missing or invalid key |
| 404 | Not the owner |
| 409 | `code: "no_paid_key"`: no usable paid AI key (none saved, or it can't be decrypted). There's no fallback, so ask the owner to add one in Aeon. `code: "turn_in_progress"`: the thread's last turn is still unanswered and under two minutes old. Wait for its `done` before sending the next one. |
| 429 | Rate limited |
| 500 | Server error |

## 2. Alerts: `GET /api/v1/kairos/voice/feed?since=<ISO>&limit=<n>`

Poll it **every 5 seconds**. Send the previous response's `next` as `since`.

- `since`: an ISO timestamp, exclusive. It defaults to 15 minutes ago and is clamped to the last 24 hours.
- `limit`: defaults to 20, capped at 50.

```json
{
  "items": [
    {
      "id": "morghul:3f…",
      "at": "2026-10-10T09:58:12.345Z",
      "kind": "morghul",
      "title": "Needs you: Swarm build waiting on approval",
      "text": "The Swarm session has been waiting on a tool approval for twelve minutes.",
      "urgency": "high",
      "sourceId": "3f…"
    }
  ],
  "next": "2026-10-10T09:58:12.345Z"
}
```

- `kind`:
  - `morghul`: a live Morghul relay, either a memory with `sourceMetadata.kind: "morghul_finding"`
    or one captured with `channel: "morghul"`.
  - `question`: an open Vorath ask.
  - `speak`: a question Vorath sent.
- `urgency`: `low`, `normal` or `high`. Morghul relays use `sourceMetadata.urgency` when it's set.
  Otherwise a "needs you" title is `high` and a "resolved" title is `low`.
- `text` is plain speech of at most about 400 characters, with the markdown stripped.
  You can read it out as it is, with no model call.
- The feed never includes Morghul rollups or digests, reflections, briefs, the daily message,
  ops alerts or notify speaks.
- The feed is read-only. It sends no Telegram message, marks nothing as read and never makes
  Vorath wait for a reply. The desk app should remember the item `id`s it has already spoken.

## Cost

- Each turn is one paid Claude Sonnet 5.5 call (the `voice_chat` task, not the heavy chat tier), plus up to four lookup rounds
  when Vorath uses a tool.
- The feed makes no model calls.
