"""Incremental server-sent events parser."""

from collections.abc import Iterable, Iterator
from dataclasses import dataclass


@dataclass(frozen=True)
class SseEvent:
    """One dispatched SSE event."""

    event: str
    data: str


class SseParser:
    """Feeds SSE lines and dispatches events on blank lines."""

    def __init__(self) -> None:
        self._event = ""
        self._data: list[str] = []

    def feed(self, line: str) -> SseEvent | None:
        """Consume one line; return an event when one completes."""
        line = line.rstrip("\r\n")
        if not line:
            return self._dispatch()
        if line.startswith(":"):
            return None
        name, _, value = line.partition(":")
        if value.startswith(" "):
            value = value[1:]
        if name == "event":
            self._event = value
        elif name == "data":
            self._data.append(value)
        return None

    def close(self) -> SseEvent | None:
        """Flush a final event that lacked a trailing blank line."""
        return self._dispatch()

    def parse(self, lines: Iterable[str]) -> Iterator[SseEvent]:
        """Yield every event from a stream of lines."""
        for line in lines:
            event = self.feed(line)
            if event is not None:
                yield event
        tail = self.close()
        if tail is not None:
            yield tail

    def _dispatch(self) -> SseEvent | None:
        if not self._data and not self._event:
            return None
        event = SseEvent(self._event or "message", "\n".join(self._data))
        self._event = ""
        self._data = []
        return event
