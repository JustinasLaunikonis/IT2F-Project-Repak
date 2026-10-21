import pytest

import measure_wer


def test_matching_words_have_zero_errors():
    result = measure_wer.calculate_wer(
        "Hello, caller!",
        "hello caller",
    )

    #capitals and punctuation should not count as errors.
    assert result == 0.0


def test_one_wrong_word_out_of_four():
    result = measure_wer.calculate_wer(
        "the machine has stopped",
        "the machine has started",
    )

    #one wrong word out of four means 25% WER.
    assert result == pytest.approx(0.25)


def test_empty_reference_is_rejected():
    with pytest.raises(ValueError, match="reference text"):
        measure_wer.calculate_wer("", "hello")


def create_test_call(tmp_path):
    #pytest provides a temporary folder for the test.
    call_directory = tmp_path / "call-01"
    call_directory.mkdir()

    reference_path = call_directory / "transcript.txt"
    reference_path.write_text(
        "Technician: Hello caller.\n"
        "Operator: Hello Harm.\n",
        encoding="utf-8",
    )

    #fake files are enough because we replace Whisper in the test.
    (call_directory / "harm.wav").write_bytes(b"fake harm audio")
    (call_directory / "caller.wav").write_bytes(b"fake caller audio")

    return call_directory


def test_reports_both_files_and_average(tmp_path, monkeypatch, capsys):
    create_test_call(tmp_path)
    transcribed_files = []

    def fake_transcribe_audio(audio_path):
        transcribed_files.append(audio_path)

        if audio_path.endswith("harm.wav"):
            return "Hello caller"

        #one wrong word compared with "Hello Harm" means 50% WER.
        return "Hello friend"

    #return our example text instead of running the Whisper model.
    monkeypatch.setattr(
        measure_wer,
        "transcribe_audio",
        fake_transcribe_audio,
    )

    results, average_wer = measure_wer.measure_accuracy(tmp_path)

    assert len(transcribed_files) == 2

    assert results == [
        {
            "file": "call-01/harm.wav",
            "wer": 0.0,
        },
        {
            "file": "call-01/caller.wav",
            "wer": 0.5,
        },
    ]

    #the average of 0% and 50% is 25%.
    assert average_wer == pytest.approx(0.25)

    #check the printed results.
    output = capsys.readouterr().out

    assert "call-01/harm.wav: 0.00%" in output
    assert "call-01/caller.wav: 50.00%" in output
    assert "Average WER (per-file mean): 25.00%" in output


def test_missing_recording_is_rejected(tmp_path):
    call_directory = create_test_call(tmp_path)

    #remove only the fake recording created for this test.
    (call_directory / "caller.wav").unlink()

    with pytest.raises(FileNotFoundError, match="caller.wav"):
        measure_wer.load_test_cases(tmp_path)


def test_empty_test_folder_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="No test calls"):
        measure_wer.load_test_cases(tmp_path)