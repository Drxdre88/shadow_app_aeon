"""Specific exceptions raised by the desk app."""


class DeskError(Exception):
    """Base for every desk app error."""


class ConfigError(DeskError):
    """The config file is unreadable or holds a bad value."""


class MissingKeyError(DeskError):
    """A required key file is absent or empty."""


class InvalidKeyError(DeskError):
    """A key file holds something that is not a valid key."""


class VorathHttpError(DeskError):
    """Aeon answered with an unexpected status."""

    def __init__(self, status: int, code: str | None = None, message: str = "") -> None:
        super().__init__(f"Aeon returned {status}{f' ({code})' if code else ''}: {message}".rstrip(": "))
        self.status = status
        self.code = code


class TurnInProgressError(VorathHttpError):
    """409 turn_in_progress: the previous turn is still unanswered."""


class NoPaidKeyError(VorathHttpError):
    """409 no_paid_key: Aeon has no usable paid AI key."""


class RateLimitedError(VorathHttpError):
    """429: wait Retry-After seconds before trying again."""

    def __init__(self, retry_after: float, message: str = "") -> None:
        super().__init__(429, None, message)
        self.retry_after = retry_after


class AeonUnreachableError(DeskError):
    """The network request to Aeon failed."""


class SpeechError(DeskError):
    """Text-to-speech failed for one sentence."""


class TranscriptionError(DeskError):
    """Speech-to-text failed for one clip."""


class AudioDeviceError(DeskError):
    """The microphone or speaker could not be opened."""
