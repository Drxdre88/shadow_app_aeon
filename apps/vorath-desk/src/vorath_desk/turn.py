"""One spoken turn: send text, speak the reply sentence by sentence."""

from dataclasses import dataclass

from loguru import logger

from vorath_desk.chunking import SentenceChunker, split_sentences
from vorath_desk.errors import (
    AeonUnreachableError,
    NoPaidKeyError,
    RateLimitedError,
    TurnInProgressError,
    VorathHttpError,
)
from vorath_desk.models import DeltaEvent, DoneEvent, ErrorEvent
from vorath_desk.protocols import VorathClient
from vorath_desk.runtime import Speaker

MSG_IN_PROGRESS = "I'm still on your last message. Give me a moment."
MSG_NO_PAID_KEY = "There's no paid AI key in Aeon, so I can't answer. Add one in Aeon settings."
MSG_RATE_LIMITED = "That's too many requests. Try again in a minute."
MSG_AUTH = "Aeon didn't accept the desk key."
MSG_SERVER = "Aeon had a problem. Try again."
MSG_UNREACHABLE = "I can't reach Aeon right now."
MSG_FAILED = "Sorry, I couldn't answer that. Your words are saved."
MSG_CUT_OFF = "The reply was cut off."


@dataclass(frozen=True)
class TurnOutcome:
    """What happened in a turn: the saved reply or the failure reason."""

    ok: bool
    reply: str = ""
    error: str = ""
    replaced: bool = False


class TurnRunner:
    """Streams one turn from Vorath into the speaker."""

    def __init__(self, client: VorathClient, speaker: Speaker) -> None:
        self._client = client
        self._speaker = speaker

    def run(self, text: str) -> TurnOutcome:
        """Send text and speak the reply as it streams; never raises for server errors."""
        try:
            return self._stream(text)
        except TurnInProgressError:
            return self._fail("turn_in_progress", MSG_IN_PROGRESS)
        except NoPaidKeyError:
            return self._fail("no_paid_key", MSG_NO_PAID_KEY)
        except RateLimitedError:
            return self._fail("rate_limited", MSG_RATE_LIMITED)
        except VorathHttpError as exc:
            return self._fail(f"http_{exc.status}", MSG_AUTH if exc.status in (401, 404) else MSG_SERVER)
        except AeonUnreachableError as exc:
            logger.warning("{}", exc)
            return self._fail("unreachable", MSG_UNREACHABLE)

    def _stream(self, text: str) -> TurnOutcome:
        chunker = SentenceChunker()
        spoken = False
        for event in self._client.stream_turn(text):
            if isinstance(event, DeltaEvent):
                spoken = self._say_all(chunker.feed(event.text)) or spoken
            elif isinstance(event, DoneEvent):
                return self._finish(event, chunker, spoken)
            elif isinstance(event, ErrorEvent):
                logger.warning("Turn failed: {} {}", event.reason, event.message)
                self._speaker.stop()
                return self._fail(event.reason, MSG_FAILED)
        spoken = self._say_all(chunker.flush()) or spoken
        if not spoken:
            return self._fail("no_done", MSG_CUT_OFF)
        logger.warning("Turn stream ended without a done event")
        return TurnOutcome(ok=False, error="no_done")

    def _finish(self, done: DoneEvent, chunker: SentenceChunker, spoken: bool) -> TurnOutcome:
        if done.replaced:
            logger.info("Reply was replaced; re-speaking the saved text")
            chunker.flush()
            self._speaker.stop()
            self._say_all(split_sentences(done.text))
        else:
            spoken = self._say_all(chunker.flush()) or spoken
            if not spoken:
                self._say_all(split_sentences(done.text))
        return TurnOutcome(ok=True, reply=done.text, replaced=done.replaced)

    def _say_all(self, sentences: list[str]) -> bool:
        for sentence in sentences:
            self._speaker.say(sentence)
        return bool(sentences)

    def _fail(self, error: str, message: str) -> TurnOutcome:
        logger.info("Turn ended: {}", error)
        self._speaker.say(message)
        return TurnOutcome(ok=False, error=error)
