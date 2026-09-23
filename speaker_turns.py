def get_start_time(segment):
    return segment["start"]

def add_speaker_to_segments(segments, speaker_name):
    labelled_segment = []


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



    
