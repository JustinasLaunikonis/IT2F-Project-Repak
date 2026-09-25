"""Tests for the local Whisper demonstration without a model or audio file."""

import importlib
import sys
import types

import pytest


def test_import_does_not_load_model(monkeypatch):
    def reject_model_loading(*args, **kwargs):
        raise AssertionError("Import must not load a Whisper model")

    fake_whisper = types.ModuleType("faster_whisper")
    fake_whisper.WhisperModel = reject_model_loading
    monkeypatch.setitem(sys.modules, "faster_whisper", fake_whisper)

    import whisper_demo

    importlib.reload(whisper_demo)


@pytest.mark.parametrize(
    "cuda_devices, expected_device",
    [(0, "cpu"), (1, "cuda")],
)
def test_device_selection(monkeypatch, cuda_devices, expected_device):
    import whisper_demo

    fake_ctranslate = types.ModuleType("ctranslate2")

    def get_cuda_device_count():
        return cuda_devices

    fake_ctranslate.get_cuda_device_count = get_cuda_device_count
    monkeypatch.setitem(sys.modules, "ctranslate2", fake_ctranslate)

    assert whisper_demo.get_whisper_device() == expected_device


def test_cuda_check_failure_uses_cpu(monkeypatch):
    import whisper_demo

    fake_ctranslate = types.ModuleType("ctranslate2")

    def get_cuda_device_count():
        raise RuntimeError("Synthetic CUDA failure")

    fake_ctranslate.get_cuda_device_count = get_cuda_device_count
    monkeypatch.setitem(sys.modules, "ctranslate2", fake_ctranslate)

    assert whisper_demo.get_whisper_device() == "cpu"


@pytest.mark.parametrize(
    "device, model_name, compute_type",
    [("cpu", "small", "int8"), ("cuda", "large-v3-turbo", "float16")],
)
def test_transcription_uses_local_model_and_prints_segments(
    monkeypatch, capsys, device, model_name, compute_type
):
    import whisper_demo

    monkeypatch.delenv("WHISPER_DEVICE", raising=False)
    monkeypatch.delenv("WHISPER_MODEL", raising=False)
    calls = []
    fake_whisper = types.ModuleType("faster_whisper")

    class FakeModel:
        def __init__(self, model_name, device, compute_type):
            calls.append(("load", model_name, device, compute_type))

        def transcribe(self, audio_path, beam_size):
            calls.append(("transcribe", audio_path, beam_size))
            first_segment = types.SimpleNamespace(start=0.0, end=1.25, text="synthetic test")
            second_segment = types.SimpleNamespace(start=1.25, end=2.0, text="part two")
            information = types.SimpleNamespace(language="en", language_probability=0.75)
            return [first_segment, second_segment], information

    fake_whisper.WhisperModel = FakeModel
    monkeypatch.setitem(sys.modules, "faster_whisper", fake_whisper)

    def get_selected_device():
        return device

    def skip_cuda_path_configuration():
        return None

    monkeypatch.setattr(whisper_demo, "get_whisper_device", get_selected_device)
    monkeypatch.setattr(whisper_demo, "configure_windows_cuda_paths", skip_cuda_path_configuration)

    whisper_demo.transcribe_audio("synthetic.wav")

    assert calls == [
        ("load", model_name, device, compute_type),
        ("transcribe", "synthetic.wav", 5),
    ]
    captured = capsys.readouterr()
    output = captured.out
    assert f"Using Whisper model: {model_name}; device: {device}; compute type: {compute_type}" in output
    if device == "cpu":
        assert "Warning: CUDA is unavailable" in captured.err
    assert "Detected language: en" in output
    assert "Confidence: 0.75" in output
    assert "[0.00s -> 1.25s] synthetic test" in output
    assert "[1.25s -> 2.00s] part two" in output


def test_explicit_cpu_and_model_override(monkeypatch, capsys):
    import whisper_demo

    monkeypatch.setenv("WHISPER_DEVICE", "cpu")
    monkeypatch.setenv("WHISPER_MODEL", "base")
    monkeypatch.setattr(whisper_demo, "configure_windows_cuda_paths", lambda: None)
    monkeypatch.setattr(whisper_demo, "get_whisper_device", lambda: pytest.fail("CUDA queried"))

    calls = []
    fake_whisper = types.ModuleType("faster_whisper")

    class FakeModel:
        def __init__(self, model_name, device, compute_type):
            calls.append((model_name, device, compute_type))

        def transcribe(self, audio_path, beam_size):
            return [], types.SimpleNamespace(language="en", language_probability=1.0)

    fake_whisper.WhisperModel = FakeModel
    monkeypatch.setitem(sys.modules, "faster_whisper", fake_whisper)

    whisper_demo.transcribe_audio("synthetic.wav")

    assert calls == [("base", "cpu", "int8")]
    assert "Using Whisper model: base; device: cpu" in capsys.readouterr().out


def test_cuda_load_failure_falls_back_to_small_cpu_model(monkeypatch, capsys):
    import whisper_demo

    monkeypatch.delenv("WHISPER_DEVICE", raising=False)
    monkeypatch.delenv("WHISPER_MODEL", raising=False)
    monkeypatch.setattr(whisper_demo, "configure_windows_cuda_paths", lambda: None)
    monkeypatch.setattr(whisper_demo, "get_whisper_device", lambda: "cuda")

    calls = []
    fake_whisper = types.ModuleType("faster_whisper")

    class FakeModel:
        def __init__(self, model_name, device, compute_type):
            calls.append((model_name, device, compute_type))
            if device == "cuda":
                raise RuntimeError("missing CUDA library")

        def transcribe(self, audio_path, beam_size):
            return [], types.SimpleNamespace(language="en", language_probability=1.0)

    fake_whisper.WhisperModel = FakeModel
    monkeypatch.setitem(sys.modules, "faster_whisper", fake_whisper)

    whisper_demo.transcribe_audio("synthetic.wav")

    assert calls == [
        ("large-v3-turbo", "cuda", "float16"),
        ("small", "cpu", "int8"),
    ]
    output = capsys.readouterr()
    assert "Warning: CUDA model failed to load" in output.err
    assert "Using Whisper model: small; device: cpu" in output.out


def test_generated_filename_preserves_extension(monkeypatch):
    import whisper_demo

    def fixed_time():
        return 1234567890

    monkeypatch.setattr(whisper_demo.time, "time", fixed_time)

    assert whisper_demo.generate_unique_filename("synthetic.wav") == "synthetic_1234567890.wav"
