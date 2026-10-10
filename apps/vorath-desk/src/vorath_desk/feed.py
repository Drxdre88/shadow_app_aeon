"""Alert feed: poll, remember the cursor, and speak or queue new items."""

import json
import threading
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from loguru import logger

from vorath_desk.errors import AeonUnreachableError, RateLimitedError, VorathHttpError
from vorath_desk.models import FeedItem
from vorath_desk.protocols import VorathClient
from vorath_desk.runtime import Conversation, Speaker, Toggles

MAX_REMEMBERED_IDS = 500


@dataclass
class FeedState:
    """The feed cursor and the ids already spoken."""

    next: str | None = None
    spoken_ids: list[str] = field(default_factory=list)


class FeedStateStore:
    """Persists FeedState as a small JSON file."""

    def __init__(self, path: Path) -> None:
        self._path = path

    def load(self) -> FeedState:
        """Read the state, or a fresh one if missing or corrupt."""
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return FeedState()
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("Ignoring unreadable feed state {}: {}", self._path, exc)
            return FeedState()
        ids = raw.get("spoken_ids", []) if isinstance(raw, dict) else []
        cursor = raw.get("next") if isinstance(raw, dict) else None
        return FeedState(cursor if isinstance(cursor, str) else None, [str(i) for i in ids][-MAX_REMEMBERED_IDS:])

    def save(self, state: FeedState) -> None:
        """Write the state atomically."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        payload = {"next": state.next, "spoken_ids": state.spoken_ids[-MAX_REMEMBERED_IDS:]}
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        tmp.replace(self._path)


class FeedPoller:
    """Fetches the feed from the stored cursor and returns unseen items."""

    def __init__(self, client: VorathClient, store: FeedStateStore) -> None:
        self._client = client
        self._store = store
        self._state = store.load()

    @property
    def cursor(self) -> str | None:
        """The cursor the next poll will send."""
        return self._state.next

    def poll_once(self) -> list[FeedItem]:
        """Fetch once, advance the cursor, and return items not yet spoken."""
        page = self._client.fetch_feed(self._state.next)
        seen = set(self._state.spoken_ids)
        fresh = [item for item in page.items if item.id not in seen]
        if page.next:
            self._state.next = page.next
        self._state.spoken_ids.extend(item.id for item in fresh)
        self._state.spoken_ids = self._state.spoken_ids[-MAX_REMEMBERED_IDS:]
        self._store.save(self._state)
        return fresh


def announcement(item: FeedItem) -> str:
    """The sentence spoken for a feed item."""
    body = item.text.strip() or item.title.strip()
    if item.kind == "morghul":
        return f"Morghul says: {body}"
    return f"Vorath asks: {body}"


class FeedAnnouncer:
    """Speaks feed items, holding them while a conversation is active."""

    def __init__(self, speaker: Speaker, conversation: Conversation, toggles: Toggles) -> None:
        self._speaker = speaker
        self._conversation = conversation
        self._toggles = toggles
        self._lock = threading.Lock()
        self._held: deque[FeedItem] = deque()
        conversation.on_idle(self.flush)

    @property
    def held(self) -> int:
        """How many items wait for the conversation to end."""
        with self._lock:
            return len(self._held)

    def announce(self, items: list[FeedItem]) -> None:
        """Speak items now, or hold them during a conversation."""
        if self._toggles.muted:
            logger.info("Alerts muted; skipping {} feed item(s)", len(items))
            return
        with self._lock:
            self._held.extend(items)
        if not self._conversation.active:
            self.flush()

    def flush(self) -> None:
        """Speak every held item."""
        with self._lock:
            items, self._held = list(self._held), deque()
        if self._toggles.muted:
            return
        for item in items:
            logger.info("Feed item {} ({})", item.id, item.kind)
            self._speaker.say(announcement(item))


class FeedLoop:
    """Polls on an interval until stopped, skipping polls while paused."""

    def __init__(
        self,
        poller: FeedPoller,
        on_items: Callable[[list[FeedItem]], None],
        toggles: Toggles,
        interval_s: float,
    ) -> None:
        self._poller = poller
        self._on_items = on_items
        self._toggles = toggles
        self._interval_s = interval_s
        self._stopped = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        """Start polling on a background thread."""
        self._thread = threading.Thread(target=self._run, name="vorath-feed", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """Stop polling and wait for the thread."""
        self._stopped.set()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def tick(self) -> float:
        """Poll once if not paused; return seconds until the next poll."""
        if self._toggles.paused:
            return self._interval_s
        try:
            items = self._poller.poll_once()
        except RateLimitedError as exc:
            logger.warning("Feed rate limited; waiting {}s", exc.retry_after)
            return exc.retry_after
        except (VorathHttpError, AeonUnreachableError) as exc:
            logger.warning("Feed poll failed: {}", exc)
            return max(self._interval_s, 30.0)
        if items:
            self._on_items(items)
        return self._interval_s

    def _run(self) -> None:
        delay = 0.0
        while not self._stopped.wait(delay):
            delay = self.tick()
