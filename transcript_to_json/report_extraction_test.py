from transcript_to_json.report_extractor import extract_call_fields_from_transcript
from transcript_to_json.report_schema import to_report_fields


transcript = """
[00:00:01] Harm: Which company are you calling from?
[00:00:04] Caller: Example Packaging.
[00:00:07] Caller: Our machine RP-204 stops after twenty minutes.
[00:00:12] Caller: The display shows E204.
[00:00:16] Caller: We restarted it twice, but the problem returned.
"""

def main():
    extracted = extract_call_fields_from_transcript(transcript)

    print("Validated model output:")
    print(extracted.model_dump_json(indent=2))

    print("\nValues for the Word template:")
    print(to_report_fields(extracted))


if __name__ == "__main__":
    main()
