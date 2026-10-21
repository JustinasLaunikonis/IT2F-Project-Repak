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

def read_reference_transcript(reference_path):
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
