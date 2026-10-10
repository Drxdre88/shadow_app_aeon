"""Key files: read secrets from disk and keep them out of logs."""

from pathlib import Path

from vorath_desk.errors import InvalidKeyError, MissingKeyError

AEON_KEY_PREFIX = "aeon_k1_"


class Secret:
    """A key value whose repr and str never reveal it."""

    __slots__ = ("_value",)

    def __init__(self, value: str) -> None:
        self._value = value

    def reveal(self) -> str:
        """Return the raw value for use in a request header."""
        return self._value

    def __repr__(self) -> str:
        return "Secret(***)"

    __str__ = __repr__


class KeyStore:
    """Loads named keys from files in one directory."""

    def __init__(self, directory: Path) -> None:
        self._directory = directory

    def path(self, name: str) -> Path:
        """The file a named key lives in."""
        return self._directory / f"{name}.key"

    def read(self, name: str) -> Secret | None:
        """Return the key, or None when the file is absent or empty."""
        path = self.path(name)
        try:
            value = path.read_text(encoding="utf-8-sig").strip()
        except FileNotFoundError:
            return None
        except OSError as exc:
            raise MissingKeyError(f"Cannot read key file {path}: {exc.strerror}") from None
        return Secret(value) if value else None

    def require(self, name: str) -> Secret:
        """Return the key or raise naming the missing file."""
        secret = self.read(name)
        if secret is None:
            raise MissingKeyError(f"Key file {self.path(name)} is missing or empty")
        return secret

    def aeon(self) -> Secret:
        """Return the owner's Aeon API key, checking its shape."""
        secret = self.require("aeon")
        value = secret.reveal()
        if not value.startswith(AEON_KEY_PREFIX) or any(ch.isspace() for ch in value):
            raise InvalidKeyError(f"{self.path('aeon')} does not hold an {AEON_KEY_PREFIX}… key")
        return secret
