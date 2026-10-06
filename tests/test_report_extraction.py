import json

import httpx
import pytest
from fastapi.testclient import TestClient

import main
from transcript_to_json import report_extractor
from transcript_to_json.report_schema import ExtractedCallFields


EXTRACTED_FIELDS = {
    "machine_number": " RP-204 ",
    "customer": None,
    "problem": "Machine stops during production.",
    "alarm_code": "E204",
    "actions_taken": "Restarting did not help.",
}


def mock_model(monkeypatch, body):
    def respond(request):
        payload = json.loads(request.content)
        assert payload["think"] is False
        assert payload["format"]["additionalProperties"] is False
        assert payload["messages"][-1]["content"] == "Example call"
        return httpx.Response(200, json=body)

    transport = httpx.MockTransport(respond)
    original_client = httpx.Client
    monkeypatch.setattr(
        report_extractor.httpx,
        "Client",
        lambda **kwargs: original_client(transport=transport, **kwargs),
    )


def test_model_json_is_validated(monkeypatch):
    mock_model(monkeypatch, {
        "done": True,
        "done_reason": "stop",
        "message": {"content": json.dumps(EXTRACTED_FIELDS)},
    })

    extracted = report_extractor.extract_call_fields_from_transcript("Example call")

    assert extracted.alarm_code == "E204"
    assert extracted.customer is None


@pytest.mark.parametrize("body", [
    [],
    {"done": False},
    {"done": True, "done_reason": "length"},
    {"done": True},
    {"done": True, "message": {"content": ""}},
    {"done": True, "message": {"content": "not JSON"}},
    {"done": True, "message": {"content": '{"alarm_code": "E204"}'}},
])
def test_invalid_or_incomplete_model_output_is_rejected(monkeypatch, body):
    mock_model(monkeypatch, body)

    with pytest.raises(ValueError):
        report_extractor.extract_call_fields_from_transcript("Example call")


def test_endpoint_reads_transcript_from_json_body(monkeypatch):
    received_transcripts = []

    def extract(transcript):
        received_transcripts.append(transcript)
        return ExtractedCallFields(**EXTRACTED_FIELDS)

    monkeypatch.setattr(main, "extract_call_fields_from_transcript", extract)

    response = TestClient(main.app).post(
        "/extract-report", json={"transcript": "Example call"},
    )

    assert response.status_code == 200
    assert received_transcripts == ["Example call"]
    assert response.json() == {
        "fields": {
            "[machinenummer]": "RP-204",
            "[klant]": "",
            "[probleem]": "Machine stops during production.",
            "[alarmcode of exacte tekst]": "E204",
            "[acties en resultaten]": "Restarting did not help.",
        },
        "mode": "llm",
        "warning": None,
    }


@pytest.mark.parametrize("error", [
    httpx.ConnectError("Ollama is unavailable"),
    httpx.ReadTimeout("Model took too long"),
    ValueError("Model returned invalid JSON"),
])
def test_extraction_failure_allows_manual_entry(monkeypatch, error):
    def fail(transcript):
        raise error

    monkeypatch.setattr(main, "extract_call_fields_from_transcript", fail)

    response = TestClient(main.app).post(
        "/extract-report", json={"transcript": "Example call"},
    )

    assert response.status_code == 200
    assert response.json()["mode"] == "manual"
    assert response.json()["fields"] == {}
    assert response.json()["warning"]


@pytest.mark.parametrize("payload", [{}, {"transcript": ""}, {"transcript": "   "}])
def test_missing_or_blank_transcript_never_calls_model(monkeypatch, payload):
    def unexpected_call(transcript):
        pytest.fail("An invalid request must not reach the model")

    monkeypatch.setattr(main, "extract_call_fields_from_transcript", unexpected_call)

    response = TestClient(main.app).post("/extract-report", json=payload)

    assert response.status_code == 422
