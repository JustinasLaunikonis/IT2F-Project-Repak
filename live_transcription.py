"""Transcribe short audio chunks while a call is still being recorded.

whisper_demo.transcribe_audio_segments loads and unloads Whisper for every file.
That is fine for one upload after the call, but far too slow for a chunk every few
seconds, so this module keeps one model loaded until the call ends or goes idle.
"""

import os
import sys
import threading
import time

import numpy as np

import whisper_demo

# Live calls are in English, Dutch or German. Other detected languages are ignored.
SUPPORTED_LANGUAGES = ("en", "nl", "de")
DEFAULT_LANGUAGE = "en"

# Starting guesses, tune these with real calls.
LANGUAGE_LOCK_PROBABILITY = 0.5  #lock a speaker's language once detection is this sure
LANGUAGE_DETECTION_CHUNKS = 3  #after this many unsure speech chunks, keep English
IDLE_SECONDS = 60  #unload the model when no chunk arrived for this long

SPEAKER_LABELS = {"harm": "Harm", "caller": "Caller"}


def choose_supported_language(all_language_probabilities):
    #pick the most likely language among English, Dutch and German
    best_language = None
    best_probability = 0.0

    for language, probability in all_language_probabilities:
        if language in SUPPORTED_LANGUAGES and probability > best_probability:
            best_language = language
            best_probability = probability

    return best_language, best_probability


def choose_model_settings():
    #same device and model choice as whisper_demo.transcribe_audio_segments
    requested_device = os.environ.get("WHISPER_DEVICE", "auto").strip().lower()
    if requested_device not in {"auto", "cuda", "cpu"}:
        raise ValueError("WHISPER_DEVICE must be auto, cuda, or cpu")

    device = "cpu"
    if requested_device != "cpu":
        device = whisper_demo.get_whisper_device()
        if device == "cpu":
            print("Warning: CUDA is unavailable; using the CPU model.", file=sys.stderr)

    return cpu_or_gpu_settings(device)


def cpu_or_gpu_settings(device):
    model_override = os.environ.get("WHISPER_MODEL", "").strip()
    if device == "cuda":
        return {
            "model": model_override or whisper_demo.GPU_MODEL,
            "device": "cuda",
            "compute_type": "float16",
        }

    return {
        "model": model_override or whisper_demo.CPU_MODEL,
        "device": "cpu",
        "compute_type": "int8",
    }


class LiveTranscriber:
    def __init__(self, idle_seconds=IDLE_SECONDS, clock=time.monotonic, use_idle_timer=True):
        self.lock = threading.Lock()  #only one chunk uses the model at a time
        self.model = None
        self.settings = None
        self.sessions = {}
        self.last_used = None
        self.idle_seconds = idle_seconds
        self.clock = clock
        self.use_idle_timer = use_idle_timer
        self.idle_timer = None

    def transcribe_chunk(self, audio_path, speaker, start_seconds, session_id):
        #voice detection does not need the Whisper model, so it runs outside the lock
        audio, speech_clips = whisper_demo.find_speech(str(audio_path))

        with self.lock:
            self.last_used = self.clock()
            session = self.sessions.setdefault(
                session_id,
                {"languages": {}, "detection_attempts": {}},
            )

            if self.settings is None:
                self.settings = choose_model_settings()

            if len(speech_clips) == 0:
                segments = []
                language = session["languages"].get(speaker)
            else:
                segments, language = self._transcribe_speech(
                    session, speaker, audio, speech_clips
                )

            result = {
                "segments": [],
                "language": language,
                "model": self.settings["model"],
                "device": self.settings["device"],
            }

            #move chunk times to their place in the whole recording
            for segment in segments:
                result["segments"].append({
                    "speaker": SPEAKER_LABELS[speaker],
                    "start": round(segment["start"] + start_seconds, 3),
                    "end": round(segment["end"] + start_seconds, 3),
                    "text": segment["text"],
                })

        self._schedule_idle_check()
        return result

    def end_session(self, session_id):
        with self.lock:
            self.sessions.pop(session_id, None)
            #keep the model while another browser tab is still recording
            if len(self.sessions) == 0:
                self._release()

    def release_if_idle(self):
        with self.lock:
            if self.last_used is None:
                return
            if self.clock() - self.last_used >= self.idle_seconds:
                self.sessions.clear()
                self._release()

    def _transcribe_speech(self, session, speaker, audio, speech_clips):
        while True:
            try:
                model = self._load_model()
                language, language_update = self._choose_language(
                    model, session, speaker, audio, speech_clips
                )
                segments = self._run_whisper(model, audio, speech_clips, language)
                break
            except (OSError, RuntimeError) as error:
                #CUDA libraries can fail at any step, retry the chunk once on the CPU
                if self.settings["device"] != "cuda":
                    raise
                print(f"Warning: CUDA transcription failed ({error}); using CPU.", file=sys.stderr)
                self._unload_model()
                self.settings = cpu_or_gpu_settings("cpu")

        #only remember the language after the chunk was transcribed successfully
        if language_update is not None:
            session["detection_attempts"][speaker] = language_update["attempts"]
            if language_update["lock"]:
                session["languages"][speaker] = language
                print(f"Live language for {speaker}: {language}")

        return segments, language

    def _choose_language(self, model, session, speaker, audio, speech_clips):
        selected_language = os.environ.get("WHISPER_LANGUAGE", "").strip().lower()
        if selected_language:
            return selected_language, None

        locked_language = session["languages"].get(speaker)
        if locked_language is not None:
            return locked_language, None

        speech_parts = []
        for start, end in speech_clips:
            speech_parts.append(audio[int(start * whisper_demo.SAMPLE_RATE):int(end * whisper_demo.SAMPLE_RATE)])

        language, language_probability, all_language_probabilities = model.detect_language(
            np.concatenate(speech_parts)
        )
        language, probability = choose_supported_language(all_language_probabilities)
        attempts = session["detection_attempts"].get(speaker, 0) + 1
        print(f"Live language guess for {speaker}: {language} ({probability:.2f})")

        if language is not None and probability >= LANGUAGE_LOCK_PROBABILITY:
            return language, {"lock": True, "attempts": attempts}

        #not sure yet: use English for this chunk and try again on the next one
        lock_default = attempts >= LANGUAGE_DETECTION_CHUNKS
        return DEFAULT_LANGUAGE, {"lock": lock_default, "attempts": attempts}

    def _run_whisper(self, model, audio, speech_clips, language):
        clip_timestamps = []
        for start, end in speech_clips:
            clip_timestamps.append(start)
            clip_timestamps.append(end)

        segments, information = model.transcribe(
            audio,
            beam_size=5,
            language=language,
            clip_timestamps=clip_timestamps,
            condition_on_previous_text=False,
        )

        #read the lazy generator here, so CUDA errors are caught by the retry
        transcription_segments = []
        for segment in segments:
            transcription_segments.append({
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
            })

        return transcription_segments

    def _load_model(self):
        if self.model is not None:
            return self.model

        from faster_whisper import WhisperModel

        whisper_demo.configure_windows_cuda_paths()
        print(
            f"Loading live Whisper model: {self.settings['model']}; "
            f"device: {self.settings['device']}; compute type: {self.settings['compute_type']}"
        )
        self.model = WhisperModel(
            self.settings["model"],
            device=self.settings["device"],
            compute_type=self.settings["compute_type"],
            local_files_only=True,
        )
        return self.model

    def _unload_model(self):
        if self.model is None:
            return
        try:
            self.model.model.unload_model()
        finally:
            self.model = None

    def _release(self):
        #free GPU memory, for example for the report model that runs after the call
        self._unload_model()
        self.settings = None
        self.last_used = None
        if self.idle_timer is not None:
            self.idle_timer.cancel()
            self.idle_timer = None

    def _schedule_idle_check(self):
        if not self.use_idle_timer:
            return
        with self.lock:
            if self.idle_timer is not None:
                self.idle_timer.cancel()
            self.idle_timer = threading.Timer(self.idle_seconds, self.release_if_idle)
            self.idle_timer.daemon = True
            self.idle_timer.start()
