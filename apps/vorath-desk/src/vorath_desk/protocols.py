"""Extension points: the small protocols every collaborator implements."""

from collections.abc import Callable, Iterator
from typing import Protocol

from vorath_desk.models import AudioClip, FeedPage, TurnEvent


class STT(Protocol):
    """Turns a recorded clip into text."""

    def transcribe(self, clip: AudioClip) -> str:
        """Return the transcript, or an empty string for silence."""
        ...


class TTS(Protocol):
    """Speaks one sentence, blocking until done or stopped."""

    def speak(self, text: str) -> None:
        """Speak the text and return when finished or interrupted."""
        ...

    def stop(self) -> None:
        """Interrupt the sentence being spoken, if any."""
        ...


class VorathClient(Protocol):
    """Talks to the Aeon voice routes."""

    def stream_turn(self, text: str) -> Iterator[TurnEvent]:
        """Send one turn and yield its events in order."""
        ...

    def fetch_feed(self, since: str | None) -> FeedPage:
        """Fetch feed items newer than the cursor."""
        ...


class Recorder(Protocol):
    """Records the default microphone between start and stop."""

    def start(self) -> None:
        """Begin capturing audio."""
        ...

    def stop(self) -> AudioClip:
        """Stop capturing and return the clip."""
        ...


class Hotkey(Protocol):
    """Global push-to-talk key that reports press and release."""

    def start(self, on_press: Callable[[], None], on_release: Callable[[], None]) -> None:
        """Start listening for the key combination."""
        ...

    def stop(self) -> None:
        """Stop listening."""
        ...


class Tray(Protocol):
    """System tray surface showing status and menu actions."""

    def run(self, on_ready: Callable[[], None]) -> None:
        """Block on the tray loop, calling on_ready once it is up."""
        ...

    def show_status(self, status: str) -> None:
        """Reflect the current status in the icon and tooltip."""
        ...

    def stop(self) -> None:
        """Remove the icon and end the loop."""
        ...
