"""Run a local Whisper transcription on an audio file supplied by the operator."""

import os
import sys
import time
from pathlib import Path

GPU_MODEL = "large-v3-turbo"
CPU_MODEL = "small"
_cuda_dll_handles = []


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
            # Keep the handle alive: closing it removes the DLL search path.
            _cuda_dll_handles.append(os.add_dll_directory(str(directory)))
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

    requested_device = os.environ.get("WHISPER_DEVICE", "auto").strip().lower()
    if requested_device not in {"auto", "cuda", "cpu"}:
        raise ValueError("WHISPER_DEVICE must be auto, cuda, or cpu")

    available_device = get_whisper_device() if requested_device != "cpu" else "cpu"
    device = "cpu" if requested_device == "cpu" else available_device
    if device == "cpu" and requested_device != "cpu":
        print("Warning: CUDA is unavailable; using the CPU model.", file=sys.stderr)

    model_override = os.environ.get("WHISPER_MODEL", "").strip()
    model_name = model_override or (GPU_MODEL if device == "cuda" else CPU_MODEL)
    compute_type = "float16" if device == "cuda" else "int8"

    # install.bat downloads models before transcription. Keep audio processing
    # offline even if the requested model is missing from the local cache.
    try:
        model = WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
            local_files_only=True,
        )
    except (OSError, RuntimeError) as error:
        if device != "cuda":
            raise
        print(f"Warning: CUDA model failed to load ({error}); using CPU.", file=sys.stderr)
        device = "cpu"
        model_name = model_override or CPU_MODEL
        compute_type = "int8"
        model = WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
            local_files_only=True,
        )

    print(f"Using Whisper model: {model_name}; device: {device}; compute type: {compute_type}")
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
