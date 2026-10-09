const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const transcriptionFixture = require("./fixtures/transcribe.json");

test.use({
    permissions: ["microphone"],
    launchOptions: {
        args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
    }
});

test("record a fake microphone, review its transcript, and export a Word report", async function recordAndExportWordReport(
    { page },
    testInfo
) {
    // 1. Use a known transcript instead of running the speech recognition model.
    const expectedTranscript = transcriptionFixture.text;
    const transcriptWithoutWhitespace = expectedTranscript.trim();
    expect(transcriptWithoutWhitespace.length).toBeGreaterThan(0);

    await page.route("**/transcribe", async function answerTranscriptionRequest(route) {
        const request = route.request();
        if (request.method() !== "POST") {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            path: path.join(__dirname, "fixtures", "transcribe.json")
        });
    });

    // Skip the report LLM
    await page.route("**/extract-report", async function answerExtractionRequest(route) {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ fields: {} })
        });
    });

    await page.addInitScript(observeRealMicrophoneChunks);

    // 2. Choose the fake microphone
    await page.goto("/");
    await page.locator("#list-microphones-button").click();
    const microphoneSelect = page.locator("#microphone-select");
    await expect(microphoneSelect).toBeEnabled();

    // Option 0 is the placeholder
    // Option 1 is the first actual microphone
    const firstMicrophoneOption = page.locator("#microphone-select option").nth(1);
    await expect(firstMicrophoneOption).toHaveAttribute("value", /.+/);
    const microphoneId = await firstMicrophoneOption.getAttribute("value");
    expect(microphoneId).not.toBeNull();
    expect(microphoneId).not.toBe("");
    await microphoneSelect.selectOption(microphoneId);

    // 3. Record, then stop and check the transcript
    await page.locator("#start-button").click();
    await expect(page.locator("#activity-status")).toHaveText("Activity: Recording");
    await expect(page.locator("#stop-button")).toBeEnabled();
    await page.waitForFunction(function hasReceivedMicrophoneAudio() {
        return window.recordedMicrophoneChunk === true;
    });

    const transcriptionRequestPromise = page.waitForRequest(function isTranscriptionUpload(request) {
        return request.url().endsWith("/transcribe") && request.method() === "POST";
    });
    await page.locator("#stop-button").click();
    const transcriptionRequest = await transcriptionRequestPromise;
    const transcriptionHeaders = transcriptionRequest.headers();
    expect(transcriptionHeaders["content-type"]).toContain("multipart/form-data");
    await expect(page.locator("#activity-status")).toHaveText("Activity: Completed");
    await expect(page.locator("#activity-message")).toHaveText(
        "Call processed. Fill in any remaining details, then click Generate."
    );
    await expect(page.locator("#transcript")).toHaveValue(expectedTranscript);

    // 4. Check that the recorded WAV contains audio
    const wavHeaderSizeInBytes = 44;
    const recordedAudio = await page.evaluate(readRecordedWavDetails);
    expect(recordedAudio.size).toBeGreaterThan(wavHeaderSizeInBytes);
    expect(recordedAudio.channels).toBe(1);
    expect(recordedAudio.sampleRate).toBe(16000);
    expect(recordedAudio.bitsPerSample).toBe(16);

    // 5. Submit the reviewed transcript and check the export request
    const exportResponsePromise = page.waitForResponse(function isWordExportResponse(response) {
        return response.url().endsWith("/export") && response.request().method() === "POST";
    });
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#missing-details-submit-button").click();
    const exportResponse = await exportResponsePromise;
    expect(exportResponse.ok()).toBe(true);
    const exportPayload = exportResponse.request().postDataJSON();
    const exportedCallDetails = JSON.parse(exportPayload.transcript);
    expect(exportedCallDetails["[transcriptie]"]).toBe(expectedTranscript);

    // 6. Save the download and check that it begins with a ZIP file header
    const download = await downloadPromise;
    const downloadedFilename = download.suggestedFilename();
    expect(downloadedFilename).toMatch(/\.docx$/i);
    const downloadPath = testInfo.outputPath(downloadedFilename);
    await download.saveAs(downloadPath);
    const downloadFailure = await download.failure();
    expect(downloadFailure).toBeNull();
    const downloadedFile = await fs.readFile(downloadPath);
    expect(downloadedFile.length).toBeGreaterThan(0);

    // DOCX files are ZIP archives. The ZIP header begins with these four bytes:
    // 0x50 ('P'), 0x4b ('K'), 0x03 ('3'), and 0x04 ('4').
    const zipSignatureBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const downloadedSignatureBytes = downloadedFile.subarray(0, zipSignatureBytes.length);
    expect(downloadedSignatureBytes).toEqual(zipSignatureBytes);
});

async function readRecordedWavDetails() {
    const audioLink = document.getElementById("harm-download");
    const audioResponse = await fetch(audioLink.href);
    const audioBytes = await audioResponse.arrayBuffer();
    const audioView = new DataView(audioBytes);

    // A WAV header stores these fields at fixed byte offsets
    const channelsByteOffset = 22;
    const sampleRateByteOffset = 24;
    const bitsPerSampleByteOffset = 34;

    // WAV numbers use little-endian byte order
    const littleEndian = true;
    const channels = audioView.getUint16(channelsByteOffset, littleEndian);
    const sampleRate = audioView.getUint32(sampleRateByteOffset, littleEndian);
    const bitsPerSample = audioView.getUint16(bitsPerSampleByteOffset, littleEndian);

    return {
        size: audioBytes.byteLength,
        channels: channels,
        sampleRate: sampleRate,
        bitsPerSample: bitsPerSample
    };
}

function observeRealMicrophoneChunks() {
    window.recordedMicrophoneChunk = false;
    const originalPortProperty = Object.getOwnPropertyDescriptor(AudioWorkletNode.prototype, "port");

    Object.defineProperty(AudioWorkletNode.prototype, "port", {
        configurable: originalPortProperty.configurable,
        enumerable: originalPortProperty.enumerable,
        get: function getPortWithRecordingListener() {
            const port = originalPortProperty.get.call(this);
            if (port.recordingTestListenerAdded !== true) {
                port.recordingTestListenerAdded = true;
                port.addEventListener("message", function noticeRecordedAudio(event) {
                    const message = event.data;
                    if (message !== null && typeof message === "object") {
                        const audioChunk = message.chunk;
                        if (audioChunk instanceof Int16Array && audioChunk.length > 0) {
                            window.recordedMicrophoneChunk = true;
                        }
                    }
                });
            }
            return port;
        }
    });
}
