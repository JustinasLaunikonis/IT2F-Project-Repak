"""Download the local Whisper models needed by this computer."""

import os
import sys
from pathlib import Path

from faster_whisper.utils import download_model

from whisper_demo import CPU_MODEL, GPU_MODEL, get_whisper_device


def models_to_download():
    requested_device = os.environ.get("WHISPER_DEVICE", "auto").strip().lower()
    if requested_device not in {"auto", "cuda", "cpu"}:
        raise ValueError("WHISPER_DEVICE must be auto, cuda, or cpu")

    model_override = os.environ.get("WHISPER_MODEL", "").strip()
    if model_override:
        return [model_override]

    if requested_device == "cpu":
        return [CPU_MODEL]

    available_device = get_whisper_device()
    if available_device == "cuda":
        # The CPU model is also needed if CUDA fails when loading a model.
        return [GPU_MODEL, CPU_MODEL]

    return [CPU_MODEL]


def check_local_model_directory(model_directory):
    required_files = ["config.json", "model.bin", "tokenizer.json"]
    for filename in required_files:
        model_file = model_directory / filename
        if not model_file.is_file():
            raise ValueError(
                "Local Whisper model folder is missing "
                + filename
                + ": "
                + str(model_directory)
            )


def main():
    try:
        model_names = models_to_download()
        for model_name in model_names:
            model_directory = Path(model_name)
            if model_directory.is_dir():
                check_local_model_directory(model_directory)
                print("Using local Whisper model: " + model_name, flush=True)
                continue
            print("Downloading Whisper model: " + model_name, flush=True)
            download_model(model_name)
        print("Whisper models are ready.")
        return 0
    except Exception as error:
        print("Could not download a Whisper model: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
