def format_timestamp(seconds):
    total_seconds = int(seconds) #convert seconds to hours, minutes and seconds

    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds_left = total_seconds % 60

    return f"{hours:02d}:{minutes:02d}:{seconds_left:02d}" #this creates timestamp such as 00:01:12 (display every number using two digits basically)


def merge_and_format_transcript(harm_segments, caller_segments):
    all_segments = []

    #label every microphone segment as Harm
    for segment in harm_segments:
        labelled_segment = {
            "speaker": "Harm",
            "start": segment["start"],
            "end": segment["end"],
            "text": segment["text"].strip(),
        }

        all_segments.append(labelled_segment)


        #label every caller-audio as Caller
        