"""Plain data types shared across the app."""

import io
import wave
from dataclasses import dataclass, field


@dataclass(frozen=True)
class DeltaEvent:
    """One or more whole sentences of the reply."""

    text: str


@dataclass(frozen=True)
class DoneEvent:
    """Final event of a successful turn."""

    text: str
    streamed: bool = True
    replaced: bool = False


@dataclass(frozen=True)
class ErrorEvent:
    """Final event of a failed turn."""

    reason: str
    message: str = ""


TurnEvent = DeltaEvent | DoneEvent | ErrorEvent


@dataclass(frozen=True)
class FeedItem:
    """One alert from the voice feed."""

    id: str
    kind: str
    text: str
    title: str = ""
    urgency: str = "normal"
    at: str = ""


@dataclass(frozen=True)
class FeedPage:
    """A feed response: new items plus the cursor for the next poll."""

    items: tuple[FeedItem, ...] = field(default_factory=tuple)
    next: str | None = None


@dataclass(frozen=True)
class AudioClip:
    """Mono 16-bit PCM audio."""

    pcm: bytes
    sample_rate: int

    @property
    def seconds(self) -> float:
        """Clip duration in seconds."""
        return len(self.pcm) / 2 / self.sample_rate if self.sample_rate else 0.0

    def to_wav(self) -> bytes:
        """Encode the clip as a WAV file."""
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(self.sample_rate)
            writer.writeframes(self.pcm)
        return buffer.getvalue()
