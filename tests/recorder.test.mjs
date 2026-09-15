import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const wavSource = readFileSync(new URL("../static/wav.js", import.meta.url), "utf8");
const { encodeWav } = await import(`data:text/javascript;base64,${Buffer.from(wavSource).toString("base64")}`);

test("WAV header and signed PCM preserve chunk order and clamp overflow", () => {
    const buffer = encodeWav([new Float32Array([-2, -0.5, 0]), new Float32Array([0.5, 2])], 48000);
    const bytes = Buffer.from(buffer);
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.readUInt32LE(4), buffer.byteLength - 8);
    assert.equal(bytes.toString("ascii", 8, 16), "WAVEfmt ");
    assert.equal(bytes.readUInt32LE(16), 16);
    assert.equal(bytes.readUInt16LE(20), 1);
    assert.equal(bytes.readUInt16LE(22), 1);
    assert.equal(bytes.readUInt32LE(24), 48000);
    assert.equal(bytes.readUInt32LE(28), 96000);
    assert.equal(bytes.readUInt16LE(32), 2);
    assert.equal(bytes.readUInt16LE(34), 16);
    assert.equal(bytes.toString("ascii", 36, 40), "data");
    assert.equal(bytes.readUInt32LE(40), 10);
    assert.deepEqual(Array.from({ length: 5 }, (_, i) => bytes.readInt16LE(44 + i * 2)), [-32768, -16384, 0, 16384, 32767]);
});

function worklet(sampleRate = 48000) {
    let Recorder;
    const messages = [];
    vm.runInNewContext(readFileSync(new URL("../static/pcm-worklet.js", import.meta.url), "utf8"), {
        AudioWorkletProcessor: class { port = { postMessage: message => messages.push(message) }; },
        registerProcessor: (_, processor) => { Recorder = processor; },
        sampleRate,
        Float32Array,
    });
    return { recorder: new Recorder(), messages };
}

test("stop flushes the partial buffer exactly once, before acknowledgement", () => {
    const { recorder, messages } = worklet();
    const samples = Float32Array.from({ length: 4200 }, (_, i) => i / 4200);
    recorder.process([[samples]]);
    recorder.port.onmessage({ data: "stop" });
    recorder.port.onmessage({ data: "stop" });
    assert.equal(messages.length, 3);
    assert.equal(messages[0].chunk.length, 4096);
    assert.equal(messages[1].chunk.length, 104);
    assert.equal(messages[2].done, true);
    assert.deepEqual([...messages[0].chunk, ...messages[1].chunk], [...samples]);
    assert.equal(recorder.process([[samples]]), false);
});

test("duration limit flushes audio and finishes automatically", () => {
    const { recorder, messages } = worklet(1);
    assert.equal(recorder.process([[new Float32Array(2000)]]), false);
    assert.equal(messages[0].chunk.length, 1800);
    assert.equal(messages[1].done, true);
});
