const { test, expect } = require("@playwright/test");

test("stopping capture closes every track without claiming transcription", async function ({ page }) {
    await page.addInitScript(function () {
        window.stoppedCaptureTracks = [];

        function makeTrack(name) {
            return {
                readyState: "live",
                addEventListener: function () {},
                stop: function () {
                    this.readyState = "ended";
                    window.stoppedCaptureTracks.push(name);
                }
            };
        }

        const sharedAudio = makeTrack("shared audio");
        const sharedVideo = makeTrack("shared video");
        const microphoneAudio = makeTrack("microphone audio");

        navigator.mediaDevices.getDisplayMedia = async function () {
            return {
                getAudioTracks: function () {
                    return [sharedAudio];
                },
                getTracks: function () {
                    return [sharedAudio, sharedVideo];
                }
            };
        };

        navigator.mediaDevices.getUserMedia = async function () {
            return {
                getAudioTracks: function () {
                    return [microphoneAudio];
                },
                getTracks: function () {
                    return [microphoneAudio];
                }
            };
        };

        window.MediaStream = function () {};

        window.AudioContext = function () {
            this.sampleRate = 48000;
            this.state = "running";
            this.destination = {};
            this.audioWorklet = {
                addModule: async function () {}
            };
            this.createMediaStreamSource = function () {
                return {
                    connect: function () {}
                };
            };
            this.createGain = function () {
                return {
                    gain: { value: 0 },
                    connect: function () {}
                };
            };
            this.resume = async function () {};
            this.close = async function () {
                this.state = "closed";
            };
        };

        window.AudioWorkletNode = function () {
            const node = this;
            this.port = {
                onmessage: null,
                postMessage: function () {
                    node.port.onmessage({ data: { chunk: new Int16Array([0, 100]) } });
                    node.port.onmessage({ data: { done: true } });
                }
            };
            this.connect = function () {};
            this.disconnect = function () {};
        };
    });

    await page.goto("/");
    await page.locator("#start-button").click();

    await expect(page.locator("#activity-status")).toHaveText("Activity: Recording");
    await expect(page.locator("#stop-button")).toBeEnabled();

    await page.locator("#stop-button").click();

    await expect(page.locator("#activity-status")).toHaveText("Activity: Idle");
    await expect(page.locator("#activity-message")).toHaveText(
        "Recording stopped. Transcription is not available yet."
    );
    await expect(page.locator("#connection-status")).toHaveText("Connection: Not connected");
    await expect(page.locator("#start-button")).toBeEnabled();
    await expect(page.locator("#stop-button")).toBeDisabled();

    const stoppedTracks = await page.evaluate(function () {
        return window.stoppedCaptureTracks;
    });
    expect(stoppedTracks).toEqual(["shared audio", "shared video", "microphone audio"]);
});
