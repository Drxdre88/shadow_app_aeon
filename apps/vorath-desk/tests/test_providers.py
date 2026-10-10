"""Provider adapters with mocked HTTP, audio and speech engines."""

import json
import threading

import httpx
import pytest

from vorath_desk.errors import SpeechError, TranscriptionError
from vorath_desk.keys import Secret
from vorath_desk.models import AudioClip
from vorath_desk.stt import DeepgramSTT, WhisperSTT
from vorath_desk.tts import ElevenLabsTTS, SapiTTS

CLIP = AudioClip(b"\x01\x00" * 1600, 16000)


def mock_http(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_deepgram_posts_wav_and_reads_transcript() -> None:
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["Authorization"]
        seen["type"] = request.headers["Content-Type"]
        seen["riff"] = request.content[:4]
        seen["model"] = request.url.params["model"]
        return httpx.Response(200, json={"results": {"channels": [{"alternatives": [{"transcript": " hi "}]}]}})

    assert DeepgramSTT(mock_http(handler), Secret("dg")).transcribe(CLIP) == "hi"
    assert seen == {"auth": "Token dg", "type": "audio/wav", "riff": b"RIFF", "model": "nova-3"}


@pytest.mark.parametrize("response", [httpx.Response(401), httpx.Response(200, json={"results": {}})])
def test_deepgram_failures_raise_transcription_error(response) -> None:
    with pytest.raises(TranscriptionError):
        DeepgramSTT(mock_http(lambda r: response), Secret("dg")).transcribe(CLIP)


def test_whisper_loads_model_once_and_joins_segments() -> None:
    loads: list[str] = []

    class Model:
        def transcribe(self, audio, **kwargs):
            assert audio.dtype.name == "float32" and kwargs["language"] == "en"
            return iter([type("S", (), {"text": " Hello "})(), type("S", (), {"text": "there."})()]), None

    def loader(name: str) -> Model:
        loads.append(name)
        return Model()

    stt = WhisperSTT("tiny.en", loader=loader)
    assert stt.transcribe(CLIP) == "Hello there."
    stt.transcribe(CLIP)
    assert loads == ["tiny.en"]


class FakePlayer:
    def __init__(self, rate: int) -> None:
        self.rate, self.written, self.drained = rate, [], None

    def open(self) -> None:
        pass

    def write(self, pcm: bytes) -> None:
        self.written.append(pcm)

    def close(self, drain: bool) -> None:
        self.drained = drain


def test_elevenlabs_streams_pcm_in_whole_samples() -> None:
    players: list[FakePlayer] = []
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["key"] = request.headers["xi-api-key"]
        seen["format"] = request.url.params["output_format"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, content=b"\x01\x02\x03\x04\x05")

    def factory(rate: int) -> FakePlayer:
        players.append(FakePlayer(rate))
        return players[-1]

    tts = ElevenLabsTTS(mock_http(handler), Secret("el"), "voice1", player_factory=factory)
    tts.speak("Hello.")
    assert seen == {"key": "el", "format": "pcm_22050", "body": {"text": "Hello.", "model_id": "eleven_flash_v2_5"}}
    assert b"".join(players[0].written) == b"\x01\x02\x03\x04" and players[0].drained is True


def test_elevenlabs_error_status_raises_speech_error() -> None:
    tts = ElevenLabsTTS(mock_http(lambda r: httpx.Response(401)), Secret("el"), "v", player_factory=FakePlayer)
    with pytest.raises(SpeechError):
        tts.speak("x")


class FakeEngine:
    def __init__(self) -> None:
        self.props, self.said, self.callbacks, self.stopped = {}, [], {}, 0

    def setProperty(self, name, value) -> None:
        self.props[name] = value

    def getProperty(self, name):
        return [type("V", (), {"name": "Microsoft Zira", "id": "zira-id"})()]

    def connect(self, topic, callback) -> None:
        self.callbacks[topic] = callback

    def say(self, text) -> None:
        self.said.append(text)

    def runAndWait(self) -> None:
        self.callbacks["started-word"](None, 0, 1)

    def stop(self) -> None:
        self.stopped += 1


def test_sapi_configures_engine_once_and_speaks() -> None:
    engines: list[FakeEngine] = []

    def factory() -> FakeEngine:
        engines.append(FakeEngine())
        return engines[-1]

    tts = SapiTTS(rate=200, voice="zira", engine_factory=factory)
    tts.speak("One.")
    tts.speak("Two.")
    engine = engines[0]
    assert len(engines) == 1 and engine.said == ["One.", "Two."]
    assert engine.props == {"rate": 200, "volume": 1.0, "voice": "zira-id"}
    assert engine.stopped == 0


def test_sapi_stop_interrupts_at_next_word() -> None:
    engine = FakeEngine()
    tts = SapiTTS(engine_factory=lambda: engine)
    tts.speak("warm up")
    stop_during = threading.Event()

    def run_and_wait() -> None:
        tts.stop()
        stop_during.set()
        engine.callbacks["started-word"](None, 0, 1)

    engine.runAndWait = run_and_wait
    tts.speak("long sentence")
    assert stop_during.is_set() and engine.stopped == 1
