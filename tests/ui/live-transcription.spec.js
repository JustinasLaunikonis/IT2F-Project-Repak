const { test, expect } = require("@playwright/test");

// The fake worklet sends one 4096-sample block (256 ms at 16 kHz) every 256 ms.
// page.clock moves time forward, so a 5 second chunk does not take 5 real seconds.
const blockSeconds = 4096 / 16000;

function fakeAudioDevices() {
    window.displayRequests = 0;

    function makeTrack() {
        return {
            readyState: "live",
            addEventListener: function () {},
            stop: function () {
                this.readyState = "ended";
            }
        };
    }

    function makeStream(track) {
        return {
            getAudioTracks: function () {
                return [track];
            },
            getTracks: function () {
                return [track];
            }
        };
    }

    navigator.mediaDevices.enumerateDevices = async function () {
        return [{ kind: "audioinput", label: "Test microphone", deviceId: "test-microphone" }];
    };
    navigator.mediaDevices.getUserMedia = async function () {
        return makeStream(makeTrack());
    };
    navigator.mediaDevices.getDisplayMedia = async function () {
        window.displayRequests++;
        return makeStream(makeTrack());
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
        const timer = setInterval(function () {
            node.port.onmessage({ data: { chunk: new Int16Array(4096).fill(1000) } });
        }, 256);
        this.port = {
            onmessage: null,
            postMessage: function (message) {
                if (message === "stop") {
                    clearInterval(timer);
                    node.port.onmessage({ data: { chunk: new Int16Array(160).fill(1000) } });
                    node.port.onmessage({ data: { done: true } });
                }
            }
        };
        this.connect = function () {};
        this.disconnect = function () {};
    };
}

function readFormField(request, name) {
    const body = request.postDataBuffer().toString("latin1");
    const match = body.match(new RegExp('name="' + name + '"\\r\\n\\r\\n([^\\r]*)'));
    return match ? match[1] : null;
}

// Answers chunk uploads like the server: one segment per chunk, shifted by start_seconds.
async function mockServer(page, options = {}) {
    const server = {
        chunks: [],
        liveEnds: 0,
        reports: [],
        attempts: {}
    };

    await page.route("**/transcribe-chunk", async function (route) {
        const speaker = readFormField(route.request(), "speaker");
        const startSeconds = Number(readFormField(route.request(), "start_seconds"));
        const key = speaker + "@" + startSeconds.toFixed(3);
        server.attempts[key] = (server.attempts[key] || 0) + 1;
        server.chunks.push({ speaker: speaker, startSeconds: startSeconds });
        const number = server.chunks.filter(chunk => chunk.speaker === speaker).length;

        if (options.hold) {
            await options.hold;
        }
        if (options.shouldFail && options.shouldFail(speaker, startSeconds, server.attempts[key])) {
            await route.fulfill({
                status: 500,
                contentType: "application/json",
                body: JSON.stringify({ detail: "Transcribing the microphone chunk failed: GPU busy" })
            });
            return;
        }

        const label = speaker === "harm" ? "Harm" : "Caller";
        await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
                segments: [{
                    speaker: label,
                    start: startSeconds + 0.5,
                    end: startSeconds + 1,
                    text: speaker + " text " + number
                }],
                language: "en",
                model: "small",
                device: "cpu"
            })
        });
    });
    await page.route("**/live/end", async function (route) {
        server.liveEnds++;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ended: true }) });
    });
    await page.route("**/extract-report", async function (route) {
        server.reports.push(route.request().postDataJSON().transcript);
        await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ fields: {}, warning: null })
        });
    });
    return server;
}

async function startRecording(page, includeCaller) {
    await page.clock.install();
    await page.addInitScript(fakeAudioDevices);
    await page.goto("/");
    await page.locator("#list-microphones-button").click();
    await page.locator("#microphone-select").selectOption("test-microphone");
    if (includeCaller) {
        await page.locator("#include-caller").check();
    }
    await page.locator("#start-button").click();
    await expect(page.locator("#activity-status")).toHaveText("Activity: Recording");
}

async function expectStillRecording(page) {
    await expect(page.locator("#activity-status")).toHaveText("Activity: Recording");
    await expect(page.locator("#stop-button")).toBeEnabled();
    await expect(page.locator("#connection-status")).toHaveText("Connection: Connected");
}

test("the page says the live transcript can have a short delay", async function ({ page }) {
    await page.goto("/");

    await expect(page.locator("label[for=transcript]")).toHaveText("Call transcript (live)");
    await expect(page.locator("#live-delay-notice")).toContainText("New text can take a few seconds to appear");
});

test("Harm and caller text appears while recording and the rest is added after Stop", async function ({ page }) {
    const server = await mockServer(page);
    await startRecording(page, true);

    // Nothing is sent before the first 5 seconds have passed.
    await page.clock.runFor(4000);
    expect(server.chunks).toEqual([]);

    await page.clock.runFor(1000);
    await expect(page.locator("#transcript")).toHaveValue(
        "[00:00:00] Harm: harm text 1\n[00:00:00] Caller: caller text 1"
    );
    await expectStillRecording(page);
    await expect(page.locator("#transcription-info")).toHaveText(
        "Transcription Model Info: Harm: CPU, Size: Small | Caller: CPU, Size: Small"
    );

    await page.clock.runFor(5000);
    await expect(page.locator("#transcript")).toHaveValue([
        "[00:00:00] Harm: harm text 1",
        "[00:00:00] Caller: caller text 1",
        "[00:00:05] Harm: harm text 2",
        "[00:00:05] Caller: caller text 2"
    ].join("\n"));
    await expectStillRecording(page);

    await page.locator("#stop-button").click();
    await expect(page.locator("#activity-status")).toHaveText("Activity: Completed");
    await expect(page.locator("#activity-message")).toHaveText(
        "Call processed. Fill in any remaining details, then click Generate."
    );

    // Start times come from counted samples: 19 blocks after 5 s, 39 blocks after 10 s.
    expect(server.chunks).toEqual([
        { speaker: "harm", startSeconds: 0 },
        { speaker: "caller", startSeconds: 0 },
        { speaker: "harm", startSeconds: 19 * blockSeconds },
        { speaker: "caller", startSeconds: 19 * blockSeconds },
        { speaker: "harm", startSeconds: 39 * blockSeconds },
        { speaker: "caller", startSeconds: 39 * blockSeconds }
    ]);
    const finalTranscript = [
        "[00:00:00] Harm: harm text 1",
        "[00:00:00] Caller: caller text 1",
        "[00:00:05] Harm: harm text 2",
        "[00:00:05] Caller: caller text 2",
        "[00:00:10] Harm: harm text 3",
        "[00:00:10] Caller: caller text 3"
    ].join("\n");
    await expect(page.locator("#transcript")).toHaveValue(finalTranscript);
    expect(server.reports).toEqual([finalTranscript]);
    expect(server.liveEnds).toBe(1);
    await expect(page.locator("#harm-download")).toHaveAttribute("href", /^blob:/);
    await expect(page.locator("#caller-download")).toHaveAttribute("href", /^blob:/);

    // Stop prevents new chunks, even when time keeps passing.
    await page.clock.runFor(20000);
    expect(server.chunks.length).toBe(6);
});

test("microphone-only recording sends only Harm's audio", async function ({ page }) {
    const server = await mockServer(page);
    await startRecording(page, false);

    await page.clock.runFor(5000);
    await expect(page.locator("#transcript")).toHaveValue("[00:00:00] Harm: harm text 1");
    await page.locator("#stop-button").click();
    await expect(page.locator("#activity-status")).toHaveText("Activity: Completed");

    expect(server.chunks.map(chunk => chunk.speaker)).toEqual(["harm", "harm"]);
    await expect(page.locator("#transcript")).toHaveValue(
        "[00:00:00] Harm: harm text 1\n[00:00:05] Harm: harm text 2"
    );
    await expect(page.locator("#transcription-info")).toHaveText("Transcription Model Info: CPU, Size: Small");
    await expect(page.locator("#caller-review")).toBeHidden();
    expect(await page.evaluate(() => window.displayRequests)).toBe(0);
});

test("a failed chunk keeps earlier text, recording continues, and the retry at Stop fills the gap", async function ({ page }) {
    const server = await mockServer(page, {
        shouldFail: function (speaker, startSeconds, attempt) {
            return speaker === "harm" && startSeconds > 4 && startSeconds < 5 && attempt === 1;
        }
    });
    await startRecording(page, false);

    await page.clock.runFor(5000);
    await expect(page.locator("#transcript")).toHaveValue("[00:00:00] Harm: harm text 1");

    await page.clock.runFor(5000);
    await expect(page.locator("#transcript")).toHaveValue(
        "[00:00:00] Harm: harm text 1\n" +
        "[00:00:04] Harm: [Not transcribed: Harm's audio from 00:00:04 to 00:00:09 could not be transcribed. Listen to the recording for this part.]"
    );
    await expect(page.locator("#live-error")).toHaveText(
        "Harm's audio from 00:00:04 to 00:00:09 could not be transcribed. " +
        "The server could not transcribe this part (error 500). Transcribing the microphone chunk failed: GPU busy. " +
        "The recording continues, and this part is tried again after you stop."
    );
    await expectStillRecording(page);

    // Later chunks keep working after the failure.
    await page.clock.runFor(5000);
    await expect(page.locator("#transcript")).toHaveValue(/\[00:00:10\] Harm: harm text 3$/);
    await expectStillRecording(page);

    await page.locator("#stop-button").click();
    await expect(page.locator("#activity-status")).toHaveText("Activity: Completed");
    await expect(page.locator("#transcript")).toHaveValue([
        "[00:00:00] Harm: harm text 1",
        "[00:00:05] Harm: harm text 5",
        "[00:00:10] Harm: harm text 3",
        "[00:00:15] Harm: harm text 4"
    ].join("\n"));
    await expect(page.locator("#live-error")).toBeHidden();
    await expect(page.locator("#activity-message")).toHaveText(
        "Call processed. Fill in any remaining details, then click Generate."
    );
    expect(server.attempts["harm@" + (19 * blockSeconds).toFixed(3)]).toBe(2);
});

test("a chunk that also fails on retry stays marked in the transcript and the report", async function ({ page }) {
    const server = await mockServer(page, {
        shouldFail: function (speaker, startSeconds) {
            return speaker === "caller" && startSeconds === 0;
        }
    });
    await startRecording(page, true);

    await page.clock.runFor(5000);
    await expect(page.locator("#live-error")).toBeVisible();
    await page.locator("#stop-button").click();
    await expect(page.locator("#activity-status")).toHaveText("Activity: Completed");

    const marker =
        "[00:00:00] Caller: [Not transcribed: Caller's audio from 00:00:00 to 00:00:04 could not be transcribed. Listen to the recording for this part.]";
    //the marker starts at 0.0 s, before Harm's first words at 0.5 s
    await expect(page.locator("#transcript")).toHaveValue([
        marker,
        "[00:00:00] Harm: harm text 1",
        "[00:00:05] Harm: harm text 2",
        "[00:00:05] Caller: caller text 2"
    ].join("\n"));
    await expect(page.locator("#live-error")).toBeVisible();
    await expect(page.locator("#activity-message")).toHaveText(
        "1 part of the recording could not be transcribed and is marked in the transcript. " +
        "Call processed. Fill in any remaining details, then click Generate."
    );
    expect(server.attempts["caller@0.000"]).toBe(2);
    expect(server.reports[0]).toContain(marker);
});

test("a hint appears when the live transcript falls behind", async function ({ page }) {
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    const server = await mockServer(page, { hold: hold });
    await startRecording(page, false);

    await page.clock.runFor(10000);
    await expect.poll(() => server.chunks.length).toBe(1);
    await expect(page.locator("#live-lag")).toBeHidden();

    // The first chunk is still being transcribed while 20 seconds were recorded.
    await page.clock.runFor(10000);
    await expect(page.locator("#live-lag")).toHaveText("The live transcript is about 20 seconds behind the recording.");
    await expectStillRecording(page);

    release();
    await expect(page.locator("#transcript")).toHaveValue(/harm text 4$/);
    await expect(page.locator("#live-lag")).toBeHidden();
});

test("live transcript lines are merged in spoken order", async function ({ page }) {
    await page.goto("/");

    const result = await page.evaluate(async function () {
        const live = await import("/static/live-transcript.js");
        const entries = [];

        live.addSegments(entries, [{ speaker: "Harm", start: 5.2, end: 6, text: " second " }]);
        live.addSegments(entries, [
            { speaker: "Caller", start: 1.9, end: 3, text: "first" },
            { speaker: "Caller", start: 5.2, end: 6, text: "same time, added later" },
            { speaker: "Caller", start: 7, end: 8, text: "   " }
        ]);
        live.addFailureMarker(entries, { id: 7, speaker: "harm", startSeconds: 3725.9, durationSeconds: 5 });
        const withMarker = live.formatTranscript(entries);
        const onlyMarker = live.hasSpokenText([entries[entries.length - 1]]);

        live.replaceFailureMarker(entries, 7, [{ speaker: "Harm", start: 3726, end: 3727, text: "recovered" }]);

        return {
            withMarker: withMarker,
            replaced: live.formatTranscript(entries),
            onlyMarker: onlyMarker,
            spoken: live.hasSpokenText(entries)
        };
    });

    expect(result.withMarker).toBe([
        "[00:00:01] Caller: first",
        "[00:00:05] Harm: second",
        "[00:00:05] Caller: same time, added later",
        "[01:02:05] Harm: [Not transcribed: Harm's audio from 01:02:05 to 01:02:10 could not be transcribed. Listen to the recording for this part.]"
    ].join("\n"));
    expect(result.replaced).toBe([
        "[00:00:01] Caller: first",
        "[00:00:05] Harm: second",
        "[00:00:05] Caller: same time, added later",
        "[01:02:06] Harm: recovered"
    ].join("\n"));
    expect(result.onlyMarker).toBe(false);
    expect(result.spoken).toBe(true);
});
