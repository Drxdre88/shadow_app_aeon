"""Split streamed reply text into speakable pieces."""

import re

_BOUNDARY = re.compile(r"(?<=[.!?…])\s+|(?<=[.!?…][\"')\]])\s+")
_COMPLETE = re.compile(r"[.!?…][\"')\]]*$")
# The server sends a clause on its own once it has run on for a few words; it
# ends in a comma, semicolon or dash and is spoken as soon as it arrives.
_CLAUSE_END = re.compile(r"[,;—–]$")


def split_sentences(text: str) -> list[str]:
    """Split text into trimmed, non-empty sentences."""
    return [part.strip() for part in _BOUNDARY.split(text.strip()) if part.strip()]


class SentenceChunker:
    """Buffers streamed text and releases only complete sentences or clauses."""

    def __init__(self) -> None:
        self._buffer = ""

    def feed(self, text: str) -> list[str]:
        """Add text and return the sentences or clauses now complete."""
        self._buffer = f"{self._buffer} {text}".strip() if self._buffer else text.strip()
        if not self._buffer:
            return []
        if _COMPLETE.search(self._buffer) or _CLAUSE_END.search(self._buffer):
            sentences, self._buffer = split_sentences(self._buffer), ""
            return sentences
        parts = split_sentences(self._buffer)
        self._buffer = parts.pop() if parts else ""
        return parts

    def flush(self) -> list[str]:
        """Return whatever is left, complete or not."""
        rest, self._buffer = self._buffer, ""
        return split_sentences(rest)
