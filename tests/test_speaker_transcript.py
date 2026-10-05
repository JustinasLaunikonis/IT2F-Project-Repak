from speaker_transcript import(
    format_timestamp,
    merge_and_format_transcript,
)

def test_format_timestamp():
    assert format_timestamp(72) == "00:01:12"
    assert format_timestamp(3661) == "01:01:01"


def test_segments_are_labelled_and_sorted():
    #example transcription data used for this test
    harm_segments = [
        {
        "start": 0.0,
        "end": 1.0,
        "text": "How can I help?",
        },
        {
            "start": 4.0,
            "end": 5.0,
            "text": "I understand.",
        },
    ]

    caller_segments = [
        {
            "start": 2.0,
            "end": 3.0,
            "text": "The machine stopped.",
        },
    ]

    result = merge_and_format_transcript(
        harm_segments,
        caller_segments
    )

    assert result["segments"] == [
        {
            "speaker": "Harm",
            "start": 0.0,
            "end": 1.0,
            "text": "How can I help?",
        },
        {
            "speaker": "Caller",
            "start": 2.0,
            "end": 3.0,
            "text": "The machine stopped.",
        },
        {
            "speaker": "Harm",
            "start": 4.0,
            "end": 5.0,
            "text": "I understand.",
        },     
    ]

    assert result["text"] == (
        "[00:00:00] Harm: How can I help?\n"
        "[00:00:02] Caller: The machine stopped.\n"
        "[00:00:04] Harm: I understand."
    )

def test_function_does_not_change_original_segments():
    harm_segments = [
        {
            "start": 0.0,
            "end": 1.0,
            "text": " Hello ",
        }
    ] 

    caller_segments = []

    merge_and_format_transcript(
        harm_segments,
        caller_segments
    )

    #original imput must stay unchanged
    assert harm_segments == [
        {
            "start": 0.0,
            "end": 1.0,
            "text": " Hello ",
        }
    ]

def test_empty_segments_return_empty_result():
    result = merge_and_format_transcript([], [])

    assert result == {
        "segments": [],
        "text": "",
    }


def test_delayed_speech_and_interruptions_keep_original_timestamps():
    harm_segments = [
        {"start": 33.92, "end": 34.8, "text": "I can check that."},
        {"start": 34.89, "end": 37.25, "text": "Let me finish."},
    ]
    caller_segments = [
        {"start": 23.02, "end": 29.28, "text": "The first caller phrase."},
        {"start": 34.12, "end": 35.8, "text": "One more detail."},
    ]

    result = merge_and_format_transcript(harm_segments, caller_segments)

    # Sort by the original fractional times and keep both overlapping intervals.
    assert result["segments"] == [
        {
            "speaker": "Caller",
            "start": 23.02,
            "end": 29.28,
            "text": "The first caller phrase.",
        },
        {
            "speaker": "Harm",
            "start": 33.92,
            "end": 34.8,
            "text": "I can check that.",
        },
        {
            "speaker": "Caller",
            "start": 34.12,
            "end": 35.8,
            "text": "One more detail.",
        },
        {
            "speaker": "Harm",
            "start": 34.89,
            "end": 37.25,
            "text": "Let me finish.",
        },
    ]
    assert result["text"] == (
        "[00:00:23] Caller: The first caller phrase.\n"
        "[00:00:33] Harm: I can check that.\n"
        "[00:00:34] Caller: One more detail.\n"
        "[00:00:34] Harm: Let me finish."
    )
