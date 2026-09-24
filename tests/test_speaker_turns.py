"""Tests for speaker turns and reviewed JSON output."""

import json

import pytest

from speaker_turns import add_speaker_to_segments, merge_channels, save_speaker_turns


def test_label_segments_keeps_times_and_text_without_mutating_input():
    segments = [{"start": 0.0, "end": 1.5, "text": "Hello"}]

    labelled = add_speaker_to_segments(segments, "operator")

    assert labelled == [
        {"speaker": "operator", "start": 0.0, "end": 1.5, "text": "Hello"}
    ]
    assert segments == [{"start": 0.0, "end": 1.5, "text": "Hello"}]
    assert labelled[0] is not segments[0]


def test_merge_orders_alternating_speakers_by_start_time():
    channel_one = [
        {"start": 4.0, "end": 5.0, "text": "Fourth"},
        {"start": 0.0, "end": 1.0, "text": "First"},
    ]
    channel_two = [
        {"start": 2.0, "end": 3.0, "text": "Third"},
        {"start": 1.0, "end": 2.0, "text": "Second"},
    ]

    turns = merge_channels(channel_one, channel_two)

    assert turns == [
        {"speaker": "speaker_1", "start": 0.0, "end": 1.0, "text": "First"},
        {"speaker": "speaker_2", "start": 1.0, "end": 3.0, "text": "Second Third"},
        {"speaker": "speaker_1", "start": 4.0, "end": 5.0, "text": "Fourth"},
    ]
    assert channel_one[0]["text"] == "Fourth"
    assert channel_two[0]["text"] == "Third"


def test_merge_extends_end_time_for_adjacent_same_speaker():
    channel_one = [
        {"start": 0.0, "end": 4.0, "text": "Part one"},
        {"start": 1.0, "end": 2.0, "text": "Part two"},
        {"start": 2.0, "end": 5.0, "text": "Part three"},
    ]

    turns = merge_channels(channel_one, [])

    assert turns == [
        {
            "speaker": "speaker_1",
            "start": 0.0,
            "end": 5.0,
            "text": "Part one Part two Part three",
        }
    ]
    assert channel_one[0]["text"] == "Part one"


def test_merge_empty_channels_returns_empty_turns():
    assert merge_channels([], []) == []
    assert add_speaker_to_segments([], "operator") == []


def test_save_requires_explicit_confirmation_and_creates_no_file(tmp_path):
    output_path = tmp_path / "transcript.json"
    turns = [{"speaker": "speaker_1", "text": "Synthetic call"}]

    for confirmation in [False, None, 1, "yes"]:
        with pytest.raises(ValueError):
            save_speaker_turns(turns, output_path, confirmation)
        assert not output_path.exists()


def test_save_writes_utf8_json_after_confirmation(tmp_path):
    output_path = tmp_path / "transcript.json"
    turns = [
        {
            "speaker": "speaker_1",
            "start": 0.0,
            "end": 1.0,
            "text": "Prüfung beëindigd",
        }
    ]

    save_speaker_turns(turns, output_path, True)

    file_bytes = output_path.read_bytes()
    assert "Prüfung beëindigd".encode("utf-8") in file_bytes
    assert json.loads(file_bytes.decode("utf-8")) == turns


def test_save_refuses_to_overwrite_existing_file(tmp_path):
    output_path = tmp_path / "transcript.json"
    original_contents = "Keep the existing transcript"
    output_path.write_text(original_contents, encoding="utf-8")

    with pytest.raises(FileExistsError):
        save_speaker_turns([], output_path, True)

    assert output_path.read_text(encoding="utf-8") == original_contents
