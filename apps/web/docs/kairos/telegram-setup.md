# Kairos in the gram — Telegram bot setup

Kairos speaks first through Telegram: `/api/v1/kairos/speak` fans messages out
to your chat with inline triage buttons, and anything you type back is piped
into the whole-brain Kairos chat (one persistent `Telegram · Kairos` thread).

## 1. Create the bot (BotFather)

1. Open Telegram, talk to [@BotFather](https://t.me/BotFather).
2. `/newbot` → pick a display name (e.g. `Kairos`) and a unique username
   (e.g. `my_kairos_bot`).
3. BotFather replies with the **bot token** (`123456789:AA...`). That is
   `TELEGRAM_BOT_TOKEN`.
4. Optional polish: `/setuserpic`, `/setdescription`.

## 2. Find your chat id

Send any message to your new bot first (bots cannot message you until you do),
then:

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates" | python -m json.tool
```

Look for `"chat": { "id": 123456789, ... }` in the reply — that number is
`TELEGRAM_OPERATOR_CHAT_ID`. (If the response is empty, message the bot again
and re-run.)

## 3. Set the webhook (with secret token)

Pick a random secret (1–256 chars, only `A-Z a-z 0-9 _ -`) for
`TELEGRAM_WEBHOOK_SECRET`, then register the webhook:

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<your-aeon-domain>/api/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query"]
  }'
```

Telegram will echo the secret back on every delivery in the
`X-Telegram-Bot-Api-Secret-Token` header; the webhook route rejects anything
else with 401. Verify with:

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

## 4. Env vars (Vercel → Project → Settings → Environment Variables)

| Variable | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather (step 1) |
| `TELEGRAM_OPERATOR_CHAT_ID` | Your chat id (step 2) — the ONLY chat the bot serves |
| `TELEGRAM_WEBHOOK_SECRET` | The secret you passed to `setWebhook` (step 3) |
| `KAIROS_OPERATOR_USER_ID` | Your Aeon user id (uuid from the `users` table) — scopes all brain access |

Also required (already set for cron): `CRON_SECRET` — bearer token for
`POST /api/v1/kairos/speak`.

Redeploy after setting them.

## 5. Smoke test

```bash
curl -s "https://<your-aeon-domain>/api/v1/kairos/speak" \
  -H "Authorization: Bearer <CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{ "title": "Hello from Kairos", "message": "Telegram channel is live.", "kind": "notify" }'
```

Expected: `{ "id": "...", "delivered": { "inbox": true, "telegram": true } }`,
a Telegram message with a **Dismiss** button, and a matching notify card in the
Kairos inbox bell. Tap Dismiss — the card should clear from the inbox too.
Then type anything to the bot: Kairos should answer from the whole brain
(or say the brain is offline if no BYOK key is configured).
