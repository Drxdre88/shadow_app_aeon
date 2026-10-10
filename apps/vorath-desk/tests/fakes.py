"""Hardware-free fakes shared by the tests."""

import threading
from collections.abc import Iterator

from vorath_desk.errors import DeskError
from vorath_desk.models import AudioClip, FeedPage, TurnEvent


class FakeTTS:
    """Records spoken sentences; can block until released to test barge-in."""

    def __init__(self) -> None:
        self.spoken: list[str] = []
        self.stops = 0
        self.gate: threading.Event | None = None
        self.started = threading.Event()

    def speak(self, text: str) -> None:
        self.spoken.append(text)
        self.started.set()
        if self.gate is not None:
            self.gate.wait(5)

    def stop(self) -> None:
        self.stops += 1
        if self.gate is not None:
            self.gate.set()


class FakeClient:
    """Plays back scripted turn events or raises a scripted error."""

    def __init__(self, events: list[TurnEvent] | None = None, error: DeskError | None = None) -> None:
        self.events = events or []
        self.error = error
        self.turns: list[str] = []
        self.pages: list[FeedPage] = []
        self.since: list[str | None] = []

    def stream_turn(self, text: str) -> Iterator[TurnEvent]:
        self.turns.append(text)
        if self.error is not None:
            raise self.error
        yield from self.events

    def fetch_feed(self, since: str | None) -> FeedPage:
        self.since.append(since)
        if self.error is not None:
            raise self.error
        return self.pages.pop(0) if self.pages else FeedPage((), since)


class FakeSTT:
    """Returns a fixed transcript."""

    def __init__(self, text: str) -> None:
        self.text = text
        self.clips: list[AudioClip] = []

    def transcribe(self, clip: AudioClip) -> str:
        self.clips.append(clip)
        return self.text


class FakeRecorder:
    """Returns a clip of the configured length without a microphone."""

    def __init__(self, seconds: float = 1.0) -> None:
        self.seconds = seconds
        self.started = 0

    def start(self) -> None:
        self.started += 1

    def stop(self) -> AudioClip:
        return AudioClip(b"\x00\x00" * int(16000 * self.seconds), 16000)

