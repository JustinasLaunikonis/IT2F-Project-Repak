"""Run a local Whisper transcription on an audio file supplied by the operator."""

import os
import sys
import time
from pathlib import Path

GPU_MODEL = "large-v3-turbo"
CPU_MODEL = "small"
SAMPLE_RATE = 16000
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


def find_speech(audio_path):
    from faster_whisper import decode_audio
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    audio = decode_audio(audio_path, sampling_rate=SAMPLE_RATE)

    #a bit stricter than the default so clicks and beeps are not treated as speech
    speech_options = VadOptions(
        threshold=0.65,
        min_speech_duration_ms=250,
        min_silence_duration_ms=500,
        speech_pad_ms=200,
    )
    speech_chunks = get_speech_timestamps(audio, speech_options)

    #convert sample positions to seconds
    speech_clips = []
    for chunk in speech_chunks:
        speech_clips.append((chunk["start"] / SAMPLE_RATE, chunk["end"] / SAMPLE_RATE))

    return audio, speech_clips


def detect_speech_language(model, audio, speech_clips):
    import numpy as np

    speech_parts = []
    for start, end in speech_clips:
        speech_parts.append(audio[int(start * SAMPLE_RATE):int(end * SAMPLE_RATE)])

    language, language_probability, all_language_probabilities = model.detect_language(
        np.concatenate(speech_parts)
    )
    return language, language_probability


def transcribe_audio_segments(audio_path):
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

    audio, speech_clips = find_speech(audio_path)
    if len(speech_clips) == 0:
        print(f"No speech found in: {audio_path}")
        return {
            "segments": [],
            "model": model_name,
            "device": device,
        }

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

    try:
        language, language_probability = detect_speech_language(model, audio, speech_clips)
        print(f"Detected language: {language}")
        print(f"Confidence: {language_probability:.2f}")

        #Whisper expects a flat list: start1, end1, start2, end2, ...
        clip_timestamps = []
        for start, end in speech_clips:
            clip_timestamps.append(start)
            clip_timestamps.append(end)
            
        segments, information = model.transcribe(
            audio,
            beam_size=5,
            language=language,
            clip_timestamps=clip_timestamps,
        )

        transcription_segments = []
        for segment in segments:
            print(f"[{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}")
            transcription_segments.append({
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
            })
        return {
            "segments": transcription_segments,
            "model": model_name,
            "device": device,
        }
    finally:
        # Finish with Whisper before loading the report LLM into the same GPU.
        model.model.unload_model()


def transcribe_audio(audio_path):
    result = transcribe_audio_segments(audio_path)
    segments = result["segments"]

    text_parts = []

    #keep only the text from each segment
    for segment in segments:
        text_parts.append(segment["text"])


    #preserve the olds text only transcription result
    return " ".join(text_parts)


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
