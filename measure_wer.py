"""measure transcription errors for the recordings in test_calls"""

import argparse
import sys
from pathlib import Path

from jiwer import RemovePunctuation, wer

from whisper_demo import transcribe_audio

#match each recording to its speaker in transcript.txt
AUDIO_SPEAKERS = {
    "harm.wav": "Operator",
    "caller.wav": "Technician",
}

def normalize_text(text):
    text = text.lower()
    text = RemovePunctuation()(text)

    return " ".join(text.split())

def calculate_wer(reference_text, transcribed_text):
    reference_text = normalize_text(reference_text)
    transcribed_text = normalize_text(transcribed_text)

    if not reference_text:
        raise ValueError("The reference text must contain spoken words.")

    return wer(reference_text, transcribed_text) #compare the correct text with generated transcription

def read_reference_transcripts(reference_path):
    reference_parts = {
        "Operator": [],
        "Technician": [],
    }

    reference_text = reference_path.read_text(encoding="utf-8-sig")

    for line in reference_text.splitlines():
        line = line.strip()


        if not line:
            continue

        speaker, separator, spoken_text = line.partition(":")
        speaker = speaker.strip()

        if not separator or speaker not in reference_parts:
            raise ValueError(
                f"{reference_path}: each non-empty line must start "
                "with Operator: or Technician:"
            )

        reference_parts[speaker].append(spoken_text.strip())
    
    references = {}

    #combine each speaker lines into one reference text
    for speaker in reference_parts:
        references[speaker] = " ".join(reference_parts[speaker])
        
    return references

def load_test_cases(calls_directory):
    if not calls_directory.is_dir():
        raise ValueError(
            f"Test-call folder does not exist: {calls_directory}"
        )

    test_cases = []

    for call_directory in sorted(calls_directory.iterdir()):
        if not call_directory.is_dir():
            continue
        
        reference_path = call_directory / "transcript.txt"
        references = read_reference_transcripts(reference_path)

        for audio_filename, speaker in AUDIO_SPEAKERS.items():
            audio_path = call_directory / audio_filename

            if not audio_path.is_file():
                raise FileNotFoundError(
                    f"Recording not found: {audio_path}"
                )

            reference_text = references[speaker]

            if not normalize_text(reference_text):
                raise ValueError(
                    f"{reference_path}: no spoken words found "
                    f"for {speaker}."
                )

            test_cases.append({
                "audio_path": audio_path,
                "reference_text": reference_text,
            })

    if not test_cases:
        raise ValueError("No test calls were found.")

    return test_cases
