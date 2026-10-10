"""Microphone capture and PCM playback through sounddevice."""

import threading
from typing import Any

from loguru import logger

from vorath_desk.errors import AudioDeviceError
from vorath_desk.models import AudioClip


class MicRecorder:
    """Records 16-bit mono PCM from the default input device."""

    def __init__(self, sample_rate: int = 16000) -> None:
        self._sample_rate = sample_rate
        self._lock = threading.Lock()
        self._chunks: list[bytes] = []
        self._stream: Any = None

    def start(self) -> None:
        """Open the default microphone and start capturing."""
        import sounddevice as sd

        with self._lock:
            self._chunks = []
        try:
            self._stream = sd.RawInputStream(
                samplerate=self._sample_rate, channels=1, dtype="int16", callback=self._capture
            )
            self._stream.start()
        except sd.PortAudioError as exc:
            self._stream = None
            raise AudioDeviceError(f"Cannot open the microphone: {exc}") from exc

    def stop(self) -> AudioClip:
        """Stop capturing and return what was recorded."""
        import sounddevice as sd

        stream, self._stream = self._stream, None
        if stream is not None:
            try:
                stream.stop()
                stream.close()
            except sd.PortAudioError as exc:
                logger.warning("Microphone did not close cleanly: {}", exc)
        with self._lock:
            pcm = b"".join(self._chunks)
        return AudioClip(pcm, self._sample_rate)

    def _capture(self, indata: Any, frames: int, time_info: Any, status: Any) -> None:
        if status:
            logger.debug("Mic status: {}", status)
        with self._lock:
            self._chunks.append(bytes(indata))


class SoundDevicePlayer:
    """Plays raw 16-bit mono PCM chunks on the default output device."""

    def __init__(self, sample_rate: int) -> None:
        self._sample_rate = sample_rate
        self._stream: Any = None

    def open(self) -> None:
        """Open the output stream."""
        import sounddevice as sd

        try:
            self._stream = sd.RawOutputStream(samplerate=self._sample_rate, channels=1, dtype="int16")
            self._stream.start()
        except sd.PortAudioError as exc:
            raise AudioDeviceError(f"Cannot open the speaker: {exc}") from exc

    def write(self, pcm: bytes) -> None:
        """Play one chunk, blocking until it is buffered."""
        import sounddevice as sd

        if self._stream is not None and pcm:
            try:
                self._stream.write(pcm)
            except sd.PortAudioError as exc:
                raise AudioDeviceError(f"Speaker write failed: {exc}") from exc

    def close(self, drain: bool) -> None:
        """Close the stream, letting buffered audio finish when drain is set."""
        import sounddevice as sd

        stream, self._stream = self._stream, None
        if stream is None:
            return
        try:
            if drain:
                stream.stop()
            else:
                stream.abort()
            stream.close()
        except sd.PortAudioError as exc:
            logger.warning("Speaker did not close cleanly: {}", exc)
