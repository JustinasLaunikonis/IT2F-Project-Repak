const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Run the actual processor with known samples, without a microphone or Whisper.
function createTestRecorder(inputSampleRate, includeCaller) {
    const workletPath = path.join(__dirname, "../../static/pcm-worklet.js");
    const sourceCode = fs.readFileSync(workletPath, "utf8");
    const messages = [];
    let recorderClass = null;

    class TestAudioWorkletProcessor {
        constructor() {
            this.port = {
                onmessage: null,
                postMessage: function (message) {
                    messages.push(message);
                }
            };
        }
    }

    vm.runInNewContext(sourceCode, {
        AudioWorkletProcessor: TestAudioWorkletProcessor,
        Int16Array: Int16Array,
        sampleRate: inputSampleRate,
        registerProcessor: function (name, processorClass) {
            recorderClass = processorClass;
        }
    });

    const recorder = new recorderClass({
        processorOptions: { includeCaller: includeCaller }
    });
    return { recorder: recorder, messages: messages };
}

function constantSamples(length, value) {
    const samples = new Float32Array(length);
    samples.fill(value);
    return samples;
}

function collectChannel(messages, name) {
    const samples = [];
    for (const message of messages) {
        if (message[name]) {
            for (const sample of message[name]) {
                samples.push(sample);
            }
        }
    }
    return samples;
}

function doneMessages(messages) {
    let count = 0;
    for (const message of messages) {
        if (message.done) {
            count++;
        }
    }
    return count;
}

for (const inputSampleRate of [44100, 48000]) {
    test("shared timeline preserves delays, missing input and overlap at " + inputSampleRate + " Hz", function () {
        const recording = createTestRecorder(inputSampleRate, true);
        const blockLength = inputSampleRate / 10;
        const output = [[new Float32Array(blockLength)]];
        const harm = constantSamples(blockLength, 0.5);
        const caller = constantSamples(blockLength, -0.5);

        // Each block represents 100 ms. Empty input means an absent audio source.
        recording.recorder.process([[], []], output);
        recording.recorder.process([[harm], []], output);
        recording.recorder.process([[harm], [caller]], output);
        recording.recorder.process([[], [caller]], output);
        recording.recorder.process([[], []], output);
        recording.recorder.process([[harm], [caller]], output);
        recording.recorder.port.onmessage({ data: "stop" });

        const harmSamples = collectChannel(recording.messages, "harmChunk");
        const callerSamples = collectChannel(recording.messages, "callerChunk");
        expect(harmSamples.length).toBe(9600);
        expect(callerSamples.length).toBe(harmSamples.length);

        const harmValues = [0, 16384, 16384, 0, 0, 16384];
        const callerValues = [0, 0, -16384, -16384, 0, -16384];
        for (let blockIndex = 0; blockIndex < harmValues.length; blockIndex++) {
            // Check every output sample, including silence and resampling boundaries.
            const start = blockIndex * 1600;
            const end = start + 1600;
            expect(harmSamples.slice(start, end)).toEqual(new Array(1600).fill(harmValues[blockIndex]));
            expect(callerSamples.slice(start, end)).toEqual(new Array(1600).fill(callerValues[blockIndex]));
        }
        expect(doneMessages(recording.messages)).toBe(1);
    });
}

test("both files keep a final partial resampling frame and stop together", function () {
    const recording = createTestRecorder(48000, true);
    const harm = constantSamples(128, 0.5);
    const caller = constantSamples(128, -0.5);
    const output = [[new Float32Array(128)]];
    recording.recorder.process([[harm], [caller]], output);
    recording.recorder.port.onmessage({ data: "stop" });
    recording.recorder.port.onmessage({ data: "stop" });

    const harmSamples = collectChannel(recording.messages, "harmChunk");
    const callerSamples = collectChannel(recording.messages, "callerChunk");
    expect(harmSamples.length).toBe(43);
    expect(callerSamples.length).toBe(43);
    expect(harmSamples[42]).toBe(16384);
    expect(callerSamples[42]).toBe(-16384);
    expect(doneMessages(recording.messages)).toBe(1);
    expect(recording.recorder.process([[harm], [caller]], output)).toBe(false);
    expect(collectChannel(recording.messages, "harmChunk").length).toBe(43);
});

test("microphone-only recording preserves absent input as silence", function () {
    const recording = createTestRecorder(16000, false);
    const output = [[new Float32Array(17)]];
    recording.recorder.process([[]], output);
    recording.recorder.port.onmessage({ data: "stop" });

    expect(collectChannel(recording.messages, "harmChunk")).toEqual(new Array(17).fill(0));
    expect(collectChannel(recording.messages, "callerChunk")).toEqual([]);
    expect(doneMessages(recording.messages)).toBe(1);
});

test("the existing 120-minute limit finishes both channels on the same frame", function () {
    const recording = createTestRecorder(48000, true);
    // Start eight frames before the cap, so the test does not need two hours of audio.
    recording.recorder.frames = 48000 * 120 * 60 - 8;
    const output = [[new Float32Array(128)]];
    const active = recording.recorder.process([[], []], output);

    expect(active).toBe(false);
    expect(recording.recorder.frames).toBe(48000 * 120 * 60);
    expect(collectChannel(recording.messages, "harmChunk")).toEqual([0, 0, 0]);
    expect(collectChannel(recording.messages, "callerChunk")).toEqual([0, 0, 0]);
    expect(doneMessages(recording.messages)).toBe(1);
});

for (const inputSampleRate of [44100, 48000]) {
    test("Chromium keeps two scheduled audio sources aligned at " + inputSampleRate + " Hz", async function ({ page }) {
        await page.goto("/");
        const result = await page.evaluate(async function (rate) {
            const context = new OfflineAudioContext(1, rate * 2, rate);
            await context.audioWorklet.addModule("/static/pcm-worklet.js");
            const node = new AudioWorkletNode(context, "pcm-recorder", {
                numberOfInputs: 2,
                numberOfOutputs: 1,
                outputChannelCount: [1],
                channelCount: 1,
                channelCountMode: "explicit",
                processorOptions: { includeCaller: true }
            });

            const harmChunks = [];
            const callerChunks = [];
            const finished = new Promise(function (resolve) {
                node.port.onmessage = function (event) {
                    if (event.data.harmChunk) {
                        harmChunks.push(event.data.harmChunk);
                        callerChunks.push(event.data.callerChunk);
                    }
                    if (event.data.done) {
                        resolve();
                    }
                };
            });

            function scheduleSound(inputIndex, startTime, value) {
                const buffer = context.createBuffer(1, rate / 2, rate);
                buffer.getChannelData(0).fill(value);
                const source = context.createBufferSource();
                source.buffer = buffer;
                source.connect(node, 0, inputIndex);
                source.start(startTime);
            }

            // Distinct starts, interruptions, overlap and silence use actual browser audio.
            scheduleSound(0, 0.125, 0.25);
            scheduleSound(1, 0.375, -0.5);
            scheduleSound(0, 1.125, 0.25);
            scheduleSound(1, 1.375, -0.5);
            node.connect(context.destination);
            const silentOutput = await context.startRendering();
            node.port.postMessage("stop");
            await finished;

            const wav = await import("/static/wav.js");
            const harmView = new DataView(wav.encodeWav(harmChunks, 16000));
            const callerView = new DataView(wav.encodeWav(callerChunks, 16000));
            const harmFrames = harmView.getUint32(40, true) / 2;
            const callerFrames = callerView.getUint32(40, true) / 2;

            function sampleAt(view, seconds) {
                return view.getInt16(44 + Math.floor(seconds * 16000) * 2, true);
            }

            const checkpoints = [0.05, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 1.95];
            const harmSamples = [];
            const callerSamples = [];
            for (const time of checkpoints) {
                harmSamples.push(sampleAt(harmView, time));
                callerSamples.push(sampleAt(callerView, time));
            }

            let outputStayedSilent = true;
            for (const sample of silentOutput.getChannelData(0)) {
                if (sample !== 0) {
                    outputStayedSilent = false;
                }
            }

            return {
                harmFrames: harmFrames,
                callerFrames: callerFrames,
                harmSamples: harmSamples,
                callerSamples: callerSamples,
                outputStayedSilent: outputStayedSilent
            };
        }, inputSampleRate);

        expect(result.harmFrames).toBe(result.callerFrames);
        // Offline rendering can finish its last 128-frame block past the requested length.
        expect(result.harmFrames).toBeGreaterThanOrEqual(32000);
        expect(result.harmFrames).toBeLessThanOrEqual(32047);
        expect(result.harmSamples).toEqual([0, 8192, 8192, 0, 0, 8192, 8192, 0, 0]);
        expect(result.callerSamples).toEqual([0, 0, -16384, -16384, 0, 0, -16384, -16384, 0]);
        expect(result.outputStayedSilent).toBe(true);
    });
}
