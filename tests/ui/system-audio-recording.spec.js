const { test, expect } = require("@playwright/test");

test("requests Windows system audio when caller recording is enabled", async function ({
    page,
}) {
    await page.addInitScript(function () {
        window.displayConstraints = null;

        const sharedAudio = {
            readyState: "live",
            addEventListener: function () {},
            stop: function () {
                this.readyState = "ended";
            },
        };

        const microphoneAudio = {
            readyState: "live",
            addEventListener: function () {},
            stop: function () {
                this.readyState = "ended";
            },
        };

        navigator.mediaDevices.enumerateDevices = async function () {
            return [
                {
                    kind: "audioinput",
                    label: "Test microphone",
                    deviceId: "test-microphone",
                },
            ];
        };

        navigator.mediaDevices.getDisplayMedia = async function (constraints) {
            window.displayConstraints = constraints;

            return {
                getAudioTracks: function () {
                    return [sharedAudio];
                },
                getTracks: function () {
                    return [sharedAudio];
                },
            };
        };

        navigator.mediaDevices.getUserMedia = async function (constraints) {
            if (constraints.audio === true) {
                return {
                    getTracks: function () {
                        return [{ stop: function () {} }];
                    },
                };
            }

            return {
                getAudioTracks: function () {
                    return [microphoneAudio];
                },
                getTracks: function () {
                    return [microphoneAudio];
                },
            };
        };

        window.MediaStream = function () {};

        window.AudioContext = function () {
            this.sampleRate = 48000;
            this.state = "running";
            this.destination = {};
            this.audioWorklet = {
                addModule: async function () {},
            };
            this.createMediaStreamSource = function () {
                return {
                    connect: function () {},
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
                    node.port.onmessage({
                        data: { chunk: new Int16Array([0, 100]) },
                    });
                    node.port.onmessage({
                        data: { done: true },
                    });
                },
            };

            this.connect = function () {};
            this.disconnect = function () {};
        };
    });

    await page.goto("/");

    await page.locator("#list-microphones-button").click();
    await page.locator("#microphone-select").selectOption("test-microphone");
    await page.locator("#include-caller").check();
    await page.locator("#start-button").click();

    await expect(page.locator("#activity-status")).toHaveText(
        "Activity: Recording",
    );

    const displayConstraints = await page.evaluate(function () {
        return window.displayConstraints;
    });

    expect(displayConstraints).toEqual({
        audio: true,
        systemAudio: "include",
        video: true,
    });
});
