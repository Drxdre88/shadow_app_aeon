"""Text-to-speech providers: ElevenLabs streaming (paid) and Windows SAPI (free)."""

import threading
from collections.abc import Callable
from typing import Any, Protocol

import httpx
from loguru import logger

from vorath_desk.audio import SoundDevicePlayer
from vorath_desk.errors import AudioDeviceError, SpeechError
from vorath_desk.keys import Secret

ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"
ELEVENLABS_RATE = 22050


class LogTTS:
    """Writes sentences to the log instead of speaking; for quiet text mode."""

    def __init__(self, label: str = "Vorath") -> None:
        self._label = label

    def speak(self, text: str) -> None:
        """Log the sentence."""
        logger.info("{}: {}", self._label, text)

    def stop(self) -> None:
        """Nothing is playing."""


class PcmPlayer(Protocol):
    """Somewhere to play raw 16-bit mono PCM."""

    def open(self) -> None:
        """Open the device."""
        ...

    def write(self, pcm: bytes) -> None:
        """Play a chunk."""
        ...

    def close(self, drain: bool) -> None:
        """Close the device."""
        ...


class ElevenLabsTTS:
    """Streams PCM from ElevenLabs and plays it as it arrives."""

    def __init__(
        self,
        http: httpx.Client,
        api_key: Secret,
        voice_id: str,
        model: str = "eleven_flash_v2_5",
        player_factory: Callable[[int], PcmPlayer] | None = None,
    ) -> None:
        self._http = http
        self._api_key = api_key
        self._voice_id = voice_id
        self._model = model
        self._player_factory = player_factory or SoundDevicePlayer
        self._stopped = threading.Event()

    def speak(self, text: str) -> None:
        """Stream one sentence to the speaker, stopping early on stop()."""
        self._stopped.clear()
        url = ELEVENLABS_URL.format(voice_id=self._voice_id)
        headers = {"xi-api-key": self._api_key.reveal(), "Accept": "audio/pcm"}
        body = {"text": text, "model_id": self._model}
        player = self._player_factory(ELEVENLABS_RATE)
        try:
            with self._http.stream(
                "POST", url, params={"output_format": f"pcm_{ELEVENLABS_RATE}"}, json=body, headers=headers
            ) as response:
                if response.status_code != 200:
                    response.read()
                    raise SpeechError(f"ElevenLabs returned {response.status_code}")
                self._play(response.iter_bytes(), player)
        except httpx.HTTPError as exc:
            raise SpeechError(f"ElevenLabs stream failed: {type(exc).__name__}") from None

    def stop(self) -> None:
        """Interrupt playback at the next chunk."""
        self._stopped.set()

    def _play(self, chunks: Any, player: PcmPlayer) -> None:
        player.open()
        leftover = b""
        try:
            for chunk in chunks:
                if self._stopped.is_set():
                    break
                data = leftover + chunk
                cut = len(data) - len(data) % 2
                player.write(data[:cut])
                leftover = data[cut:]
        finally:
            player.close(drain=not self._stopped.is_set())


def _init_sapi_engine() -> Any:
    import pyttsx3

    try:
        import comtypes

        comtypes.CoInitialize()
    except (ImportError, OSError) as exc:
        logger.debug("COM init skipped: {}", exc)
    return pyttsx3.init()


class SapiTTS:
    """Speaks with the built-in Windows voices through pyttsx3; offline and free."""

    def __init__(
        self,
        rate: int = 185,
        voice: str = "",
        volume: float = 1.0,
        engine_factory: Callable[[], Any] | None = None,
    ) -> None:
        self._rate = rate
        self._voice = voice
        self._volume = volume
        self._engine_factory = engine_factory or _init_sapi_engine
        self._engine: Any = None
        self._stopped = threading.Event()

    def speak(self, text: str) -> None:
        """Speak one sentence; the engine lives on the calling thread."""
        self._stopped.clear()
        try:
            engine = self._ensure_engine()
            engine.say(text)
            engine.runAndWait()
        except (RuntimeError, OSError, AudioDeviceError) as exc:
            raise SpeechError(f"Windows speech failed: {exc}") from exc

    def stop(self) -> None:
        """Ask the engine to stop at the next word."""
        self._stopped.set()

    def _on_word(self, name: Any, location: int, length: int) -> None:
        if self._stopped.is_set() and self._engine is not None:
            self._engine.stop()

    def _ensure_engine(self) -> Any:
        if self._engine is None:
            engine = self._engine_factory()
            engine.setProperty("rate", self._rate)
            engine.setProperty("volume", self._volume)
            if self._voice:
                self._pick_voice(engine)
            engine.connect("started-word", self._on_word)
            self._engine = engine
        return self._engine

    def _pick_voice(self, engine: Any) -> None:
        wanted = self._voice.lower()
        for voice in engine.getProperty("voices"):
            if wanted in str(voice.name).lower() or wanted == str(voice.id).lower():
                engine.setProperty("voice", voice.id)
                return
        logger.warning("SAPI voice {!r} not found; using the default", self._voice)
