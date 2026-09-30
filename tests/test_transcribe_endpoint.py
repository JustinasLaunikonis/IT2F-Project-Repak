from fastapi.testclient import TestClient

import main


client = TestClient(main.app)


def test_wav_upload_return_speaker_transcript(monkeypatch):
    def fake_transcribe_segments(audio_path):
        if audio_path.endswith("harm.wav"):
            return [
                {
                    "start": 0.0,
                    "end": 1.0,
                    "text": "Hello caller",
                }
            ]

        return [
            {
                "start": 2.0,
                "end": 3.0,
                "text": "Hello Harm", 
            }
        ]

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
    }


def test_microphone_only_recording_still_works(monkeypatch):
    #return one example segment without loading whisper
    def fake_transcribe_segments(audio_path):
        return [
            {
                "start": 0.0,
                "end": 1.0,
                "text": "Microphone only",
            }
        ]

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
        "text": "[00:00:00] Harm: Microphone only"
    }

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
