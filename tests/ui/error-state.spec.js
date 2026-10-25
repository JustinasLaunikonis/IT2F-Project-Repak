const { test, expect } = require("@playwright/test");

//fake a working microphone so the recording can reach the upload step
function mockMicrophone(options) {
    window.stoppedCaptureTracks = [];
    let microphoneRequests = 0;

    navigator.mediaDevices.enumerateDevices = async function () {
        return [{ kind: "audioinput", label: "Test microphone", deviceId: "test-microphone" }];
    };

    navigator.mediaDevices.getUserMedia = async function () {
        microphoneRequests++;
        //first request comes from listing the microphones
        if (microphoneRequests > 1 && options.recordingError !== null) {
            throw new DOMException("Recording failed", options.recordingError);
        }
        const track = {
            readyState: "live",
            addEventListener: function () {},
            stop: function () {
                this.readyState = "ended";
            }
        };
        return {
            getAudioTracks: function () {
                return [track];
            },
            getTracks: function () {
                return [track];
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
}

async function chooseMicrophone(page) {
    await page.goto("/");
    await page.locator("#list-microphones-button").click();
    await page.locator("#microphone-select").selectOption("test-microphone");
}

async function expectErrorState(page, message) {
    await expect(page.locator("#activity-status")).toHaveText("Activity: Error");
    await expect(page.locator("#activity-status")).toHaveClass("status status-error");
    await expect(page.locator("#activity-message")).toHaveText(message);
    await expect(page.locator("#connection-status")).toHaveText("Connection: Not connected");
    await expect(page.locator("#start-button")).toBeEnabled();
    await expect(page.locator("#stop-button")).toBeDisabled();
}

const startErrors = [
    {
        name: "NotAllowedError",
        message: "Microphone access was denied. Allow microphone access in the browser and press Start again."
    },
    {
        name: "NotFoundError",
        message: "No microphone was found. Connect a microphone and press Start again."
    }
];

for (const startError of startErrors) {
    test("start shows a distinct error for " + startError.name, async function ({ page }) {
        await page.addInitScript(mockMicrophone, { recordingError: startError.name });

        await chooseMicrophone(page);
        await page.locator("#start-button").click();

        await expectErrorState(page, startError.message);
    });
}

const notTranscribedLine =
    "[00:00:00] Harm: [Not transcribed: Harm's audio from 00:00:00 to 00:00:00 could not be transcribed. Listen to the recording for this part.]";

async function expectFinishedWithMissingPart(page) {
    await expect(page.locator("#activity-status")).toHaveText("Activity: Completed");
    await expect(page.locator("#activity-message")).toHaveText(
        "1 part of the recording could not be transcribed and is marked in the transcript. No speech was transcribed. Complete the report manually."
    );
    await expect(page.locator("#transcript")).toHaveValue(notTranscribedLine);
    await expect(page.locator("#connection-status")).toHaveText("Connection: Not connected");
    await expect(page.locator("#start-button")).toBeEnabled();
    await expect(page.locator("#stop-button")).toBeDisabled();
    await expect(page.locator("#harm-download")).toHaveAttribute("href", /^blob:/);
}

test("a failed chunk upload is retried once, then marked in the transcript", async function ({ page }) {
    let chunkUploads = 0;
    await page.route("**/transcribe-chunk", async function (route) {
        chunkUploads++;
        await route.abort("connectionrefused");
    });
    await page.route("**/live/end", route => route.abort("connectionrefused"));
    await page.addInitScript(mockMicrophone, { recordingError: null });

    await chooseMicrophone(page);
    await page.locator("#start-button").click();
    await expect(page.locator("#activity-status")).toHaveText("Activity: Recording");
    await page.locator("#stop-button").click();

    await expectFinishedWithMissingPart(page);
    await expect(page.locator("#live-error")).toHaveText(
        "Harm's audio from 00:00:00 to 00:00:00 could not be transcribed. The audio could not be uploaded. Check that the server is running. The recording continues, and this part is tried again after you stop."
    );
    expect(chunkUploads).toBe(2);
});

test("a server error shows the message returned by the server", async function ({ page }) {
    await page.route("**/transcribe-chunk", async function (route) {
        await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({
                detail: "Transcribing the microphone chunk failed: model file is missing"
            })
        });
    });
    await page.route("**/live/end", route => route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ended: true })
    }));
    await page.addInitScript(mockMicrophone, { recordingError: null });

    await chooseMicrophone(page);
    await page.locator("#start-button").click();
    await expect(page.locator("#activity-status")).toHaveText("Activity: Recording");
    await page.locator("#stop-button").click();

    await expectFinishedWithMissingPart(page);
    await expect(page.locator("#live-error")).toContainText(
        "The server could not transcribe this part (error 500). Transcribing the microphone chunk failed: model file is missing."
    );

    //Start works again and clears the previous call
    await page.locator("#start-button").click();
    await expect(page.locator("#activity-status")).toHaveText("Activity: Recording");
    await expect(page.locator("#live-error")).toBeHidden();
    await expect(page.locator("#transcript")).toHaveValue("");
});
