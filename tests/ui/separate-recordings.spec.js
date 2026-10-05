const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

test("worklet converts 48 kHz input to 16 kHz PCM", function () {
    const workletPath = path.join(__dirname, "../../static/pcm-worklet.js");
    const sourceCode = fs.readFileSync(workletPath, "utf8");
    let recorderClass = null;
    const messages = [];

    class MockAudioWorkletProcessor {
        constructor() {
            this.port = {
                onmessage: null,
                postMessage: function (message) {
                    messages.push(message);
                }
            };
        }
    }

    const globals = {
        AudioWorkletProcessor: MockAudioWorkletProcessor,
        Int16Array: Int16Array,
        sampleRate: 48000,
        registerProcessor: function (name, processorClass) {
            expect(name).toBe("pcm-recorder");
            recorderClass = processorClass;
        }
    };
    vm.runInNewContext(sourceCode, globals);

    const recorder = new recorderClass({ processorOptions: { includeCaller: false } });
    const input = new Float32Array(480);
    for (let sampleIndex = 0; sampleIndex < input.length; sampleIndex++) {
        input[sampleIndex] = 0.5;
    }
    recorder.process([[input]], [[new Float32Array(input.length)]]);
    recorder.port.onmessage({ data: "stop" });

    expect(messages.length).toBe(2);
    expect(messages[0].harmChunk.length).toBe(160);
    expect(messages[0].callerChunk).toBeUndefined();
    for (const sample of messages[0].harmChunk) {
        expect(sample).toBe(16384);
    }
    expect(messages[1].done).toBe(true);
});

test("microphone and caller become separate 16 kHz mono WAV files", async function ({ page }) {
    await page.addInitScript(function () {
        window.captureTracksStopped = [];
        window.recordingNodes = [];
        window.captureGraphEvents = [];

        function makeTrack(name) {
            return {
                readyState: "live",
                addEventListener: function () {},
                stop: function () {
                    this.readyState = "ended";
                    window.captureTracksStopped.push(name);
                }
            };
        }

        const callerTrack = makeTrack("caller");
        const videoTrack = makeTrack("video");
        const microphoneTrack = makeTrack("microphone");

        navigator.mediaDevices.getDisplayMedia = async function () {
            return {
                getAudioTracks: function () {
                    return [callerTrack];
                },
                getTracks: function () {
                    return [callerTrack, videoTrack];
                }
            };
        };
        navigator.mediaDevices.getUserMedia = async function () {
            return {
                getAudioTracks: function () {
                    return [microphoneTrack];
                },
                getTracks: function () {
                    return [microphoneTrack];
                }
            };
        };

        window.MediaStream = function (tracks) {
            this.tracks = tracks;
        };
        window.AudioContext = function (options) {
            this.sampleRate = 16000;
            if (options && options.sampleRate) {
                this.sampleRate = options.sampleRate;
            }
            this.state = "running";
            this.destination = {};
            this.audioWorklet = {
                addModule: async function () {}
            };
            this.createMediaStreamSource = function (stream) {
                return {
                    stream: stream,
                    connect: function (destination, outputIndex, inputIndex) {
                        if (stream.tracks[0] === microphoneTrack) {
                            destination.microphoneInput = inputIndex;
                        } else {
                            destination.callerInput = inputIndex;
                        }
                        window.captureGraphEvents.push("connect input " + inputIndex);
                    },
                    disconnect: function () {}
                };
            };
            this.createGain = function () {
                return {
                    gain: { value: 0 },
                    connect: function (node) {
                        node.sourceName = this.sourceName;
                    }
                };
            };
            this.suspend = async function () {
                this.state = "suspended";
                window.captureGraphEvents.push("suspend");
            };
            this.resume = async function () {
                this.state = "running";
                window.captureGraphEvents.push("resume");
            };
            this.close = async function () {
                this.state = "closed";
            };
        };
        window.AudioWorkletNode = function (context, name, options) {
            const node = this;
            this.options = options;
            this.port = {
                onmessage: null,
                postMessage: function () {
                    node.port.onmessage({ data: {
                        harmChunk: new Int16Array([1100, 1200]),
                        callerChunk: new Int16Array([-2100, -2200])
                    } });
                    node.port.onmessage({ data: { done: true } });
                }
            };
            this.connect = function () {};
            this.disconnect = function () {};
            window.recordingNodes.push(this);
        };
    });

    await page.goto("/");
    const result = await page.evaluate(async function () {
        const recorder = await import("/static/recorder.js");
        await recorder.startWavRecording(undefined, true, "test-microphone");
        const files = await recorder.stopWavRecording();
        const output = {};
        for (const name of ["harm", "caller"]) {
            const blob = files[name];
            if (!blob) {
                output[name] = null;
                continue;
            }
            const bytes = await blob.arrayBuffer();
            const view = new DataView(bytes);
            output[name] = {
                riff: String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)),
                wave: String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)),
                format: view.getUint16(20, true),
                channels: view.getUint16(22, true),
                sampleRate: view.getUint32(24, true),
                bitsPerSample: view.getUint16(34, true),
                dataLength: view.getUint32(40, true),
                samples: [view.getInt16(44, true), view.getInt16(46, true)]
            };
        }
        return {
            output: output,
            stopped: window.captureTracksStopped,
            nodeCount: window.recordingNodes.length,
            nodeOptions: window.recordingNodes[0].options,
            microphoneInput: window.recordingNodes[0].microphoneInput,
            callerInput: window.recordingNodes[0].callerInput,
            graphEvents: window.captureGraphEvents
        };
    });

    expect(result.output.harm).toEqual({
        riff: "RIFF", wave: "WAVE", format: 1, channels: 1,
        sampleRate: 16000, bitsPerSample: 16, dataLength: 4,
        samples: [1100, 1200]
    });
    expect(result.output.caller).toEqual({
        riff: "RIFF", wave: "WAVE", format: 1, channels: 1,
        sampleRate: 16000, bitsPerSample: 16, dataLength: 4,
        samples: [-2100, -2200]
    });
    expect(result.stopped).toEqual(["caller", "video", "microphone"]);
    expect(result.nodeCount).toBe(1);
    expect(result.nodeOptions.numberOfInputs).toBe(2);
    expect(result.nodeOptions.processorOptions.includeCaller).toBe(true);
    expect(result.microphoneInput).toBe(0);
    expect(result.callerInput).toBe(1);
    expect(result.graphEvents).toEqual([
        "suspend", "connect input 0", "connect input 1", "resume"
    ]);
});

test("missing shared audio stops acquired tracks and permits another attempt", async function ({ page }) {
    await page.addInitScript(function () {
        window.stoppedTracks = 0;
        navigator.mediaDevices.getDisplayMedia = async function () {
            return {
                getAudioTracks: function () {
                    return [];
                },
                getTracks: function () {
                    return [{
                        stop: function () {
                            window.stoppedTracks++;
                        }
                    }];
                }
            };
        };
        navigator.mediaDevices.getUserMedia = async function () {
            throw new Error("Microphone should not be requested without shared audio");
        };
    });

    await page.goto("/");
    const result = await page.evaluate(async function () {
        const recorder = await import("/static/recorder.js");
        const errors = [];
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                await recorder.startWavRecording(undefined, true, "test-microphone");
            } catch (error) {
                errors.push(error.message);
            }
        }
        return { errors: errors, stoppedTracks: window.stoppedTracks };
    });

    expect(result.errors).toEqual([
        "The selected screen or tab did not share audio. Enable audio sharing and choose the softphone output.",
        "The selected screen or tab did not share audio. Enable audio sharing and choose the softphone output."
    ]);
    expect(result.stoppedTracks).toBe(2);
});
