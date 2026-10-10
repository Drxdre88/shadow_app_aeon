"""Key-file loading (never logged) and config defaults."""

import pytest

from vorath_desk.config import DEFAULT_BASE_URL, ConfigLoader, DeskConfig, DeskPaths
from vorath_desk.errors import ConfigError, InvalidKeyError, MissingKeyError
from vorath_desk.keys import KeyStore, Secret

KEY = "aeon_k1_supersecretvalue123"


def test_reads_key_file_stripping_whitespace_and_bom(tmp_path) -> None:
    (tmp_path / "aeon.key").write_text("\ufeff" + KEY + "\r\n", encoding="utf-8")
    assert KeyStore(tmp_path).aeon().reveal() == KEY


def test_missing_and_empty_keys(tmp_path) -> None:
    store = KeyStore(tmp_path)
    assert store.read("deepgram") is None
    (tmp_path / "elevenlabs.key").write_text("  \n", encoding="utf-8")
    assert store.read("elevenlabs") is None
    with pytest.raises(MissingKeyError, match="aeon.key"):
        store.aeon()


def test_wrong_shape_key_is_rejected_without_echoing_it(tmp_path) -> None:
    (tmp_path / "aeon.key").write_text("sk-notanaeonkey", encoding="utf-8")
    with pytest.raises(InvalidKeyError) as caught:
        KeyStore(tmp_path).aeon()
    assert "sk-notanaeonkey" not in str(caught.value)


def test_secret_never_appears_in_repr_str_or_logs(tmp_path, log_lines) -> None:
    from loguru import logger

    (tmp_path / "aeon.key").write_text(KEY, encoding="utf-8")
    secret = KeyStore(tmp_path).aeon()
    logger.info("loaded {} / {!r} / {}", secret, secret, [secret])
    assert KEY not in repr(secret) and KEY not in str(secret) and KEY not in f"{secret}"
    assert log_lines and all(KEY not in line for line in log_lines)


def test_client_and_providers_do_not_log_keys(tmp_path, log_lines) -> None:
    from vorath_desk.factory import DeskFactory

    for name, value in (("aeon", KEY), ("deepgram", "dg_secret_1"), ("elevenlabs", "el_secret_2")):
        (tmp_path / f"{name}.key").write_text(value, encoding="utf-8")
    factory = DeskFactory(DeskConfig(), DeskPaths(tmp_path), KeyStore(tmp_path))
    factory.client()
    factory.stt()
    factory.tts()
    factory.close()
    joined = "\n".join(log_lines)
    assert "Deepgram" in joined
    for value in (KEY, "dg_secret_1", "el_secret_2"):
        assert value not in joined


def test_defaults_when_config_missing(tmp_path) -> None:
    config = ConfigLoader().load(tmp_path / "config.toml")
    assert config == DeskConfig()
    assert config.base_url == DEFAULT_BASE_URL == "https://aeon.shadow-lab.ai"
    assert config.hotkey == "ctrl+alt+v"
    assert config.feed_interval_s == 5.0
    assert config.stt.provider == "auto" and config.stt.whisper_model == "base.en"
    assert config.tts.provider == "auto" and config.tts.elevenlabs_model == "eleven_flash_v2_5"


def test_partial_config_overrides_and_keeps_defaults(tmp_path, log_lines) -> None:
    path = tmp_path / "config.toml"
    path.write_text(
        'hotkey = "ctrl+shift+space"\nfeed_interval_s = 10\nbase_url = "https://x.test/"\nmystery = 1\n'
        '[tts]\nprovider = "sapi"\nelevenlabs_voice_id = "abc"\n',
        encoding="utf-8",
    )
    config = ConfigLoader().load(path)
    assert config.hotkey == "ctrl+shift+space"
    assert config.feed_interval_s == 10.0
    assert config.base_url == "https://x.test"
    assert config.tts.provider == "sapi" and config.tts.elevenlabs_voice_id == "abc"
    assert config.stt.provider == "auto"
    assert any("mystery" in line for line in log_lines)


@pytest.mark.parametrize(
    "text",
    ['feed_interval_s = "fast"', '[stt]\nprovider = "siri"', "feed_interval_s = 0", "this is not toml", "stt = 3"],
)
def test_bad_config_raises_config_error(tmp_path, text) -> None:
    path = tmp_path / "config.toml"
    path.write_text(text, encoding="utf-8")
    with pytest.raises(ConfigError):
        ConfigLoader().load(path)


def test_secret_type_is_opaque() -> None:
    assert repr(Secret("x")) == "Secret(***)"
