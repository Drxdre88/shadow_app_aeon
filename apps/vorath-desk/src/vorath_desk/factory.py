"""Builds the desk's collaborators from config and key files."""

from concurrent.futures import ThreadPoolExecutor

import httpx
from loguru import logger

from vorath_desk.app import DeskApp, DeskParts
from vorath_desk.audio import MicRecorder
from vorath_desk.client import HttpVorathClient
from vorath_desk.config import DeskConfig, DeskPaths
from vorath_desk.feed import FeedAnnouncer, FeedLoop, FeedPoller, FeedStateStore
from vorath_desk.hotkey import PynputHotkey
from vorath_desk.keys import KeyStore
from vorath_desk.protocols import STT, TTS
from vorath_desk.runtime import SPEAKING, Conversation, Speaker, StatusBoard, Toggles
from vorath_desk.stt import DeepgramSTT, WhisperSTT
from vorath_desk.tray import PystrayTray
from vorath_desk.tts import ElevenLabsTTS, SapiTTS
from vorath_desk.turn import TurnRunner

USER_AGENT = "vorath-desk/0.1"


class DeskFactory:
    """Creates providers and the app; owns the shared HTTP client."""

    def __init__(self, config: DeskConfig, paths: DeskPaths, keys: KeyStore) -> None:
        self._config = config
        self._paths = paths
        self._keys = keys
        self._http = httpx.Client(
            timeout=httpx.Timeout(10.0, read=120.0), headers={"User-Agent": USER_AGENT}, follow_redirects=False
        )

    def close(self) -> None:
        """Close the HTTP client."""
        self._http.close()

    def client(self) -> HttpVorathClient:
        """The Aeon voice client using the owner's key file."""
        return HttpVorathClient(self._http, self._config.base_url, self._keys.aeon(), self._config.thread_key)

    def stt(self) -> STT:
        """Deepgram when chosen or keyed, else local faster-whisper."""
        cfg = self._config.stt
        key = self._keys.read("deepgram") if cfg.provider in ("auto", "deepgram") else None
        if key is not None:
            logger.info("STT: Deepgram {}", cfg.deepgram_model)
            return DeepgramSTT(self._http, key, cfg.deepgram_model, cfg.language)
        if cfg.provider == "deepgram":
            logger.warning("STT: deepgram chosen but {} is missing; using local whisper", self._keys.path("deepgram"))
        logger.info("STT: local faster-whisper {}", cfg.whisper_model)
        return WhisperSTT(cfg.whisper_model, cfg.language)

    def tts(self) -> TTS:
        """ElevenLabs when chosen, keyed and voiced, else Windows SAPI."""
        cfg = self._config.tts
        key = self._keys.read("elevenlabs") if cfg.provider in ("auto", "elevenlabs") else None
        if key is not None and cfg.elevenlabs_voice_id:
            logger.info("TTS: ElevenLabs {}", cfg.elevenlabs_model)
            return ElevenLabsTTS(self._http, key, cfg.elevenlabs_voice_id, cfg.elevenlabs_model)
        if cfg.provider == "elevenlabs":
            logger.warning("TTS: elevenlabs chosen but key file or voice id is missing; using Windows voice")
        logger.info("TTS: Windows SAPI")
        return SapiTTS(cfg.sapi_rate, cfg.sapi_voice)

    def feed_poller(self, client: HttpVorathClient) -> FeedPoller:
        """A poller that keeps its cursor in the state file."""
        return FeedPoller(client, FeedStateStore(self._paths.state))

    def app(self) -> DeskApp:
        """Assemble the full tray app."""
        toggles = Toggles()
        status = StatusBoard(toggles)
        speaker = Speaker(self.tts(), on_speaking=lambda speaking: status.set(SPEAKING, speaking))
        conversation = Conversation()
        client = self.client()
        announcer = FeedAnnouncer(speaker, conversation, toggles)
        parts = DeskParts(
            hotkey=PynputHotkey(self._config.hotkey),
            recorder=MicRecorder(self._config.sample_rate),
            stt=self.stt(),
            speaker=speaker,
            runner=TurnRunner(client, speaker),
            feed_loop=FeedLoop(self.feed_poller(client), announcer.announce, toggles, self._config.feed_interval_s),
            conversation=conversation,
            status=status,
            toggles=toggles,
            input_executor=ThreadPoolExecutor(max_workers=1, thread_name_prefix="vorath-input"),
            turn_executor=ThreadPoolExecutor(max_workers=1, thread_name_prefix="vorath-turn"),
            base_url=self._config.base_url,
            min_clip_s=self._config.min_clip_s,
        )
        return DeskApp(parts, lambda app: PystrayTray(toggles, app.toggled, app.open_aeon, app.quit))
