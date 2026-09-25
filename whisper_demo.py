"""Run a local Whisper transcription on an audio file supplied by the operator."""

import os
import sys
import time
from pathlib import Path


def configure_windows_cuda_paths():
    if os.name != "nt":
        return

    site_packages = Path(sys.prefix) / "Lib" / "site-packages"
    library_directories = [
        site_packages / "nvidia" / "cublas" / "bin",
        site_packages / "nvidia" / "cudnn" / "bin",
        site_packages / "nvidia" / "cuda_nvrtc" / "bin",
    ]

    for directory in library_directories:
        if directory.exists():
            os.add_dll_directory(str(directory))
            os.environ["PATH"] = str(directory) + os.pathsep + os.environ.get("PATH", "")


def get_whisper_device():
    import ctranslate2

    try:
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda"
    except Exception as error:
        print(f"CUDA check failed: {error}")

    return "cpu"


def transcribe_audio(audio_path):
    configure_windows_cuda_paths()

    from faster_whisper import WhisperModel

    device = get_whisper_device()
    if device == "cuda":
        compute_type = "float16"
    else:
        compute_type = "int8"

    # Loading the model can download it on first use, so only do this for an
    # explicit transcription request, never while importing this module.
    model = WhisperModel("large-v3", device=device, compute_type=compute_type)
    print(f"Using device: {device}")
    print(f"Transcribing audio: {audio_path}")

    segments, information = model.transcribe(audio_path, beam_size=5)
    print(f"Detected language: {information.language}")
    print(f"Confidence: {information.language_probability:.2f}")

    for segment in segments:
        print(f"[{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}")


def generate_unique_filename(original_name):
    timestamp = int(time.time())
    name, extension = os.path.splitext(original_name)
    return f"{name}_{timestamp}{extension}"


def main():
    if len(sys.argv) != 2:
        print("Usage: python whisper_demo.py <audio-file>")
        return 2

    audio_path = sys.argv[1]
    if not os.path.isfile(audio_path):
        print(f"Error: File not found: {audio_path}")
        return 1

    transcribe_audio(audio_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
