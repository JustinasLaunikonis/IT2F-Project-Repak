"""Manually test local Whisper transcription with an audio file."""

import argparse
import sys
from pathlib import Path

from whisper_demo import generate_unique_filename, transcribe_audio


def get_audio_path():
    parser = argparse.ArgumentParser(
        description="Transcribe an audio file using local Whisper."
    )
    parser.add_argument(
        "audio_path",
        type=Path,
        help="Path to the audio file to transcribe.",
    )
    arguments = parser.parse_args()
    return arguments.audio_path


def main():
    audio_path = get_audio_path()

    if not audio_path.is_file():
        print("Error: File not found: " + str(audio_path))
        return 1

    # whisper_demo loads only a model that install.bat already downloaded.
    transcribe_audio(str(audio_path))

    filename = generate_unique_filename("repak_customer_call.txt")
    print("\nGenerated filename example: " + filename)
    return 0


if __name__ == "__main__":
    sys.exit(main())
