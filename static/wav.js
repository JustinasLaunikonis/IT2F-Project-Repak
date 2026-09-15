// Mono, signed 16-bit little-endian PCM in a standard RIFF/WAVE container.
export function encodeWav(chunks, sampleRate) {
    const samples = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const writeText = (offset, text) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    writeText(0, "RIFF");
    view.setUint32(4, 36 + samples * 2, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, samples * 2, true);
    let offset = 44;
    for (const chunk of chunks) {
        for (const sample of chunk) {
            const value = Math.max(-1, Math.min(1, sample));
            view.setInt16(offset, Math.round(value * (value < 0 ? 32768 : 32767)), true);
            offset += 2;
        }
    }
    return buffer;
}
