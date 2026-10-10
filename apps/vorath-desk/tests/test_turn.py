"""Turn flow: streaming speech, replaced re-speak, errors and 409s."""

import pytest
from fakes import FakeClient, FakeTTS

from vorath_desk.errors import (
    AeonUnreachableError,
    NoPaidKeyError,
    RateLimitedError,
    TurnInProgressError,
    VorathHttpError,
)
from vorath_desk.models import DeltaEvent, DoneEvent, ErrorEvent
from vorath_desk.runtime import Speaker
from vorath_desk.turn import MSG_FAILED, MSG_IN_PROGRESS, MSG_NO_PAID_KEY, TurnRunner


def run_turn(client: FakeClient, tts: FakeTTS | None = None) -> tuple:
    tts = tts or FakeTTS()
    speaker = Speaker(tts)
    speaker.start()
    outcome = TurnRunner(client, speaker).run("hello")
    assert speaker.wait_idle(5)
    speaker.close()
    return outcome, tts


def test_speaks_each_delta_sentence_in_order() -> None:
    client = FakeClient([
        DeltaEvent("The build is waiting. It needs approval."),
        DeltaEvent("Want me to open it?"),
        DoneEvent("The build is waiting. It needs approval. Want me to open it?"),
    ])
    outcome, tts = run_turn(client)
    assert tts.spoken == ["The build is waiting.", "It needs approval.", "Want me to open it?"]
    assert outcome.ok and outcome.reply.endswith("open it?")
    assert client.turns == ["hello"]


def test_speaks_done_text_when_nothing_streamed() -> None:
    outcome, tts = run_turn(FakeClient([DoneEvent("Looked it up. All green.", streamed=False)]))
    assert tts.spoken == ["Looked it up.", "All green."]
    assert outcome.ok


def test_done_text_is_not_repeated_after_deltas() -> None:
    _, tts = run_turn(FakeClient([DeltaEvent("Done."), DoneEvent("Done.")]))
    assert tts.spoken == ["Done."]


def test_replaced_reply_stops_and_respeaks_saved_text() -> None:
    client = FakeClient([DeltaEvent("Partial answer."), DoneEvent("Timed out. Ask again.", replaced=True)])
    outcome, tts = run_turn(client)
    assert outcome.replaced
    assert tts.stops >= 1
    assert tts.spoken[-2:] == ["Timed out.", "Ask again."]


def test_error_event_speaks_apology() -> None:
    outcome, tts = run_turn(FakeClient([DeltaEvent("Half"), ErrorEvent("ai_failed", "boom")]))
    assert not outcome.ok and outcome.error == "ai_failed"
    assert tts.spoken == [MSG_FAILED]


@pytest.mark.parametrize(
    ("error", "code", "message"),
    [
        (TurnInProgressError(409, "turn_in_progress"), "turn_in_progress", MSG_IN_PROGRESS),
        (NoPaidKeyError(409, "no_paid_key"), "no_paid_key", MSG_NO_PAID_KEY),
        (RateLimitedError(30), "rate_limited", None),
        (VorathHttpError(404), "http_404", None),
        (AeonUnreachableError("down"), "unreachable", None),
    ],
)
def test_pre_stream_errors_become_spoken_outcomes(error, code, message) -> None:
    outcome, tts = run_turn(FakeClient(error=error))
    assert not outcome.ok and outcome.error == code
    assert len(tts.spoken) == 1
    if message:
        assert tts.spoken == [message]


def test_stream_ending_without_done_speaks_leftover() -> None:
    outcome, tts = run_turn(FakeClient([DeltaEvent("Cut off mid")]))
    assert tts.spoken == ["Cut off mid"]
    assert outcome.error == "no_done"
