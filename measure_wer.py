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

