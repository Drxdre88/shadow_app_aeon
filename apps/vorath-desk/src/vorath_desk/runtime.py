"""Shared runtime state: speech queue, conversation tracking and status."""

import threading
from collections import deque
from collections.abc import Callable

from loguru import logger

from vorath_desk.errors import DeskError
from vorath_desk.protocols import TTS

IDLE, LISTENING, THINKING, SPEAKING, PAUSED = "idle", "listening", "thinking", "speaking", "paused"


class Speaker:
    """Speaks queued sentences in order on one worker thread; stop() barges in."""

    def __init__(self, tts: TTS, on_speaking: Callable[[bool], None] | None = None) -> None:
        self._tts = tts
        self._on_speaking = on_speaking
        self._cond = threading.Condition()
        self._pending: deque[str] = deque()
        self._busy = False
        self._closed = False
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        """Start the playback worker."""
        self._thread = threading.Thread(target=self._run, name="vorath-speaker", daemon=True)
        self._thread.start()

    def say(self, text: str) -> None:
        """Queue one sentence."""
        if not text.strip():
            return
        with self._cond:
            self._pending.append(text.strip())
            self._cond.notify_all()

    def stop(self) -> None:
        """Drop queued sentences and interrupt the current one."""
        with self._cond:
            self._pending.clear()
        self._tts.stop()

    def wait_idle(self, timeout: float | None = None) -> bool:
        """Block until nothing is queued or playing; False on timeout."""
        with self._cond:
            return self._cond.wait_for(lambda: not self._pending and not self._busy, timeout)

    def close(self) -> None:
        """Stop playback and end the worker."""
        self.stop()
        with self._cond:
            self._closed = True
            self._cond.notify_all()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def _run(self) -> None:
        while True:
            with self._cond:
                self._cond.wait_for(lambda: self._pending or self._closed)
                if self._closed:
                    return
                text = self._pending.popleft()
                self._busy = True
            self._notify(True)
            self._speak(text)
            with self._cond:
                drained = not self._pending
            if drained:
                self._notify(False)
            with self._cond:
                if not self._pending:
                    self._busy = False
                    self._cond.notify_all()

    def _speak(self, text: str) -> None:
        try:
            self._tts.speak(text)
        except DeskError as exc:
            logger.warning("Could not speak a sentence: {}", exc)

    def _notify(self, speaking: bool) -> None:
        if self._on_speaking is not None:
            self._on_speaking(speaking)


class Conversation:
    """Counts turns in progress and tells listeners when it goes quiet."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._active = 0
        self._on_idle: list[Callable[[], None]] = []

    @property
    def active(self) -> bool:
        """True while a recording or turn is in progress."""
        with self._lock:
            return self._active > 0

    def on_idle(self, callback: Callable[[], None]) -> None:
        """Register a callback for when the last turn ends."""
        self._on_idle.append(callback)

    def begin(self) -> None:
        """Mark a turn as started."""
        with self._lock:
            self._active += 1

    def end(self) -> None:
        """Mark a turn as finished, firing idle callbacks at zero."""
        with self._lock:
            self._active = max(0, self._active - 1)
            idle = self._active == 0
        if idle:
            for callback in self._on_idle:
                callback()


class Toggles:
    """Owner switches from the tray: mute alerts and pause."""

    def __init__(self, muted: bool = False, paused: bool = False) -> None:
        self.muted = muted
        self.paused = paused


class StatusBoard:
    """Derives one status word from the app's activity flags."""

    def __init__(self, toggles: Toggles) -> None:
        self._toggles = toggles
        self._lock = threading.Lock()
        self._flags = {LISTENING: False, THINKING: False, SPEAKING: False}
        self._listeners: list[Callable[[str], None]] = []
        self._last = IDLE

    def subscribe(self, listener: Callable[[str], None]) -> None:
        """Call listener whenever the status word changes."""
        self._listeners.append(listener)

    def set(self, flag: str, value: bool) -> None:
        """Set one activity flag."""
        with self._lock:
            self._flags[flag] = value
        self.refresh()

    @property
    def status(self) -> str:
        """The current status word."""
        if self._toggles.paused:
            return PAUSED
        with self._lock:
            for flag in (LISTENING, SPEAKING, THINKING):
                if self._flags[flag]:
                    return flag
        return IDLE

    def refresh(self) -> None:
        """Notify listeners if the status changed."""
        status = self.status
        with self._lock:
            changed, self._last = status != self._last, status
        if changed:
            for listener in self._listeners:
                listener(status)
