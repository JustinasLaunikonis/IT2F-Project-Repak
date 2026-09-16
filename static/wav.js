function writeText(view, offset, text) {
    for (let characterIndex = 0; characterIndex < text.length; characterIndex++) {
        view.setUint8(offset + characterIndex, text.charCodeAt(characterIndex));
    }
}

// Create a mono, signed 16-bit PCM WAV file from Int16 audio chunks.
export function encodeWav(chunks, sampleRate) {
    let sampleCount = 0;

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        sampleCount += chunks[chunkIndex].length;
    }

    const buffer = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(buffer);

    writeText(view, 0, "RIFF");
    view.setUint32(4, 36 + sampleCount * 2, true);
    writeText(view, 8, "WAVE");
    writeText(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(view, 36, "data");
    view.setUint32(40, sampleCount * 2, true);

    let outputOffset = 44;

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];

        for (let sampleIndex = 0; sampleIndex < chunk.length; sampleIndex++) {
            view.setInt16(outputOffset, chunk[sampleIndex], true);
            outputOffset += 2;
        }
    }

    return buffer;
}
