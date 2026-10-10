"""Push-to-talk flow with fake hotkey, mic, STT and TTS; plus hotkey parsing."""

import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from fakes import FakeClient, FakeRecorder, FakeSTT, FakeTTS

from vorath_desk.app import MSG_UNHEARD, DeskApp, DeskParts
from vorath_desk.errors import ConfigError, TranscriptionError
from vorath_desk.feed import FeedAnnouncer, FeedLoop, FeedPoller, FeedStateStore
from vorath_desk.hotkey import ComboTracker, parse_hotkey, pynput_key_name
from vorath_desk.models import DeltaEvent, DoneEvent, FeedItem
from vorath_desk.runtime import IDLE, LISTENING, SPEAKING, THINKING, Conversation, Speaker, StatusBoard, Toggles
from vorath_desk.turn import TurnRunner


class FakeHotkey:
    def __init__(self) -> None:
        self.callbacks = None

    def start(self, on_press, on_release) -> None:
        self.callbacks = (on_press, on_release)

    def stop(self) -> None:
        self.callbacks = None


class FakeTray:
    def __init__(self) -> None:
        self.statuses: list[str] = []

    def run(self, on_ready) -> None:
        on_ready()

    def show_status(self, status: str) -> None:
        self.statuses.append(status)

    def stop(self) -> None:
        pass


class FailingSTT:
    def transcribe(self, clip):
        raise TranscriptionError("bad audio")


def build(tmp_path, stt=None, recorder=None, events=None):
    tts, toggles, conversation = FakeTTS(), Toggles(), Conversation()
    status = StatusBoard(toggles)
    speaker = Speaker(tts, on_speaking=lambda on: status.set(SPEAKING, on))
    client = FakeClient(events or [DeltaEvent("Hello back."), DoneEvent("Hello back.")])
    announcer = FeedAnnouncer(speaker, conversation, toggles)
    tray, hotkey = FakeTray(), FakeHotkey()
    turn_pool = ThreadPoolExecutor(1)
    parts = DeskParts(
        hotkey=hotkey,
        recorder=recorder or FakeRecorder(1.0),
        stt=stt or FakeSTT("hi Vorath"),
        speaker=speaker,
        runner=TurnRunner(client, speaker),
        feed_loop=FeedLoop(FeedPoller(client, FeedStateStore(tmp_path / "s.json")), announcer.announce, toggles, 60),
        conversation=conversation,
        status=status,
        toggles=toggles,
        input_executor=ThreadPoolExecutor(1),
        turn_executor=turn_pool,
        base_url="https://aeon.test",
    )
    app = DeskApp(parts, lambda _app: tray)
    app.run()
    return SimpleNamespace(app=app, parts=parts, tts=tts, client=client, tray=tray, hotkey=hotkey,
                           announcer=announcer, pools=(parts.input_executor, turn_pool))


def settle(env) -> None:
    for pool in env.pools:
        pool.submit(lambda: None).result(5)
    assert env.parts.speaker.wait_idle(5)


def test_hold_and_release_sends_transcript_and_speaks_reply(tmp_path) -> None:
    env = build(tmp_path)
    on_press, on_release = env.hotkey.callbacks
    on_press()
    on_release()
    settle(env)
    assert env.client.turns == ["hi Vorath"]
    assert env.tts.spoken == ["Hello back."]
    assert LISTENING in env.tray.statuses and THINKING in env.tray.statuses
    assert env.tray.statuses[-1] == IDLE
    assert not env.parts.conversation.active
    env.app.quit()


def test_press_barges_in_on_current_speech(tmp_path) -> None:
    env = build(tmp_path)
    env.tts.gate = threading.Event()
    env.parts.speaker.say("A long alert that is playing.")
    assert env.tts.started.wait(5)
    env.app.pressed()
    settle(env)
    assert env.tts.stops >= 1
    env.app.released()
    settle(env)
    env.app.quit()


def test_short_tap_is_ignored(tmp_path) -> None:
    env = build(tmp_path, recorder=FakeRecorder(0.05))
    env.app.pressed()
    env.app.released()
    settle(env)
    assert env.client.turns == [] and not env.parts.conversation.active
    env.app.quit()


def test_transcription_failure_is_spoken(tmp_path) -> None:
    env = build(tmp_path, stt=FailingSTT())
    env.app.pressed()
    env.app.released()
    settle(env)
    assert env.tts.spoken == [MSG_UNHEARD] and env.client.turns == []
    env.app.quit()


def test_feed_items_wait_for_the_turn_then_play(tmp_path) -> None:
    env = build(tmp_path)
    env.app.pressed()
    settle(env)
    env.announcer.announce([FeedItem("morghul:9", "morghul", "Deploy finished.")])
    assert env.tts.spoken == []
    env.app.released()
    settle(env)
    assert env.tts.spoken == ["Hello back.", "Morghul says: Deploy finished."]
    env.app.quit()


def test_paused_ignores_hotkey(tmp_path) -> None:
    env = build(tmp_path)
    env.parts.toggles.paused = True
    env.app.toggled()
    env.app.pressed()
    env.app.released()
    settle(env)
    assert env.parts.recorder.started == 0
    assert env.tray.statuses[-1] == "paused"
    env.app.quit()


def test_combo_tracker_fires_once_per_hold() -> None:
    events: list[str] = []
    tracker = ComboTracker(parse_hotkey("Ctrl+Alt+V"), lambda: events.append("down"), lambda: events.append("up"))
    for name in ("ctrl", "alt", "v", "v", "v"):
        tracker.key_down(name)
    tracker.key_up("v")
    tracker.key_up("alt")
    tracker.key_up("ctrl")
    tracker.key_down(None)
    assert events == ["down", "up"]


@pytest.mark.parametrize("text", ["", "ctrl+alt", "ctrl++v"])
def test_bad_hotkeys_raise(text) -> None:
    with pytest.raises(ConfigError):
        parse_hotkey(text)


def test_pynput_key_names_normalise_sides_and_control_chars() -> None:
    assert pynput_key_name(SimpleNamespace(name="ctrl_l")) == "ctrl"
    assert pynput_key_name(SimpleNamespace(name="alt_gr")) == "alt"
    assert pynput_key_name(SimpleNamespace(name="page_up")) == "page_up"
    assert pynput_key_name(SimpleNamespace(vk=0x56, char="\x16")) == "v"
    assert pynput_key_name(SimpleNamespace(vk=None, char="\x16")) is None
