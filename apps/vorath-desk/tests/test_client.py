"""HTTP client against a mocked Aeon: SSE turn, 409s, 429 and feed."""

import json

import httpx
import pytest

from vorath_desk.client import HttpVorathClient
from vorath_desk.errors import (
    AeonUnreachableError,
    NoPaidKeyError,
    RateLimitedError,
    TurnInProgressError,
    VorathHttpError,
)
from vorath_desk.keys import Secret
from vorath_desk.models import DeltaEvent, DoneEvent, ErrorEvent

KEY = "aeon_k1_testsecretvalue"
SSE_BODY = (
    'event: delta\ndata: {"text":"Hi there."}\n\n'
    'event: done\ndata: {"text":"Hi there.","streamed":true,"replaced":false}\n\n'
    'event: delta\ndata: {"text":"ignored after done"}\n\n'
)


def make_client(handler, thread_key: str = "") -> HttpVorathClient:
    http = httpx.Client(transport=httpx.MockTransport(handler))
    return HttpVorathClient(http, "https://aeon.test/", Secret(KEY), thread_key)


def test_turn_posts_text_with_bearer_and_parses_events() -> None:
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["Authorization"]
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, text=SSE_BODY, headers={"Content-Type": "text/event-stream"})

    events = list(make_client(handler, thread_key="desk").stream_turn("hello"))
    assert events == [DeltaEvent("Hi there."), DoneEvent("Hi there.", streamed=True, replaced=False)]
    assert seen["auth"] == f"Bearer {KEY}"
    assert seen["url"] == "https://aeon.test/api/v1/kairos/voice/turn"
    assert seen["body"] == {"text": "hello", "threadKey": "desk"}


def test_turn_error_event_and_replaced_flag() -> None:
    body = (
        'event: done\ndata: {"text":"Saved.","streamed":false,"replaced":true}\n\n'
    )
    events = list(make_client(lambda r: httpx.Response(200, text=body)).stream_turn("x"))
    assert events == [DoneEvent("Saved.", streamed=False, replaced=True)]
    body = 'event: error\ndata: {"reason":"ai_failed","message":"nope","threadId":"t"}\n\n'
    assert list(make_client(lambda r: httpx.Response(200, text=body)).stream_turn("x")) == [
        ErrorEvent("ai_failed", "nope")
    ]


def test_malformed_event_is_skipped() -> None:
    body = 'event: delta\ndata: {not json\n\nevent: done\ndata: {"text":"ok"}\n\n'
    assert list(make_client(lambda r: httpx.Response(200, text=body)).stream_turn("x")) == [DoneEvent("ok")]


@pytest.mark.parametrize(
    ("code", "error_type"),
    [("turn_in_progress", TurnInProgressError), ("no_paid_key", NoPaidKeyError)],
)
def test_409_codes_map_to_specific_errors(code, error_type) -> None:
    client = make_client(lambda r: httpx.Response(409, json={"error": "busy", "code": code}))
    with pytest.raises(error_type) as caught:
        list(client.stream_turn("x"))
    assert caught.value.status == 409 and caught.value.code == code


def test_unknown_409_and_other_statuses_are_generic() -> None:
    client = make_client(lambda r: httpx.Response(409, json={"error": "?", "code": "other"}))
    with pytest.raises(VorathHttpError) as caught:
        list(client.stream_turn("x"))
    assert type(caught.value) is VorathHttpError
    with pytest.raises(VorathHttpError):
        list(make_client(lambda r: httpx.Response(500, text="oops")).stream_turn("x"))


def test_429_carries_retry_after() -> None:
    client = make_client(lambda r: httpx.Response(429, headers={"Retry-After": "12"}, json={"error": "slow"}))
    with pytest.raises(RateLimitedError) as caught:
        client.fetch_feed(None)
    assert caught.value.retry_after == 12.0


def test_transport_failure_hides_details() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    with pytest.raises(AeonUnreachableError):
        list(make_client(handler).stream_turn("x"))
    with pytest.raises(AeonUnreachableError):
        make_client(handler).fetch_feed(None)


def test_feed_sends_cursor_and_parses_items() -> None:
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["since"] = request.url.params.get("since")
        return httpx.Response(200, json={
            "items": [
                {"id": "morghul:1", "kind": "morghul", "text": "Build waiting.", "urgency": "high", "at": "t1"},
                {"kind": "question", "text": "no id, dropped"},
            ],
            "next": "2026-10-10T09:58:12.345Z",
        })

    page = make_client(handler).fetch_feed("2026-10-10T09:00:00.000Z")
    assert seen["since"] == "2026-10-10T09:00:00.000Z"
    assert [item.id for item in page.items] == ["morghul:1"]
    assert page.items[0].urgency == "high"
    assert page.next == "2026-10-10T09:58:12.345Z"
