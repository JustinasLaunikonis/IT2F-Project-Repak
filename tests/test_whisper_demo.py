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
    "device, compute_type",
    [("cpu", "int8"), ("cuda", "float16")],
)
def test_transcription_uses_local_model_and_prints_segments(
    monkeypatch, capsys, device, compute_type
):
    import whisper_demo

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
        ("load", "large-v3", device, compute_type),
        ("transcribe", "synthetic.wav", 5),
    ]
    output = capsys.readouterr().out
    assert "Detected language: en" in output
    assert "Confidence: 0.75" in output
    assert "[0.00s -> 1.25s] synthetic test" in output
    assert "[1.25s -> 2.00s] part two" in output


def test_generated_filename_preserves_extension(monkeypatch):
    import whisper_demo

    def fixed_time():
        return 1234567890

    monkeypatch.setattr(whisper_demo.time, "time", fixed_time)

    assert whisper_demo.generate_unique_filename("synthetic.wav") == "synthetic_1234567890.wav"
