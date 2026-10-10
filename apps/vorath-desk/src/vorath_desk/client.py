"""HTTP client for the Aeon voice routes."""

import json
from collections.abc import Iterator
from typing import Any

import httpx
from loguru import logger

from vorath_desk.errors import (
    AeonUnreachableError,
    NoPaidKeyError,
    RateLimitedError,
    TurnInProgressError,
    VorathHttpError,
)
from vorath_desk.keys import Secret
from vorath_desk.models import DeltaEvent, DoneEvent, ErrorEvent, FeedItem, FeedPage, TurnEvent
from vorath_desk.sse import SseEvent, SseParser

TURN_PATH = "/api/v1/kairos/voice/turn"
FEED_PATH = "/api/v1/kairos/voice/feed"


class HttpVorathClient:
    """Calls the voice turn and feed routes with the owner's API key."""

    def __init__(self, http: httpx.Client, base_url: str, api_key: Secret, thread_key: str = "") -> None:
        self._http = http
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._thread_key = thread_key

    def stream_turn(self, text: str) -> Iterator[TurnEvent]:
        """Send one turn and yield delta, done or error events."""
        body: dict[str, Any] = {"text": text[:4000]}
        if self._thread_key:
            body["threadKey"] = self._thread_key
        headers = {**self._auth(), "Accept": "text/event-stream"}
        try:
            with self._http.stream("POST", self._base_url + TURN_PATH, json=body, headers=headers) as response:
                if response.status_code != 200:
                    response.read()
                    raise self._status_error(response)
                yield from self._turn_events(response.iter_lines())
        except httpx.TransportError as exc:
            raise AeonUnreachableError(f"Turn request failed: {type(exc).__name__}") from None

    def fetch_feed(self, since: str | None) -> FeedPage:
        """Fetch feed items newer than since."""
        params = {"since": since} if since else {}
        try:
            response = self._http.get(self._base_url + FEED_PATH, params=params, headers=self._auth())
        except httpx.TransportError as exc:
            raise AeonUnreachableError(f"Feed request failed: {type(exc).__name__}") from None
        if response.status_code != 200:
            raise self._status_error(response)
        return self._feed_page(response.json())

    def _auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key.reveal()}"}

    def _turn_events(self, lines: Iterator[str]) -> Iterator[TurnEvent]:
        for raw in SseParser().parse(lines):
            event = self._to_turn_event(raw)
            if event is None:
                continue
            yield event
            if not isinstance(event, DeltaEvent):
                return

    def _to_turn_event(self, raw: SseEvent) -> TurnEvent | None:
        try:
            data = json.loads(raw.data) if raw.data else {}
        except json.JSONDecodeError:
            logger.warning("Skipping malformed {} event", raw.event)
            return None
        if not isinstance(data, dict):
            return None
        if raw.event == "delta":
            return DeltaEvent(str(data.get("text", "")))
        if raw.event == "done":
            return DoneEvent(
                text=str(data.get("text", "")),
                streamed=bool(data.get("streamed", True)),
                replaced=bool(data.get("replaced", False)),
            )
        if raw.event == "error":
            return ErrorEvent(str(data.get("reason", "unknown")), str(data.get("message", "")))
        return None

    def _status_error(self, response: httpx.Response) -> VorathHttpError:
        try:
            body = response.json()
        except (json.JSONDecodeError, UnicodeDecodeError):
            body = {}
        body = body if isinstance(body, dict) else {}
        code = body.get("code")
        message = str(body.get("error", ""))
        status = response.status_code
        if status == 409 and code == "turn_in_progress":
            return TurnInProgressError(status, code, message)
        if status == 409 and code == "no_paid_key":
            return NoPaidKeyError(status, code, message)
        if status == 429:
            return RateLimitedError(self._retry_after(response), message)
        return VorathHttpError(status, code, message)

    def _retry_after(self, response: httpx.Response) -> float:
        try:
            return max(1.0, float(response.headers.get("Retry-After", "30")))
        except ValueError:
            return 30.0

    def _feed_page(self, body: Any) -> FeedPage:
        body = body if isinstance(body, dict) else {}
        items = tuple(
            FeedItem(
                id=str(raw["id"]),
                kind=str(raw.get("kind", "")),
                text=str(raw.get("text", "")),
                title=str(raw.get("title", "")),
                urgency=str(raw.get("urgency", "normal")),
                at=str(raw.get("at", "")),
            )
            for raw in body.get("items", [])
            if isinstance(raw, dict) and raw.get("id")
        )
        next_cursor = body.get("next")
        return FeedPage(items, str(next_cursor) if next_cursor else None)
