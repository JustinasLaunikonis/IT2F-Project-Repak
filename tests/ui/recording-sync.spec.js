const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

test("microphone and caller recordings stay in sync when speech starts at different times", async function ({ page }) {
    await page.addInitScript(function () {
        let tracks = null;

        function makeTracks() {
            if (tracks !== null) {
                return tracks;
            }

            const sourceContext = new AudioContext();
            const startTime = sourceContext.currentTime;

            function makeToneTrack(toneStart) {
                const oscillator = sourceContext.createOscillator();
                const destination = sourceContext.createMediaStreamDestination();
                oscillator.frequency.value = 440;
                oscillator.connect(destination);
                oscillator.start(startTime + toneStart);
                oscillator.stop(startTime + toneStart + 0.5);
                return destination.stream.getAudioTracks()[0];
            }

            tracks = {
                caller: makeToneTrack(0.8),
                harm: makeToneTrack(1.8)
            };
            return tracks;
        }

        navigator.mediaDevices.getUserMedia = async function () {
            return new MediaStream([makeTracks().harm]);
        };
        navigator.mediaDevices.getDisplayMedia = async function () {
            return new MediaStream([makeTracks().caller]);
        };
    });

    await page.goto("/");

    const result = await page.evaluate(async function () {
        const recorder = await import("/static/recorder.js");
        await recorder.startWavRecording(function () {}, true, "test-microphone");
        await new Promise(function (resolve) {
            setTimeout(resolve, 3000);
        });
        const files = await recorder.stopWavRecording();

        async function readWav(file) {
            const view = new DataView(await file.arrayBuffer());
            const headerSize = 44;
            const sampleCount = (view.byteLength - headerSize) / 2;

            // find the first loud sample, which is where the tone starts
            let firstSoundSample = null;
            for (let index = 0; index < sampleCount; index++) {
                if (Math.abs(view.getInt16(headerSize + index * 2, true)) > 3000) {
                    firstSoundSample = index;
                    break;
                }
            }

            return {
                seconds: sampleCount / 16000,
                firstSoundSeconds: firstSoundSample / 16000
            };
        }

        return {
            harm: await readWav(files.harm),
            caller: await readWav(files.caller)
        };
    });

    expect(result.harm.seconds).toBeGreaterThan(2.3);
    expect(Math.abs(result.caller.seconds - result.harm.seconds)).toBeLessThan(0.1);

    const differenceInFiles = result.harm.firstSoundSeconds - result.caller.firstSoundSeconds;
    expect(differenceInFiles).toBeGreaterThan(0.9);
    expect(differenceInFiles).toBeLessThan(1.1);
});

test("worklet records silence for audio blocks without input", function () {
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

    vm.runInNewContext(sourceCode, {
        AudioWorkletProcessor: MockAudioWorkletProcessor,
        Int16Array: Int16Array,
        sampleRate: 48000,
        registerProcessor: function (name, processorClass) {
            recorderClass = processorClass;
        }
    });

    const recorder = new recorderClass();
    recorder.process([[]]);
    recorder.process([]);
    recorder.port.onmessage({ data: "stop" });

    expect(messages[0].chunk.length).toBe(86);
    for (const sample of messages[0].chunk) {
        expect(sample).toBe(0);
    }
    expect(messages[1].done).toBe(true);
});
