"""The tray app: wires hotkey, mic, STT, turns, feed and tray together."""

import webbrowser
from collections.abc import Callable
from concurrent.futures import Executor
from dataclasses import dataclass

from loguru import logger

from vorath_desk.errors import AudioDeviceError, TranscriptionError
from vorath_desk.feed import FeedLoop
from vorath_desk.models import AudioClip
from vorath_desk.protocols import STT, Hotkey, Recorder, Tray
from vorath_desk.runtime import LISTENING, THINKING, Conversation, Speaker, StatusBoard, Toggles
from vorath_desk.turn import TurnRunner

MSG_MIC = "I can't open the microphone."
MSG_UNHEARD = "Sorry, I didn't catch that."


@dataclass(frozen=True)
class DeskParts:
    """Every collaborator the desk app needs."""

    hotkey: Hotkey
    recorder: Recorder
    stt: STT
    speaker: Speaker
    runner: TurnRunner
    feed_loop: FeedLoop
    conversation: Conversation
    status: StatusBoard
    toggles: Toggles
    input_executor: Executor
    turn_executor: Executor
    base_url: str
    min_clip_s: float = 0.3


class DeskApp:
    """Push-to-talk loop plus feed alerts, driven from the tray."""

    def __init__(self, parts: DeskParts, tray_factory: Callable[["DeskApp"], Tray]) -> None:
        self._p = parts
        self._recording = False
        self._tray = tray_factory(self)

    def run(self) -> None:
        """Start the speaker and block on the tray until Quit."""
        self._p.speaker.start()
        self._p.status.subscribe(self._tray.show_status)
        self._tray.run(on_ready=self._start_background)

    def pressed(self) -> None:
        """Hotkey went down: barge in and start recording."""
        if not self._p.toggles.paused:
            self._p.input_executor.submit(self._begin_recording)

    def released(self) -> None:
        """Hotkey went up: stop recording and send the turn."""
        self._p.input_executor.submit(self._finish_recording)

    def toggled(self) -> None:
        """A tray toggle changed."""
        if self._p.toggles.paused:
            self._p.speaker.stop()
        self._p.status.refresh()

    def open_aeon(self) -> None:
        """Open Aeon in the browser."""
        webbrowser.open(self._p.base_url)

    def quit(self) -> None:
        """Shut everything down and leave the tray loop."""
        logger.info("Quitting Vorath Desk")
        self._p.hotkey.stop()
        self._p.feed_loop.stop()
        self._p.speaker.close()
        self._p.input_executor.shutdown(wait=False, cancel_futures=True)
        self._p.turn_executor.shutdown(wait=False, cancel_futures=True)
        self._tray.stop()

    def _start_background(self) -> None:
        self._p.hotkey.start(self.pressed, self.released)
        self._p.feed_loop.start()
        logger.info("Vorath Desk ready")

    def _begin_recording(self) -> None:
        if self._recording:
            return
        self._p.speaker.stop()
        self._p.conversation.begin()
        try:
            self._p.recorder.start()
        except AudioDeviceError as exc:
            logger.error("{}", exc)
            self._p.speaker.say(MSG_MIC)
            self._p.conversation.end()
            return
        self._recording = True
        self._p.status.set(LISTENING, True)

    def _finish_recording(self) -> None:
        if not self._recording:
            return
        self._recording = False
        clip = self._p.recorder.stop()
        self._p.status.set(LISTENING, False)
        if clip.seconds < self._p.min_clip_s:
            logger.info("Clip too short ({:.2f}s); ignored", clip.seconds)
            self._p.conversation.end()
            return
        self._p.status.set(THINKING, True)
        self._p.turn_executor.submit(self.handle_clip, clip)

    def handle_clip(self, clip: AudioClip) -> None:
        """Transcribe a clip and run it as a turn."""
        try:
            text = self._transcribe(clip)
            if text:
                logger.info("Heard {} chars; sending turn", len(text))
                outcome = self._p.runner.run(text)
                logger.info("Turn ok={} error={}", outcome.ok, outcome.error or "-")
        finally:
            self._p.status.set(THINKING, False)
            self._p.conversation.end()

    def _transcribe(self, clip: AudioClip) -> str:
        try:
            text = self._p.stt.transcribe(clip)
        except TranscriptionError as exc:
            logger.warning("{}", exc)
            self._p.speaker.say(MSG_UNHEARD)
            return ""
        if not text:
            logger.info("Empty transcript")
        return text
