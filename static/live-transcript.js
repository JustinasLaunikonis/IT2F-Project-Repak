// Keep live transcript lines in spoken order. This module has no page or network
// code, so the browser tests can check it directly.

const speakerLabels = { harm: "Harm", caller: "Caller" };

// Same format as format_timestamp in speaker_transcript.py, seconds are truncated.
export function formatTimestamp(seconds) {
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secondsLeft = totalSeconds % 60;

    return [hours, minutes, secondsLeft]
        .map(function (part) {
            return String(part).padStart(2, "0");
        })
        .join(":");
}

// Put an entry after every entry that starts at the same time or earlier.
function insertInOrder(entries, entry) {
    let index = entries.length;
    while (index > 0 && entries[index - 1].start > entry.start) {
        index--;
    }
    entries.splice(index, 0, entry);
}

export function addSegments(entries, segments) {
    for (const segment of segments) {
        const text = segment.text.trim();
        if (text === "") {
            continue;
        }
        insertInOrder(entries, {
            start: segment.start,
            speaker: segment.speaker,
            text: text,
        });
    }
}

// Mark the place of a chunk that could not be transcribed.
export function addFailureMarker(entries, chunk) {
    const speaker = speakerLabels[chunk.speaker];
    const end = chunk.startSeconds + chunk.durationSeconds;

    insertInOrder(entries, {
        start: chunk.startSeconds,
        speaker: speaker,
        text:
            "[Not transcribed: " +
            speaker +
            "'s audio from " +
            formatTimestamp(chunk.startSeconds) +
            " to " +
            formatTimestamp(end) +
            " could not be transcribed. Listen to the recording for this part.]",
        failedChunkId: chunk.id,
    });
}

// Replace the marker of a chunk with its text after a successful retry.
export function replaceFailureMarker(entries, chunkId, segments) {
    const index = entries.findIndex(function (entry) {
        return entry.failedChunkId === chunkId;
    });
    if (index !== -1) {
        entries.splice(index, 1);
    }
    addSegments(entries, segments);
}

export function hasSpokenText(entries) {
    return entries.some(function (entry) {
        return entry.failedChunkId === undefined;
    });
}

export function formatTranscript(entries) {
    return entries
        .map(function (entry) {
            return "[" + formatTimestamp(entry.start) + "] " + entry.speaker + ": " + entry.text;
        })
        .join("\n");
}
