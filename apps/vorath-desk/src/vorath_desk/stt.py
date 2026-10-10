"""Speech-to-text providers: Deepgram (paid) and faster-whisper (local)."""

from collections.abc import Callable
from typing import Any

import httpx
from loguru import logger

from vorath_desk.errors import TranscriptionError
from vorath_desk.keys import Secret
from vorath_desk.models import AudioClip

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"


class DeepgramSTT:
    """Transcribes a held clip with Deepgram's prerecorded REST endpoint."""

    def __init__(self, http: httpx.Client, api_key: Secret, model: str = "nova-3", language: str = "en") -> None:
        self._http = http
        self._api_key = api_key
        self._model = model
        self._language = language

    def transcribe(self, clip: AudioClip) -> str:
        """Send the clip as WAV and return the top transcript."""
        params = {"model": self._model, "smart_format": "true", "language": self._language}
        headers = {"Authorization": f"Token {self._api_key.reveal()}", "Content-Type": "audio/wav"}
        try:
            response = self._http.post(DEEPGRAM_URL, params=params, headers=headers, content=clip.to_wav())
        except httpx.TransportError as exc:
            raise TranscriptionError(f"Deepgram unreachable: {type(exc).__name__}") from None
        if response.status_code != 200:
            raise TranscriptionError(f"Deepgram returned {response.status_code}")
        try:
            channels = response.json()["results"]["channels"]
            return str(channels[0]["alternatives"][0]["transcript"]).strip()
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise TranscriptionError(f"Unexpected Deepgram response: {type(exc).__name__}") from None


def _load_whisper(model_name: str) -> Any:
    from faster_whisper import WhisperModel

    return WhisperModel(model_name, device="cpu", compute_type="int8")


class WhisperSTT:
    """Transcribes locally with faster-whisper; the model loads on first use."""

    def __init__(
        self,
        model_name: str = "base.en",
        language: str = "en",
        loader: Callable[[str], Any] | None = None,
    ) -> None:
        self._model_name = model_name
        self._language = language
        self._loader = loader or _load_whisper
        self._model: Any = None

    def transcribe(self, clip: AudioClip) -> str:
        """Run the local model over the clip."""
        import numpy as np

        if clip.sample_rate != 16000:
            raise TranscriptionError("Local transcription needs 16 kHz audio")
        audio = np.frombuffer(clip.pcm, dtype=np.int16).astype(np.float32) / 32768.0
        try:
            segments, _info = self._ensure_model().transcribe(
                audio, language=self._language, beam_size=1, vad_filter=True
            )
            return " ".join(segment.text.strip() for segment in segments).strip()
        except (RuntimeError, OSError, ValueError) as exc:
            raise TranscriptionError(f"Local transcription failed: {exc}") from exc

    def _ensure_model(self) -> Any:
        if self._model is None:
            logger.info("Loading faster-whisper model {} (first run downloads it)", self._model_name)
            self._model = self._loader(self._model_name)
        return self._model
