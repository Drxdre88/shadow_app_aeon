"""SSE parsing and sentence chunking."""

from vorath_desk.chunking import SentenceChunker, split_sentences
from vorath_desk.sse import SseEvent, SseParser


def test_parses_named_events_from_contract_example() -> None:
    lines = [
        "event: delta",
        'data: {"text":"The Swarm build is waiting."}',
        "",
        "event: done",
        'data: {"text":"The Swarm build is waiting.","streamed":true}',
        "",
    ]
    events = list(SseParser().parse(lines))
    assert events == [
        SseEvent("delta", '{"text":"The Swarm build is waiting."}'),
        SseEvent("done", '{"text":"The Swarm build is waiting.","streamed":true}'),
    ]


def test_handles_crlf_comments_multiline_data_and_missing_trailing_blank() -> None:
    lines = [": keepalive\r\n", "event: delta\r\n", "data: a\r\n", "data:b\r\n", "\r\n", "data: tail"]
    events = list(SseParser().parse(lines))
    assert events == [SseEvent("delta", "a\nb"), SseEvent("message", "tail")]


def test_blank_lines_alone_dispatch_nothing() -> None:
    assert list(SseParser().parse(["", "", ": ping", ""])) == []


def test_split_sentences_keeps_closing_quotes() -> None:
    assert split_sentences('He said "go." Then left! Why?') == ['He said "go."', "Then left!", "Why?"]


def test_chunker_releases_complete_sentences_and_holds_partial() -> None:
    chunker = SentenceChunker()
    assert chunker.feed("First one. Second") == ["First one."]
    assert chunker.feed("part done.") == ["Second part done."]
    assert chunker.feed("No end yet") == []
    assert chunker.flush() == ["No end yet"]
    assert chunker.flush() == []


def test_chunker_splits_a_multi_sentence_delta() -> None:
    assert SentenceChunker().feed("One. Two? Three!") == ["One.", "Two?", "Three!"]


def test_chunker_does_not_treat_closing_paren_alone_as_end() -> None:
    chunker = SentenceChunker()
    assert chunker.feed("See the board (Swarm)") == []
    assert chunker.flush() == ["See the board (Swarm)"]
