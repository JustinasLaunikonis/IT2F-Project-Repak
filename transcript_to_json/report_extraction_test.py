from transcript_to_json.report_extractor import extract_call_fields_from_transcript
from transcript_to_json.report_schema import to_report_fields


# Fictional call. Details are scattered rather than read out as a form.
# This covers the 28 interpreted fields; dates and manual fields are separate.
transcript = """
[00:00:00] Harm: Repak service, Harm Vermeer speaking. Sorry, I missed the start of that.
[00:00:06] Caller: Aisha Khan here, from Northmere Foods Ltd in Leeds. We've got a pallet waiting and the packing line has been giving us trouble all morning.
[00:00:15] Harm: Is this the installation Westbridge Packaging Services supplied?
[00:00:20] Caller: Yes, they're our distributor. They suggested calling you directly. Their driver is here too, but this isn't about the delivery.
[00:00:30] Caller: Marco Bell, our maintenance technician, is beside me. He's been working on the
[00:00:36] Caller: sealing station. The trays come out with a crooked seal, then the line stops.
[00:00:43] Harm: Which of your two machines are we discussing?
[00:00:47] Caller: RP-7318, the one by the window. RP-7316 by the door is running normally; don't mix those up.
[00:00:57] Harm: Can you still make anything on the window line?
[00:01:01] Caller: We managed some batches earlier between the stops. We've taken that line out of production now. It's stopped while Marco checks it.
[00:01:13] Caller: The first stop was today at 06:10, during the first long run after we changed the film roll. Since then it happens roughly every fifteen to twenty minutes, not on every tray.
[00:01:29] Harm: What does the screen show when it stops?
[00:01:33] Caller: E731. I wrote that down from the display. The temperature reading drops about six degrees just before it happens, although the green heater light stays on.
[00:01:47] Caller: Marco cleaned the jaws and restarted the line twice. Each restart bought us about fifteen minutes, then it stopped again. Cleaning didn't fix the crooked seals either.
[00:02:02] Harm: Were any parts or settings changed before this started?
[00:02:07] Caller: He replaced the jaw's PTFE strip on Tuesday. This morning we increased the speed from 25 to 32 trays a minute. Nobody has installed a software update this week.
[00:02:22] Caller: Marco thinks the temperature probe connection might be loose. That's his suspicion, though; he hasn't checked the wiring yet.
[00:02:33] Harm: Uneven film tension could also explain the crooked seals. A worn heater relay is another possibility for that temperature behaviour. Neither of those is confirmed.
[00:02:47] Caller: Does E731 stay latched until the power is switched off, or should acknowledging it be enough?
[00:02:56] Harm: I can't answer that from memory. We need the controller's firmware version and the event log before going further.
[00:03:06] Caller: I don't have either yet. The cabinet sticker is unreadable. Marco can get the version from the controller, but not while we're talking.
[00:03:17] Harm: I'll ask Sofia van Dijk to handle the engineering side of this case. When she checks the manual, the question is whether E731 on RP-7318 can follow a falling temperature reading while the heater indicator remains green.
[00:03:35] Caller: Good. Please come back to me rather than Marco; he finishes at two. You can reach me on +44 20 7946 0321, or aisha.khan@example.com.
[00:03:49] Harm: You're one hour behind us in the Netherlands, so your two o'clock is our three. That leaves time for Sofia to call.
[00:03:59] Harm: For now, keep that line stopped. Have Marco follow your normal isolation procedure before checking the probe connection. Send us a photo of the alarm screen and the event log once you have it.
[00:04:14] Caller: Okay, that's what we'll do next. We haven't opened the cabinet or sent those pictures yet.
[00:04:22] Caller: One thing I'm less sure about: Marco says the reading dipped before the stop, but I only saw it afterwards. We haven't measured the actual jaw temperature separately, so we don't know whether the display reflects a real drop.
[00:04:40] Harm: Understood. I'll record the observations separately from the possible causes. The other machine is unaffected, and restarting hasn't given you a lasting recovery.
[00:04:51] Caller: Right. Let me know what Sofia finds. I'll stay available on that number.
"""

# These answers are checked afterwards; they are never sent to the model.
expected_values = {
    "machine_number": "RP-7318",
    "customer": "Northmere Foods Ltd",
    "alarm_code": "E731",
    "distributor": "Westbridge Packaging Services",
    "technician": "Marco Bell",
    "contact_person": "Aisha Khan",
    "engineer": "Sofia van Dijk",
    "repak_employee": "Harm Vermeer",
    "machine_status": "stopped",
    "frequency": "occasionally",
}


def main():
    extracted = extract_call_fields_from_transcript(transcript)

    print("Validated model output:")
    print(extracted.model_dump_json(indent=2))

    print("\nValues for the Word template:")
    print(to_report_fields(extracted))

    missing = [
        name for name, value in extracted.model_dump().items()
        if value is None or not value.strip()
    ]
    print("\nMissing interpreted fields:")
    print(", ".join(missing) if missing else "None: all 28 interpreted fields are populated.")

    incorrect = []
    for name, expected in expected_values.items():
        actual = getattr(extracted, name)
        if actual is None or actual.strip().casefold() != expected.casefold():
            incorrect.append(name)
            print(f"{name}: expected {expected!r}, got {actual!r}")

    # Review the remaining summaries for meaning; wording can vary.
    assert not missing and not incorrect, "Extraction needs review; see the results above."


if __name__ == "__main__":
    main()
