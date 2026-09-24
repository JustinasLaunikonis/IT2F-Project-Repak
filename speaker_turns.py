import json


def get_start_time(segment):
    return segment["start"]


def add_speaker_to_segments(segments, speaker_name):
    labelled_segments = []

    for segment in segments:
        labelled_segment = {
            "speaker": speaker_name,
            "start": segment["start"],
            "end": segment["end"],
            "text": segment["text"]
        }

        labelled_segments.append(labelled_segment)

    return labelled_segments


def merge_channels(channel_one, channel_two):
    combined_segments = []

    channel_one_segments = add_speaker_to_segments(
        channel_one,
        "speaker_1"
    )

    channel_two_segments = add_speaker_to_segments(
        channel_two,
        "speaker_2"
    )

    for segment in channel_one_segments:
        combined_segments.append(segment)

    for segment in channel_two_segments:
        combined_segments.append(segment)

    combined_segments.sort(key=get_start_time)

    speaker_turns = []

    for segment in combined_segments:
        if len(speaker_turns) == 0:
            speaker_turns.append(segment)
        else:
            previous_turn = speaker_turns[-1]

            if previous_turn["speaker"] == segment["speaker"]:
                previous_turn["text"] = (
                    previous_turn["text"]
                    + " "
                    + segment["text"]
                )

                if segment["end"] > previous_turn["end"]:
                    previous_turn["end"] = segment["end"]
            else:
                speaker_turns.append(segment)

    return speaker_turns


def save_speaker_turns(speaker_turns, output_file_name):
    with open(output_file_name, "w", encoding="utf-8") as output_file:
        json.dump(
            speaker_turns,
            output_file,
            indent=4,
            ensure_ascii=False
        )