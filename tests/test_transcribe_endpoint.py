from fastapi.testclient import TestClient

import main


client = TestClient(main.app)


def test_wav_upload_return_speaker_transcript(monkeypatch):
    def fake_transcribe_segments(audio_path):
        if audio_path.endswith("harm.wav"):
            return {
                "segments": [
                    {
                        "start": 0.0,
                        "end": 1.0,
                        "text": "Hello caller",
                    }
                ],
                "model": "large-v3-turbo",
                "device": "cuda",
            }

        return {
            "segments": [
                {
                    "start": 2.0,
                    "end": 3.0,
                    "text": "Hello Harm",
                }
            ],
            "model": "small",
            "device": "cpu",
        }

    monkeypatch.setattr(
        main,
        "transcribe_audio_segments",
        fake_transcribe_segments,
    )

    response = client.post(
        "/transcribe",
        files={
            "harm": (
                "sample.wav",
                b"fake audio data",
                "audio/wav",
            ),
            "caller": (
                "caller.wav",
                b"fake caller audio",
                "audio/wav",
            ),
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "segments": [
            {
                "speaker": "Harm",
                "start": 0.0,
                "end": 1.0,
                "text": "Hello caller",
            },
            {
                "speaker": "Caller",
                "start": 2.0,
                "end": 3.0,
                "text": "Hello Harm",
            },
        ],
        "text": (
            "[00:00:00] Harm: Hello caller\n"
            "[00:00:02] Caller: Hello Harm"
        ),
        "transcription_info": {
            "Harm": {
                "model": "large-v3-turbo",
                "device": "cuda",
            },
            "Caller": {
                "model": "small",
                "device": "cpu",
            },
        },
    }


def test_microphone_only_recording_still_works(monkeypatch):
    #return one example segment without loading whisper
    def fake_transcribe_segments(audio_path):
        return {
            "segments": [
                {
                    "start": 0.0,
                    "end": 1.0,
                    "text": "Microphone only",
                }
            ],
            "model": "small",
            "device": "cpu",
        }

    monkeypatch.setattr(
        main,
        "transcribe_audio_segments",
        fake_transcribe_segments,
    )

    response = client.post(
        "/transcribe",
        files={
            "harm": (
                "harm.wav",
                b"fake harm audio",
                "audio/wav",
            ),
        },
    )

    assert response.status_code == 200

    assert response.json() == {
        "segments": [
            {
                "speaker": "Harm",
                "start": 0.0,
                "end": 1.0,
                "text": "Microphone only",
            }
        ],
        "text": "[00:00:00] Harm: Microphone only",
        "transcription_info": {
            "Harm": {
                "model": "small",
                "device": "cpu",
            },
        },
    }

 ## HERE ********************************************************


def test_non_wav_upload_is_rejected():
    response = client.post(
        "/transcribe",
        files={
            "harm": (
                "notes.txt",
                b"not audio",
                "text/plain",
            )
        },
    )

    assert response.status_code == 400
    assert response.json() == {
        "detail": "Please upload WAV files."
    }


def test_empty_wav_is_rejected():
    response = client.post(
        "/transcribe",
        files={
            "harm": (
                "empty.wav",
                b"",
                "audio/wav",
            )
        },
    )

    assert response.status_code == 400
    assert response.json() == {
        "detail": "An uploaded WAV file is empty."
    }


def test_transcription_failure_returns_readable_error(monkeypatch):
    #simulate whisper crashing while transcribing
    def failing_transcribe_segments(audio_path):
        raise RuntimeError("model file is missing")

    monkeypatch.setattr(
        main,
        "transcribe_audio_segments",
        failing_transcribe_segments,
    )

    response = client.post(
        "/transcribe",
        files={
            "harm": (
                "harm.wav",
                b"fake harm audio",
                "audio/wav",
            )
        },
    )

    assert response.status_code == 500
    assert response.json() == {
        "detail": "Transcribing the microphone recording failed: model file is missing"
    }
