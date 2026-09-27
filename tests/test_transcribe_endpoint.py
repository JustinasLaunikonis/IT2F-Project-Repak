from fastapi.testclient import TestClient

import main


client = TestClient(main.app)


def test_wav_upload_returns_text(monkeypatch):
    def fake_transcribe_audio(audio_path):
        with open(audio_path, "rb") as audio_file:
            assert audio_file.read() == b"fake audio data"

        return "Hello from the test"

    monkeypatch.setattr(
        main,
        "transcribe_audio",
        fake_transcribe_audio,
    )

    response = client.post(
        "/transcribe",
        files={
            "file": (
                "sample.wav",
                b"fake audio data",
                "audio/wav",
            )
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "text": "Hello from the test"
    }


def test_non_wav_upload_is_rejected():
    response = client.post(
        "/transcribe",
        files={
            "file": (
                "notes.txt",
                b"not audio",
                "text/plain",
            )
        },
    )

    assert response.status_code == 400
    assert response.json() == {
        "detail": "Please upload a WAV file."
    }


def test_empty_wav_is_rejected():
    response = client.post(
        "/transcribe",
        files={
            "file": (
                "empty.wav",
                b"",
                "audio/wav",
            )
        },
    )

    assert response.status_code == 400
    assert response.json() == {
        "detail": "The uploaded WAV file is empty."
    }
