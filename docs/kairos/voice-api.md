# Vorath voice line — server contract

For the desk app (Windows tray, later Android). Two owner-only routes. Both are auxiliary
routes outside the MCP/REST parity invariant, like `kairos/speak`.

Windows client: [`apps/vorath-desk/`](../../apps/vorath-desk/README.md).

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

The turn runs through Vorath's normal chat engine: the same memory, tools and reply recording
as web chat, with a voice-sized grounding bundle so the first words come sooner (see
[Latency](#latency)). It always uses the owner's paid key on Claude
Sonnet 5.5, never the Max routine. Speaking is an explicit owner action, so the paid-backup
switch (which governs automatic paid fallbacks) does not apply. Both sides of the turn are saved in the voice thread, so they appear in
the chat history and in the nightly memory capture. The reply uses a spoken register:
2–3 sentences of plain speech, no formatting, at most one question.

### Response: `text/event-stream`

```
event: ack
data: {"threadId":"…"}

event: delta
data: {"text":"The Swarm build finished overnight without errors,"}

event: delta
data: {"text":"but it is waiting on your approval."}

event: delta
data: {"text":"Want me to open it?"}

event: done
data: {"threadId":"…","userSeq":7,"assistantSeq":8,"text":"The Swarm build finished overnight without errors, but it is waiting on your approval. Want me to open it?","model":"claude-sonnet-5-5","streamed":true,"ms":2140,"timing":{…}}
```

- `ack`: sent the moment the turn is accepted, before any lookup or model call, so the client can
  play a short earcon. It carries the `threadId`. Clients should ignore events they don't know.
- `delta`: a piece of plain speech, in order. Send each one to TTS as it arrives. A piece is one or
  more whole sentences, or, once a sentence has run on for about six words, the clause before a comma,
  semicolon or dash. A clause piece keeps that comma, semicolon or dash at its end. The last piece is
  sent as soon as the model finishes, before the reply is saved.
- `done`: always the last event on success. `text` is always the saved reply as plain speech.
  **If no `delta` arrived (`streamed:false`), speak `done.text`.** If `replaced:true`, the saved reply
  differs from what the deltas said (for example a time-out answer), so stop and speak `done.text`.
  Otherwise it's for display and logs. `timing` is the stage breakdown (see [Timing](#timing)).
- `error`: the last event on failure, as `{"reason","message","threadId"}`. `reason` is usually
  `ai_failed`, `ai_empty`, `no_credential` or `thread_not_found`.
  The owner's words are already saved. Retrying the same text after two minutes answers the saved
  turn without saving it twice.

Deltas are a best effort. A plain question streams: each piece goes out as soon as the
model finishes it. When the question asks for a lookup ("what's the latest on…", "check…",
a board, today's activity, an undo), Vorath uses his tools first, and that answer arrives in
one go, split into pieces, a few seconds later.

### Timing

`done.timing` shows where the turn's time went. Every value is in milliseconds, measured from the
moment the route received the request (network time to and from the client isn't included).
A value is `null` when its step didn't run.

| Field | Meaning |
|---|---|
| `routeMs` | Auth, rate limit, the paid-key and thread checks, and opening the stream |
| `threadMs` | Saving the owner's turn (runs alongside the grounding reads) |
| `retrievalMs` | Memory retrieval as a whole (the Aether doc, archetypes and memory hits) |
| `embeddingMs` | Embedding the question (Voyage), inside retrieval |
| `rerankMs` | Reranking (Voyage). Always `null` on the voice line, which skips it |
| `sections` | Each other grounding read: `history`, `dominion`, `pendingAsk`, `board`, `recency`, `conscience`, `today` |
| `groundedMs` | When the prompt was ready |
| `promptChars` | Size of the prompt sent to the model |
| `modelCallMs` | When the model call started |
| `modelFirstTokenMs` | From the model call to its first text |
| `modelTotalMs` | From the model call to the end of the answer |
| `saveMs` | Saving the reply after the answer |
| `firstDeltaMs`, `totalMs`, `deltas` | First `delta` sent, the whole turn, and how many pieces were sent |
| `tools`, `toolRounds`, `plainCalls` | Whether the lookup tools were offered, and the model calls made |

The same object is logged as `[kairos-voice] turn timing`. The fields can grow; ignore any you
don't know.

### Latency

The server works to get the first words out quickly:

- **Voice-sized grounding.** The prompt carries the Aether doc, three archetypes and four
  memory hits, all clipped short, plus a short "today" digest and the last 12 messages.
  Web chat gets more of each. The owner-model, stage and cold-read blocks are web-only.
  All grounding reads start at the same time.
- **Lighter retrieval.** The memory hits keep the combined keyword-and-meaning order. Voice skips
  the reranking call, the related-memory expansion, the named-entity read and the trace read, and
  only reads as many rows as the prompt shows. The question is embedded while the keyword search runs.
- **No repeated reads.** The thread the route reads for its checks is reused. The owner's turn
  is saved while the grounding is read, and the model call starts as soon as both are done. Your
  words are always saved before the model is called. The daily spend check is read during
  the route checks, so the model call doesn't wait on it.
- **Tools only when asked.** A quick word check decides whether the question needs a lookup.
  It makes no model call. Other questions are answered in one streamed call with no tools.
  If the answer isn't in his context, Vorath says so and offers to look it up, and a reply
  like "yes, look it up" brings the tools back.
- **Clause pieces and an early last piece.** See `delta` above.
- **Work nobody hears runs later.** Checking whether the turn answers Vorath's open
  question, and reinforcing the memories he cited, both run after the reply is saved.
  They no longer delay `done`.

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
  when Vorath uses a tool, plus one short classifier call after the reply when he has an open question.
- The feed makes no model calls.
