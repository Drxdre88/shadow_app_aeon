"""Text-mode commands that work without a microphone."""

from loguru import logger

from vorath_desk.feed import FeedAnnouncer, FeedPoller
from vorath_desk.runtime import Conversation, Speaker, Toggles
from vorath_desk.turn import TurnRunner


class TextCommands:
    """The `say` and `feed --once` commands."""

    def __init__(self, speaker: Speaker) -> None:
        self._speaker = speaker

    def say(self, runner: TurnRunner, text: str) -> int:
        """Send one turn, speak the reply, and return an exit code."""
        self._speaker.start()
        try:
            outcome = runner.run(text)
            self._speaker.wait_idle()
        finally:
            self._speaker.close()
        if outcome.ok:
            logger.info("Saved reply ({} chars){}", len(outcome.reply), ", replaced" if outcome.replaced else "")
            return 0
        logger.error("Turn failed: {}", outcome.error)
        return 1

    def feed_once(self, poller: FeedPoller) -> int:
        """Poll the feed once, speak new items, and return an exit code."""
        self._speaker.start()
        try:
            logger.info("Polling feed since {}", poller.cursor or "(server default: 15 minutes ago)")
            items = poller.poll_once()
            logger.info("{} new item(s); next cursor {}", len(items), poller.cursor or "-")
            FeedAnnouncer(self._speaker, Conversation(), Toggles()).announce(items)
            self._speaker.wait_idle()
        finally:
            self._speaker.close()
        return 0
