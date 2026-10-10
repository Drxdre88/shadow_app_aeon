"""Desk settings: file locations and the TOML config with defaults."""

import tomllib
from dataclasses import dataclass, field, fields, replace
from pathlib import Path
from typing import Any

from loguru import logger

from vorath_desk.errors import ConfigError

DEFAULT_BASE_URL = "https://aeon.shadow-lab.ai"


@dataclass(frozen=True)
class DeskPaths:
    """Where the desk app keeps its config, keys, state and log."""

    root: Path

    @classmethod
    def default(cls) -> "DeskPaths":
        """Paths under ~/.vorath-desk."""
        return cls(Path.home() / ".vorath-desk")

    @property
    def config(self) -> Path:
        """The TOML config file."""
        return self.root / "config.toml"

    @property
    def state(self) -> Path:
        """The feed cursor state file."""
        return self.root / "state.json"

    @property
    def log(self) -> Path:
        """The rolling log file."""
        return self.root / "desk.log"


@dataclass(frozen=True)
class SttConfig:
    """Speech-to-text choice: auto, deepgram or whisper."""

    provider: str = "auto"
    deepgram_model: str = "nova-3"
    whisper_model: str = "base.en"
    language: str = "en"


@dataclass(frozen=True)
class TtsConfig:
    """Text-to-speech choice: auto, elevenlabs or sapi."""

    provider: str = "auto"
    elevenlabs_voice_id: str = ""
    elevenlabs_model: str = "eleven_flash_v2_5"
    sapi_rate: int = 185
    sapi_voice: str = ""


@dataclass(frozen=True)
class DeskConfig:
    """Everything the owner can change in config.toml."""

    base_url: str = DEFAULT_BASE_URL
    hotkey: str = "ctrl+alt+v"
    feed_interval_s: float = 5.0
    thread_key: str = ""
    sample_rate: int = 16000
    min_clip_s: float = 0.3
    stt: SttConfig = field(default_factory=SttConfig)
    tts: TtsConfig = field(default_factory=TtsConfig)


_PROVIDERS = {"stt": {"auto", "deepgram", "whisper"}, "tts": {"auto", "elevenlabs", "sapi"}}


class ConfigLoader:
    """Reads config.toml, falling back to defaults for anything missing."""

    def load(self, path: Path) -> DeskConfig:
        """Load the config at path, or defaults when the file is absent."""
        if not path.exists():
            logger.info("No config at {}, using defaults", path)
            return DeskConfig()
        try:
            raw = tomllib.loads(path.read_text(encoding="utf-8"))
        except (OSError, tomllib.TOMLDecodeError) as exc:
            raise ConfigError(f"Cannot read {path}: {exc}") from exc
        return self.parse(raw)

    def parse(self, raw: dict[str, Any]) -> DeskConfig:
        """Build a config from parsed TOML."""
        stt = self._section(SttConfig(), raw.pop("stt", {}), "stt")
        tts = self._section(TtsConfig(), raw.pop("tts", {}), "tts")
        config = self._section(DeskConfig(), raw, "root")
        config = replace(config, stt=stt, tts=tts, base_url=config.base_url.rstrip("/"))
        if config.feed_interval_s < 1:
            raise ConfigError("feed_interval_s must be at least 1")
        return config

    def _section[T](self, base: T, values: Any, name: str) -> T:
        if not isinstance(values, dict):
            raise ConfigError(f"[{name}] must be a table")
        known = {f.name: f for f in fields(base)}
        updates: dict[str, Any] = {}
        for key, value in values.items():
            if key not in known or key in {"stt", "tts"}:
                logger.warning("Ignoring unknown config key {}.{}", name, key)
                continue
            updates[key] = self._coerce(name, key, getattr(base, key), value)
        return replace(base, **updates)

    def _coerce(self, section: str, key: str, default: Any, value: Any) -> Any:
        if isinstance(default, float) and isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        if type(value) is not type(default):
            raise ConfigError(f"{section}.{key} must be {type(default).__name__}")
        if key == "provider" and value not in _PROVIDERS[section]:
            raise ConfigError(f"{section}.provider must be one of {sorted(_PROVIDERS[section])}")
        return value
