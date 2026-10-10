# Vorath Desk

A small Windows tray app for talking to Vorath. Hold a hotkey, speak, let go: Vorath
answers out loud, sentence by sentence. It also reads out new alerts from Morghul and
Vorath's open questions every few seconds.

Server contract: [`docs/kairos/voice-api.md`](../../docs/kairos/voice-api.md).

## Setup (about 6 steps)

1. **Install Python 3.12 and hatch** (`pip install hatch`; `hatch --version` should work).
2. **Create the env** from this folder:
   ```powershell
   cd apps/vorath-desk
   hatch env create vorath_desk_env_312
   ```
3. **Put the Aeon key in a file.** In Aeon, go to Settings → API keys, create an owner key
   (`aeon_k1_…`), and save it as the only line of `%USERPROFILE%\.vorath-desk\aeon.key`.
4. **Optional paid voices.** Save keys as `deepgram.key` and/or `elevenlabs.key` in the same
   folder, and put your ElevenLabs voice id in `config.toml` (see below). Without them the app
   uses free local speech recognition and the built-in Windows voice.
5. **Check it without a mic:**
   ```powershell
   hatch -e vorath_desk_env_312 run vorath-desk feed --once --quiet
   hatch -e vorath_desk_env_312 run vorath-desk say "Hello Vorath, quick check."
   ```
6. **Start the tray app:** `hatch -e vorath_desk_env_312 run vorath-desk` (with a console),
   or `vorath-desk-tray` from the env's `Scripts` folder (no console window). Pin it to
   Startup if you want it on at login.

## Key files

All keys live in `%USERPROFILE%\.vorath-desk\` as one-line text files. The app never takes keys
from environment variables or the command line, and never writes them to the log.

| File | Needed | Used for |
|---|---|---|
| `aeon.key` | yes | Bearer key for the voice turn and feed routes |
| `deepgram.key` | no | Deepgram speech recognition |
| `elevenlabs.key` | no | ElevenLabs voice (also needs `elevenlabs_voice_id`) |

## Hotkey

Default **Ctrl+Alt+V**. Hold it to record from the default microphone, release it to send.
Pressing it while Vorath is talking cuts him off (barge-in). Taps shorter than 0.3 s are ignored.
Change it in `config.toml`, for example `hotkey = "ctrl+shift+space"`.

## Tray

The icon colour shows the status: grey idle, red listening, amber thinking, green speaking, dark
when paused. The tooltip says the same. The menu has **Mute alerts** (the feed is still read but
not spoken), **Pause** (hotkey and feed off), **Open Aeon** and **Quit**.

Alerts that arrive while you're talking to Vorath wait until the turn ends. Morghul alerts start
"Morghul says:", questions start "Vorath asks:". The feed cursor and the spoken item ids are kept
in `state.json`, so a restart doesn't repeat alerts.

## Config

`%USERPROFILE%\.vorath-desk\config.toml`. Every setting is optional:

```toml
base_url = "https://aeon.shadow-lab.ai"
hotkey = "ctrl+alt+v"
feed_interval_s = 5.0
thread_key = ""            # empty = the shared "Voice · Vorath" thread
min_clip_s = 0.3

[stt]
provider = "auto"          # auto | deepgram | whisper
deepgram_model = "nova-3"
whisper_model = "base.en"  # or tiny.en for slower PCs
language = "en"

[tts]
provider = "auto"          # auto | elevenlabs | sapi
elevenlabs_voice_id = ""
elevenlabs_model = "eleven_flash_v2_5"
sapi_rate = 185
sapi_voice = ""            # part of a Windows voice name, e.g. "Zira"
```

`auto` picks the paid provider when its key file exists (and, for ElevenLabs, a voice id is
set), otherwise the free local one.

## Providers

| Job | Paid | Free fallback |
|---|---|---|
| Speech to text | Deepgram Nova-3, one request per held clip | faster-whisper on the CPU (`base.en`, downloaded on first use, about 150 MB) |
| Text to speech | ElevenLabs Flash v2.5, streamed as raw audio | Windows built-in voices through pyttsx3 (offline) |

## Costs

- **Aeon:** each turn is one paid Claude call on the owner's key (see the server contract).
  The alert feed makes no model calls.
- **Deepgram:** billed per audio minute; a few seconds per turn. Check current pricing.
- **ElevenLabs:** billed per character from your plan's credits; Flash is the cheapest tier.
- **Local fallbacks:** free.

## Commands

```text
vorath-desk               start the tray app (same as "run")
vorath-desk say "text"    send one typed turn and speak the reply (--quiet logs it instead)
vorath-desk feed --once   poll the alert feed once (--quiet logs items instead)
vorath-desk --home DIR    use another settings folder
vorath-desk -v            debug logging
```

Logs go to the console and to `%USERPROFILE%\.vorath-desk\desk.log`.

## Troubleshooting

- **Nothing happens on the hotkey.** Another app may own the combo; pick another. Keys typed
  into apps running as administrator aren't seen unless Vorath Desk also runs as administrator.
- **"Key file … is missing"** — create `aeon.key` as in step 3. It must start with `aeon_k1_`.
- **404 / "Aeon didn't accept the desk key"** — the key isn't an owner key, or it was revoked.
- **"There's no paid AI key in Aeon"** (409 `no_paid_key`) — add a paid AI key in Aeon settings.
- **"I'm still on your last message"** (409 `turn_in_progress`) — wait for the reply to finish.
- **"I can't open the microphone"** — Windows Settings → Privacy & security → Microphone →
  allow desktop apps. Check the default recording device.
- **First local transcription is slow** — the whisper model is downloading. Use `tiny.en` on
  slow machines.
- **Antivirus warns about the app** — a global keyboard hook looks like a keylogger to some
  scanners. Allow the env's `python.exe` / `vorath-desk.exe` if you trust it.
- **Windows voice can't be cut off mid-word** — SAPI stops at the next word boundary;
  ElevenLabs stops within one audio chunk.

## Development

```powershell
hatch run vorath_desk_env_312:test        # pytest, no audio hardware needed
```
