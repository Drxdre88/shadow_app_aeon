"""Feed polling: cursor persistence, dedupe, queueing during a turn, mute."""

from fakes import FakeClient, FakeTTS

from vorath_desk.errors import AeonUnreachableError, RateLimitedError
from vorath_desk.feed import FeedAnnouncer, FeedLoop, FeedPoller, FeedStateStore, announcement
from vorath_desk.models import FeedItem, FeedPage
from vorath_desk.runtime import Conversation, Speaker, Toggles

MORGHUL = FeedItem("morghul:1", "morghul", "Build waiting.")
QUESTION = FeedItem("question:2", "question", "Ship it today?")


def test_cursor_survives_restart_and_seen_ids_are_skipped(tmp_path) -> None:
    store = FeedStateStore(tmp_path / "state.json")
    client = FakeClient()
    client.pages = [FeedPage((MORGHUL,), "c1"), FeedPage((MORGHUL, QUESTION), "c2")]
    poller = FeedPoller(client, store)
    assert poller.poll_once() == [MORGHUL]
    assert poller.poll_once() == [QUESTION]
    restarted = FeedPoller(client, FeedStateStore(tmp_path / "state.json"))
    assert restarted.cursor == "c2"
    client.pages = [FeedPage((QUESTION,), None)]
    assert restarted.poll_once() == []
    assert client.since == [None, "c1", "c2"]
    assert restarted.cursor == "c2"


def test_corrupt_state_file_starts_fresh(tmp_path) -> None:
    path = tmp_path / "state.json"
    path.write_text("{nope", encoding="utf-8")
    assert FeedStateStore(path).load().next is None


def test_announcement_prefixes() -> None:
    assert announcement(MORGHUL) == "Morghul says: Build waiting."
    assert announcement(QUESTION) == "Vorath asks: Ship it today?"
    assert announcement(FeedItem("speak:3", "speak", "", title="Title only")) == "Vorath asks: Title only"


def speak_with(conversation: Conversation, toggles: Toggles) -> tuple[FeedAnnouncer, Speaker, FakeTTS]:
    tts = FakeTTS()
    speaker = Speaker(tts)
    speaker.start()
    return FeedAnnouncer(speaker, conversation, toggles), speaker, tts


def test_items_are_held_during_a_turn_and_spoken_after() -> None:
    conversation = Conversation()
    announcer, speaker, tts = speak_with(conversation, Toggles())
    conversation.begin()
    announcer.announce([MORGHUL, QUESTION])
    assert speaker.wait_idle(5)
    assert tts.spoken == [] and announcer.held == 2
    conversation.end()
    assert speaker.wait_idle(5)
    assert tts.spoken == ["Morghul says: Build waiting.", "Vorath asks: Ship it today?"]
    assert announcer.held == 0
    speaker.close()


def test_muted_alerts_are_not_spoken() -> None:
    announcer, speaker, tts = speak_with(Conversation(), Toggles(muted=True))
    announcer.announce([MORGHUL])
    assert speaker.wait_idle(5)
    assert tts.spoken == []
    speaker.close()


def test_loop_tick_backs_off_on_errors_and_skips_when_paused(tmp_path) -> None:
    received: list = []
    toggles = Toggles()
    client = FakeClient()
    client.pages = [FeedPage((MORGHUL,), "c1")]
    loop = FeedLoop(FeedPoller(client, FeedStateStore(tmp_path / "s.json")), received.extend, toggles, 5.0)
    assert loop.tick() == 5.0 and received == [MORGHUL]
    client.error = RateLimitedError(17)
    assert loop.tick() == 17
    client.error = AeonUnreachableError("down")
    assert loop.tick() == 30.0
    toggles.paused = True
    calls = len(client.since)
    assert loop.tick() == 5.0 and len(client.since) == calls


def test_loop_thread_starts_and_stops_promptly(tmp_path) -> None:
    loop = FeedLoop(FeedPoller(FakeClient(), FeedStateStore(tmp_path / "s.json")), list, Toggles(), 60.0)
    loop.start()
    loop.stop()
    assert loop._thread is not None and not loop._thread.is_alive()
