def format_timestamp(seconds):
    total_seconds = int(seconds) #convert seconds to hours, minutes and seconds

    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds_left = total_seconds % 60

    return f"{hours:02d}:{minutes:02d}:{seconds_left:02d}" #this creates timestamp such as 00:01:12 (display every number using two digits basically)

def get_start_time(segment):
    return segment["start"] #return the time when this segment starts

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
    for segment in caller_segments:
        labelled_segment = {
            "speaker": "Caller",
            "start": segment["start"],
            "end": segment["end"],
            "text": segment["text"].strip(),
        }    

        all_segments.append(labelled_segment)


    #sort all segments from earliest to latest
    all_segments.sort(key=get_start_time)

    text_lines = []

    
    #create a readable line for every segment
    for segment in all_segments:
        timestamp = format_timestamp(segment["start"])

        line = (
            f"[{timestamp}]"
            f"{segment['speaker']}: "
            f"{segment['text']}"
        )

        text_lines.append(line)

    #put every transcript line on a new line
    plain_text = "\n".join(text_lines)

    #return json data and readable text
    return{
        "segments": all_segments,
        "text": plain_text
    }

