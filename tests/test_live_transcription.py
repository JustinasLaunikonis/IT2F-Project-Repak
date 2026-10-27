"""Tests for live chunk transcription without a Whisper model or GPU."""

import io
import sys
import threading
import time
import types
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

import live_transcription
import main
import whisper_demo


client = TestClient(main.app)


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


@pytest.fixture
def fake_whisper(monkeypatch):
    """Replace faster_whisper with a fake model that records every call."""
    monkeypatch.delenv("WHISPER_DEVICE", raising=False)
    monkeypatch.delenv("WHISPER_MODEL", raising=False)
    monkeypatch.delenv("WHISPER_LANGUAGE", raising=False)
    monkeypatch.setattr(whisper_demo, "configure_windows_cuda_paths", lambda: None)
    monkeypatch.setattr(whisper_demo, "get_whisper_device", lambda: "cpu")

    state = types.SimpleNamespace(
        calls=[],
        speech_clips=[(0.5, 1.5)],
        language_probabilities=[("en", 0.9), ("nl", 0.05), ("de", 0.05)],
        failing_devices=set(),
        transcribe_delay=0.0,
        running=0,
        most_running=0,
    )
    counter_lock = threading.Lock()

    def find_fake_speech(audio_path):
        return np.zeros(2 * whisper_demo.SAMPLE_RATE, dtype=np.float32), state.speech_clips

    monkeypatch.setattr(whisper_demo, "find_speech", find_fake_speech)

    class FakeModel:
        def __init__(self, model_name, device, compute_type, local_files_only):
            state.calls.append(("load", model_name, device, compute_type, local_files_only))
            self.device = device
            self.model = types.SimpleNamespace(
                unload_model=lambda: state.calls.append(("unload", device))
            )

        def detect_language(self, audio):
            state.calls.append(("detect_language", len(audio)))
            best = state.language_probabilities[0]
            return best[0], best[1], state.language_probabilities

        def transcribe(self, audio, beam_size, language, clip_timestamps, condition_on_previous_text):
            if self.device in state.failing_devices:
                raise RuntimeError("Library cublas64_12.dll is not found")
            with counter_lock:
                state.running += 1
                state.most_running = max(state.most_running, state.running)
            time.sleep(state.transcribe_delay)
            with counter_lock:
                state.running -= 1
            state.calls.append(("transcribe", language, clip_timestamps))
            segment = types.SimpleNamespace(start=0.5, end=1.5, text=" hello ")
            return [segment], None

    monkeypatch.setitem(sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=FakeModel))
    return state


def make_transcriber(clock=None):
    return live_transcription.LiveTranscriber(
        idle_seconds=60,
        clock=clock or FakeClock(),
        use_idle_timer=False,
    )


def calls_named(state, name):
    return [call for call in state.calls if call[0] == name]


def test_model_is_loaded_once_and_reused(fake_whisper):
    transcriber = make_transcriber()

    first = transcriber.transcribe_chunk("chunk.wav", "harm", 0.0, "call-1")
    second = transcriber.transcribe_chunk("chunk.wav", "caller", 5.0, "call-1")

    assert calls_named(fake_whisper, "load") == [("load", "small", "cpu", "int8", True)]
    assert calls_named(fake_whisper, "unload") == []
    assert first == {
        "segments": [{"speaker": "Harm", "start": 0.5, "end": 1.5, "text": "hello"}],
        "language": "en",
        "model": "small",
        "device": "cpu",
    }
    #caller chunk starts 5 seconds into the recording
    assert second["segments"] == [{"speaker": "Caller", "start": 5.5, "end": 6.5, "text": "hello"}]


def test_end_session_releases_model_and_is_idempotent(fake_whisper):
    transcriber = make_transcriber()
    transcriber.transcribe_chunk("chunk.wav", "harm", 0.0, "call-1")

    transcriber.end_session("call-1")
    transcriber.end_session("call-1")

    assert calls_named(fake_whisper, "unload") == [("unload", "cpu")]
    assert transcriber.model is None
    assert transcriber.sessions == {}


def test_model_stays_loaded_while_another_session_is_active(fake_whisper):
    transcriber = make_transcriber()
    transcriber.transcribe_chunk("chunk.wav", "harm", 0.0, "call-1")
    transcriber.transcribe_chunk("chunk.wav", "harm", 0.0, "call-2")

    transcriber.end_session("call-1")
    assert calls_named(fake_whisper, "unload") == []

    transcriber.end_session("call-2")
    assert calls_named(fake_whisper, "unload") == [("unload", "cpu")]


def test_idle_model_is_released(fake_whisper):
    clock = FakeClock()
    transcriber = make_transcriber(clock)
    transcriber.transcribe_chunk("chunk.wav", "harm", 0.0, "call-1")

    clock.now = 59.0
    transcriber.release_if_idle()
    assert calls_named(fake_whisper, "unload") == []

    clock.now = 60.0
    transcriber.release_if_idle()
    assert calls_named(fake_whisper, "unload") == [("unload", "cpu")]
    assert transcriber.sessions == {}


def test_chunk_without_speech_does_not_touch_whisper(fake_whisper):
    fake_whisper.speech_clips = []
    transcriber = make_transcriber()

    result = transcriber.transcribe_chunk("chunk.wav", "harm", 10.0, "call-1")

    assert result == {"segments": [], "language": None, "model": "small", "device": "cpu"}
    assert fake_whisper.calls == []


def test_cuda_failure_retries_chunk_on_cpu(fake_whisper, monkeypatch, capsys):
    monkeypatch.setattr(whisper_demo, "get_whisper_device", lambda: "cuda")
    fake_whisper.failing_devices = {"cuda"}
    transcriber = make_transcriber()

    result = transcriber.transcribe_chunk("chunk.wav", "harm", 0.0, "call-1")
    transcriber.transcribe_chunk("chunk.wav", "harm", 5.0, "call-1")

    assert result["device"] == "cpu"
    assert result["model"] == "small"
    assert result["segments"][0]["text"] == "hello"
    assert calls_named(fake_whisper, "load") == [
        ("load", "large-v3-turbo", "cuda", "float16", True),
        ("load", "small", "cpu", "int8", True),
    ]
    assert calls_named(fake_whisper, "unload") == [("unload", "cuda")]
    assert "CUDA transcription failed" in capsys.readouterr().err


def test_cpu_failure_is_raised(fake_whisper):
    fake_whisper.failing_devices = {"cpu"}
    transcriber = make_transcriber()

    with pytest.raises(RuntimeError, match="cublas"):
        transcriber.transcribe_chunk("chunk.wav", "harm", 0.0, "call-1")


def test_concurrent_chunks_use_the_model_one_at_a_time(fake_whisper):
    fake_whisper.transcribe_delay = 0.05
    transcriber = make_transcriber()
    threads = [
        threading.Thread(
            target=transcriber.transcribe_chunk,
            args=("chunk.wav", "harm", index * 5.0, "call-1"),
        )
        for index in range(4)
    ]

    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(calls_named(fake_whisper, "transcribe")) == 4
    assert fake_whisper.most_running == 1
    assert len(calls_named(fake_whisper, "load")) == 1


# Language choice


@pytest.mark.parametrize(
    "probabilities, expected",
    [
        ([("nl", 0.8), ("en", 0.1)], ("nl", 0.8)),
        ([("de", 0.7), ("en", 0.2)], ("de", 0.7)),
        #French is ignored, the best of English, Dutch and German is used
        ([("fr", 0.9), ("nl", 0.06), ("en", 0.03)], ("nl", 0.06)),
        ([("fr", 0.9), ("es", 0.1)], (None, 0.0)),
    ],
)
def test_only_english_dutch_and_german_are_chosen(probabilities, expected):
    assert live_transcription.choose_supported_language(probabilities) == expected


def test_confident_language_is_locked_per_speaker(fake_whisper):
    transcriber = make_transcriber()

    fake_whisper.language_probabilities = [("nl", 0.9), ("en", 0.05)]
    harm = transcriber.transcribe_chunk("chunk.wav", "harm", 0.0, "call-1")

    fake_whisper.language_probabilities = [("de", 0.8), ("nl", 0.1)]
    caller = transcriber.transcribe_chunk("chunk.wav", "caller", 0.0, "call-1")

    #later chunks keep the locked language without detecting again
    fake_whisper.language_probabilities = [("en", 0.99)]
    harm_later = transcriber.transcribe_chunk("chunk.wav", "harm", 5.0, "call-1")
    caller_later = transcriber.transcribe_chunk("chunk.wav", "caller", 5.0, "call-1")

    assert (harm["language"], caller["language"]) == ("nl", "de")
    assert (harm_later["language"], caller_later["language"]) == ("nl", "de")
    assert len(calls_named(fake_whisper, "detect_language")) == 2
    assert [call[1] for call in calls_named(fake_whisper, "transcribe")] == ["nl", "de", "nl", "de"]


def test_unsure_language_uses_english_and_locks_english_after_three_chunks(fake_whisper):
    fake_whisper.language_probabilities = [("fr", 0.6), ("nl", 0.3), ("en", 0.1)]
    transcriber = make_transcriber()

    languages = []
    for index in range(4):
        result = transcriber.transcribe_chunk("chunk.wav", "harm", index * 5.0, "call-1")
        languages.append(result["language"])

    assert languages == ["en", "en", "en", "en"]
    assert len(calls_named(fake_whisper, "detect_language")) == 3
    assert transcriber.sessions["call-1"]["languages"] == {"harm": "en"}


def test_silent_chunks_do_not_count_as_detection_attempts(fake_whisper):
    transcriber = make_transcriber()
    fake_whisper.speech_clips = []
    for index in range(5):
        transcriber.transcribe_chunk("chunk.wav", "harm", index * 5.0, "call-1")

    fake_whisper.speech_clips = [(0.5, 1.5)]
    fake_whisper.language_probabilities = [("de", 0.9)]
    result = transcriber.transcribe_chunk("chunk.wav", "harm", 25.0, "call-1")

    assert result["language"] == "de"


def test_new_session_detects_language_again(fake_whisper):
    transcriber = make_transcriber()
    fake_whisper.language_probabilities = [("nl", 0.9)]
    transcriber.transcribe_chunk("chunk.wav", "harm", 0.0, "call-1")

    fake_whisper.language_probabilities = [("de", 0.9)]
    result = transcriber.transcribe_chunk("chunk.wav", "harm", 0.0, "call-2")

    assert result["language"] == "de"


def test_language_environment_variable_overrides_detection(fake_whisper, monkeypatch):
    monkeypatch.setenv("WHISPER_LANGUAGE", "NL")
    transcriber = make_transcriber()

    result = transcriber.transcribe_chunk("chunk.wav", "caller", 0.0, "call-1")

    assert result["language"] == "nl"
    assert calls_named(fake_whisper, "detect_language") == []
    assert calls_named(fake_whisper, "transcribe")[0][1] == "nl"


# /transcribe-chunk and /live/end


def make_wav(seconds=0.5):
    recording = io.BytesIO()
    with wave.open(recording, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\x00\x00" * int(16000 * seconds))
    return recording.getvalue()


def post_chunk(speaker="harm", start_seconds="0", filename="chunk.wav", content=None, session_id="call-1"):
    if content is None:
        content = make_wav()
    return client.post(
        "/transcribe-chunk",
        files={"audio": (filename, content, "audio/wav")},
        data={"speaker": speaker, "start_seconds": start_seconds, "session_id": session_id},
    )


@pytest.fixture
def endpoint_transcriber(fake_whisper, monkeypatch):
    transcriber = make_transcriber()
    monkeypatch.setattr(main, "live_transcriber", transcriber)
    return transcriber


@pytest.mark.parametrize("speaker, label", [("harm", "Harm"), ("caller", "Caller")])
def test_chunk_endpoint_labels_speaker_and_applies_offset(endpoint_transcriber, speaker, label):
    response = post_chunk(speaker=speaker, start_seconds="12.5")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "segments": [{"speaker": label, "start": 13.0, "end": 14.0, "text": "hello"}],
        "language": "en",
        "model": "small",
        "device": "cpu",
    }


@pytest.mark.parametrize(
    "options, detail",
    [
        ({"speaker": "boss"}, "Speaker must be harm or caller."),
        ({"start_seconds": "-1"}, "start_seconds must be zero or more."),
        ({"start_seconds": "nan"}, "start_seconds must be zero or more."),
        ({"session_id": " "}, "A valid session_id is required."),
        ({"filename": "notes.txt"}, "Please upload WAV files."),
        ({"content": b""}, "An uploaded WAV file is empty."),
    ],
)
def test_chunk_endpoint_rejects_bad_input(endpoint_transcriber, fake_whisper, options, detail):
    response = post_chunk(**options)

    assert response.status_code == 400
    assert response.json() == {"detail": detail}
    assert fake_whisper.calls == []


def test_chunk_failure_returns_readable_error(endpoint_transcriber, fake_whisper):
    fake_whisper.failing_devices = {"cpu"}

    response = post_chunk(speaker="caller")

    assert response.status_code == 500
    assert response.json() == {
        "detail": "Transcribing the caller chunk failed: Library cublas64_12.dll is not found"
    }


def test_real_silent_chunk_without_a_whisper_model(monkeypatch):
    #uses the installed decoder and voice detection, silence never reaches Whisper
    pytest.importorskip("faster_whisper")
    monkeypatch.setenv("WHISPER_DEVICE", "cpu")
    monkeypatch.delenv("WHISPER_MODEL", raising=False)
    monkeypatch.setattr(main, "live_transcriber", make_transcriber())

    response = post_chunk(start_seconds="5")

    assert response.status_code == 200, response.text
    assert response.json() == {"segments": [], "language": None, "model": "small", "device": "cpu"}


def test_live_end_releases_model_and_can_repeat(endpoint_transcriber, fake_whisper):
    post_chunk()

    first = client.post("/live/end", json={"session_id": "call-1"})
    second = client.post("/live/end", json={"session_id": "call-1"})

    assert first.status_code == 200
    assert second.json() == {"ended": True}
    assert calls_named(fake_whisper, "unload") == [("unload", "cpu")]


def test_live_end_requires_session_id():
    response = client.post("/live/end", json={"session_id": ""})

    assert response.status_code == 422
