# Multi-user Kairos — plan

4 October 2026. Board card: AI Mission Control → "Kairos: multi-user — bring your own key or Claude plan" (Depot).

## The short answer

Kairos already keeps each person's thinking separate: every user has their own memories, thinking queue, API keys and paid-backup switch, and a second person's own Claude plan can already answer their overnight and hourly thinking through the Aeon connector. What is still wired to one person is the outer layer: Telegram, the chat routine, a few scheduled messages and the feature switches. Those live in Vercel settings today, so they apply to the whole app.

**Owner decision (04/10):** every user picks one engine. We start with two:

| Engine | Who pays | Replies | Status |
|---|---|---|---|
| **Your own API key (BYOK)** | The user's own Anthropic / OpenAI / Google key | Instant | Mostly built |
| **Your own Claude plan** | The user's own Pro or Max plan, through their own brain, pulse and chat routines | 30–90 s for chat | Built for thinking; chat and Telegram are owner-only |
| Aeon pays (later) | Aeon, inside a subscription | Instant | Not started |

Telegram stays first-class for everyone.

## Already fixed

- **Privacy fix (#156, live 04/10):** every Kairos message used to go to the owner's Telegram whichever user it was for, so another user's weekly review would have reached the owner. Now only the owner's messages go there; everyone else's stay in their own inbox.

## Phases

| # | Goal | Main pieces | Done when |
|---|---|---|---|
| 1 | **One Aeon bot, many people** | A table linking each user to their Telegram chat; "Connect Telegram" button that opens the bot with a one-time code; messages routed by chat; button taps checked against the linked person; the owner's link created automatically | Two test users each chat with Kairos in their own Telegram; taps from the wrong person are refused |
| 2 | **Each user's own chat routine** | Routine id + token saved per user, encrypted like API keys; the setup checklist walks each user through creating their routines and pasting the token; "Test" button | A second user's message wakes *their* routine, not the owner's |
| 3 | **Scheduled messages for everyone** | 06:00 message, nudges, predictions, the timing gate and the weekly card run for every user who switched them on, at their own time; feature switches become per-user (the Vercel switch stays as an upper limit) | The hourly sweep stays within its time budget with hundreds of users |
| 4 | **Engine choice and limits** | Per-user "engine" setting (own key or own Claude plan); with a key, chat answers instantly instead of waiting for a routine; daily and hourly limits per user; groundwork for the Aeon-paid tier | A user can switch engines; one user's backlog can't slow others |

## Risks

- The chat routine and Telegram code assume one person in about 37 files; changing them touches chat, the 06:00 message and the setup screens.
- Phase 1 needs one new table (the first in a while): a reviewed, versioned migration.
- Telegram limits how fast one bot can send (~30 messages a second): the 06:00 message must be spread out.
- Routines are a research preview from Anthropic: limits and the API may change, and each person's runs count against their own plan.

## Open questions (my recommended default)

1. Health alerts for other users → their own inbox only; admins see counts, not content.
2. New users' features → off by default; each switched on per person.
3. 06:00 message time → per-user, default 06:00 UK time.
4. Group chats → private chats only for now.
5. Default engine → own key if they've added one, otherwise own Claude plan once their brain routine has run.
