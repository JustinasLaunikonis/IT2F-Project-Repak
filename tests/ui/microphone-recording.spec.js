const { test, expect } = require("@playwright/test");

test("default recording requests only microphone and releases it after review", async function ({ page }) {
    await page.addInitScript(function () {
        window.stoppedCaptureTracks = [];

        function makeTrack(name) {
            return {
                readyState: "live",
                addEventListener: function (eventName, callback) {
                    if (eventName === "ended") {
                        window.endMicrophone = callback;
                    }
                },
                stop: function () {
                    this.readyState = "ended";
                    window.stoppedCaptureTracks.push(name);
                }
            };
        }

        const microphoneAudio = makeTrack("microphone audio");
        window.displayRequests = 0;
        navigator.mediaDevices.getDisplayMedia = async function () {
            window.displayRequests++;
            throw new Error("Screen sharing must not be requested");
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
        "Recording stopped. Review your microphone audio before downloading. Transcription is not available yet."
    );
    await expect(page.locator("#harm-download")).toHaveAttribute("download", "harm.wav");
    await expect(page.locator("#caller-review")).toBeHidden();
    await expect(page.locator("#harm-download")).toHaveAttribute("href", /^blob:/);
    await expect(page.locator("#caller-download")).not.toHaveAttribute("href");
    await expect(page.locator("#harm-preview")).toHaveAttribute("src", /^blob:/);
    await expect(page.locator("#caller-preview")).not.toHaveAttribute("src");
    await expect(page.locator("#connection-status")).toHaveText("Connection: Not connected");
    await expect(page.locator("#start-button")).toBeEnabled();
    await expect(page.locator("#stop-button")).toBeDisabled();

    const stoppedTracks = await page.evaluate(function () {
        return window.stoppedCaptureTracks;
    });
    expect(stoppedTracks).toEqual(["microphone audio"]);
    const displayRequests = await page.evaluate(function () {
        return window.displayRequests;
    });
    expect(displayRequests).toBe(0);
    const audio = await page.evaluate(async function () {
        const response = await fetch(document.getElementById("harm-download").href);
        const bytes = await response.arrayBuffer();
        const view = new DataView(bytes);
        return {
            channels: view.getUint16(22, true),
            sampleRate: view.getUint32(24, true),
            bitsPerSample: view.getUint16(34, true),
            samples: [view.getInt16(44, true), view.getInt16(46, true)]
        };
    });
    expect(audio).toEqual({ channels: 1, sampleRate: 16000, bitsPerSample: 16, samples: [0, 100] });

    await page.evaluate(function () {
        // A new request represents reconnecting the test microphone.
        const originalRequest = navigator.mediaDevices.getUserMedia;
        navigator.mediaDevices.getUserMedia = async function () {
            const stream = await originalRequest();
            stream.getAudioTracks()[0].readyState = "live";
            return stream;
        };
        navigator.mediaDevices.getDisplayMedia = undefined;
    });
    await page.locator("#start-button").click();
    await expect(page.locator("#activity-status")).toHaveText("Activity: Recording");
    await expect(page.locator("#recording-review")).toBeHidden();
    await expect(page.locator("#include-caller")).toBeDisabled();
    await page.evaluate(function () {
        window.endMicrophone();
    });
    await expect(page.locator("#activity-message")).toHaveText("An audio source disconnected. Review the available recording before downloading.");
    await expect(page.locator("#harm-download")).toHaveAttribute("href", /^blob:/);
    await expect(page.locator("#caller-review")).toBeHidden();
    await expect(page.locator("#start-button")).toBeEnabled();
    await expect(page.locator("#include-caller")).toBeEnabled();
});

test("microphone-only works without display capture support and retries after an empty source", async function ({ page }) {
    await page.addInitScript(function () {
        navigator.mediaDevices.getDisplayMedia = undefined;
        window.stoppedMicrophones = 0;
        navigator.mediaDevices.getUserMedia = async function () {
            return {
                getAudioTracks: function () { return []; },
                getTracks: function () {
                    return [{
                        stop: function () { window.stoppedMicrophones++; }
                    }];
                }
            };
        };
    });
    await page.goto("/");
    for (let attempt = 0; attempt < 2; attempt++) {
        await page.locator("#start-button").click();
        await expect(page.locator("#activity-message")).toHaveText("The selected microphone did not provide audio.");
        await expect(page.locator("#start-button")).toBeEnabled();
        await expect(page.locator("#include-caller")).toBeEnabled();
        await expect(page.locator("#recording-review")).toBeHidden();
    }
    const stopped = await page.evaluate(function () { return window.stoppedMicrophones; });
    expect(stopped).toBe(2);
});
