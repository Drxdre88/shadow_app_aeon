"""Global push-to-talk hotkey: combo tracking plus a pynput adapter."""

from collections.abc import Callable
from typing import Any

from loguru import logger

from vorath_desk.errors import ConfigError

MODIFIERS = {"ctrl", "alt", "shift", "cmd"}
_ALIASES = {"control": "ctrl", "win": "cmd", "windows": "cmd", "super": "cmd", "option": "alt"}


def parse_hotkey(text: str) -> frozenset[str]:
    """Parse 'ctrl+alt+v' into a set of normalised key names."""
    parts = [_ALIASES.get(p.strip().lower(), p.strip().lower()) for p in text.split("+")]
    if not parts or any(not p for p in parts):
        raise ConfigError(f"Bad hotkey {text!r}")
    if all(p in MODIFIERS for p in parts):
        raise ConfigError(f"Hotkey {text!r} needs a non-modifier key")
    return frozenset(parts)


def pynput_key_name(key: Any) -> str | None:
    """Normalise a pynput Key or KeyCode to the names parse_hotkey uses."""
    name = getattr(key, "name", None)
    if isinstance(name, str):
        head = name.split("_")[0]
        return head if head in MODIFIERS else name
    vk = getattr(key, "vk", None)
    if isinstance(vk, int) and (0x30 <= vk <= 0x39 or 0x41 <= vk <= 0x5A):
        return chr(vk).lower()
    char = getattr(key, "char", None)
    return char.lower() if isinstance(char, str) and char.isprintable() else None


class ComboTracker:
    """Turns raw key downs and ups into one press and one release per hold."""

    def __init__(self, combo: frozenset[str], on_press: Callable[[], None], on_release: Callable[[], None]) -> None:
        self._combo = combo
        self._on_press = on_press
        self._on_release = on_release
        self._down: set[str] = set()
        self._held = False

    def key_down(self, name: str | None) -> None:
        """Record a key going down; fire press when the combo completes."""
        if name is None:
            return
        self._down.add(name)
        if not self._held and self._combo <= self._down:
            self._held = True
            self._on_press()

    def key_up(self, name: str | None) -> None:
        """Record a key going up; fire release when the combo breaks."""
        if name is None:
            return
        self._down.discard(name)
        if self._held and name in self._combo:
            self._held = False
            self._on_release()


class PynputHotkey:
    """Listens for a key combination system-wide using pynput (no admin needed)."""

    def __init__(self, combo_text: str) -> None:
        self._combo = parse_hotkey(combo_text)
        self._listener: Any = None

    def start(self, on_press: Callable[[], None], on_release: Callable[[], None]) -> None:
        """Start the keyboard hook."""
        from pynput import keyboard

        tracker = ComboTracker(self._combo, on_press, on_release)
        self._listener = keyboard.Listener(
            on_press=lambda key: tracker.key_down(pynput_key_name(key)),
            on_release=lambda key: tracker.key_up(pynput_key_name(key)),
        )
        self._listener.start()
        logger.info("Push-to-talk on {}", "+".join(sorted(self._combo)))

    def stop(self) -> None:
        """Remove the keyboard hook."""
        if self._listener is not None:
            self._listener.stop()
            self._listener = None
