const { test, expect } = require("@playwright/test");

test.use({
    permissions: ["microphone"],
    launchOptions: {
        args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
        ],
    },
});

const spokenText =
    "The customer is Green Foods. Their packaging machine keeps stopping.";
const transcriptText = "[00:00:00] Harm: " + spokenText;

const transcriptionResult = {
    segments: [{ speaker: "Harm", start: 0, end: 1, text: spokenText }],
    language: "en",
    model: "small",
    device: "cpu",
};

//prepare the page without using real recording or AI models.
test.beforeEach(async function ({ page }) {
    await page.route("**/report-models", async function (route) {
        await route.fulfill({
            json: {
                models: [
                    {
                        name: "qwen3:4b",
                        memory: "~6 GB VRAM",
                        installed: true,
                    },
                ],
                default: "qwen3:4b",
            },
        });
    });

    //replace the recorder only inside these tests.
    await page.route("**/static/recorder.js", async function (route) {
        await route.fulfill({
            contentType: "application/javascript",
            body: `
                let live;
                export async function startWavRecording(onStop, caller, microphone, options) {
                    live = options;
                }

                export async function stopWavRecording() {
                    const wav = new Blob(["saved-test-recording"], { type: "audio/wav" });
                    live.onLiveChunk({
                        speaker: "harm", startSeconds: 0, durationSeconds: 1,
                        wav, isFinal: true,
                    });
                    return { harm: wav };
                }
            `,
        });
    });

    await page.route("**/live/end", route => route.fulfill({ json: { ended: true } }));
    await page.route("**/transcribe", () => {
        throw new Error("Live retries must not upload the whole recording.");
    });

    await page.goto("/");

    await expect(page.locator("#report-model-select")).toBeEnabled();
    await page.locator("#report-model-select").selectOption("qwen3:4b");

    await page.locator("#list-microphones-button").click();

    const microphoneOption = page.locator("#microphone-select option").nth(1);

    await expect(microphoneOption).toHaveAttribute("value", /.+/);

    const microphoneId = await microphoneOption.getAttribute("value");
    await page.locator("#microphone-select").selectOption(microphoneId);
});

async function recordAndStop(page) {
    await page.locator("#start-button").click();

    await expect(page.locator("#activity-status")).toHaveText(
        "Activity: Recording",
    );

    await page.locator("#stop-button").click();
}

// Each chunk gets an automatic retry at Stop, followed by manual retries.
for (const failuresBeforeSuccess of [1, 2]) {
    test(`recover transcription with ${failuresBeforeSuccess} manual retries`, async function ({
        page,
    }) {
        let transcriptionRequests = 0;

        await page.route("**/transcribe-chunk", async function (route) {
            transcriptionRequests++;

            // Each attempt must upload the saved failed chunk.
            expect(route.request().postData()).toContain(
                "saved-test-recording",
            );

            if (transcriptionRequests <= failuresBeforeSuccess + 1) {
                await route.fulfill({
                    status: 503,
                    json: {
                        detail: "Temporary transcription failure.",
                    },
                });
                return;
            }

            await route.fulfill({
                json: transcriptionResult,
            });
        });

        await page.route("**/extract-report", async function (route) {
            await route.fulfill({
                json: {
                    mode: "llm",
                    fields: {},
                    warning: null,
                },
            });
        });

        await recordAndStop(page);

        await expect(page.locator("#activity-status")).toHaveText(
            "Activity: Completed",
        );
        await expect(page.locator("#transcript")).toHaveValue(/Not transcribed/);

        const savedAudioUrl = await page
            .locator("#harm-download")
            .getAttribute("href");

        for (let attempt = 0; attempt < failuresBeforeSuccess; attempt++) {
            const retryButton = page.locator("#retry-button");

            await expect(retryButton).toBeVisible();
            await expect(retryButton).toBeEnabled();
            await expect(retryButton).toHaveText("Retry transcription");

            await retryButton.click();

            if (attempt < failuresBeforeSuccess - 1) {
                await expect(page.locator("#activity-status")).toHaveText(
                    "Activity: Completed",
                );
                await expect(page.locator("#transcript")).toHaveValue(/Not transcribed/);
            } else {
                await expect(page.locator("#activity-status")).toHaveText(
                    "Activity: Completed",
                );
            }
        }

        await expect(page.locator("#transcript")).toHaveValue(transcriptText);

        // Retrying must not replace the audio preview.
        await expect(page.locator("#harm-download")).toHaveAttribute(
            "href",
            savedAudioUrl,
        );

        await expect(page.locator("#retry-button")).toBeHidden();

        expect(transcriptionRequests).toBe(failuresBeforeSuccess + 2);
    });
}

test("retry report extraction without transcribing again", async function ({
    page,
}) {
    let transcriptionRequests = 0;
    let reportRequests = 0;

    await page.route("**/transcribe-chunk", async function (route) {
        transcriptionRequests++;

        await route.fulfill({
            json: transcriptionResult,
        });
    });

    await page.route("**/extract-report", async function (route) {
        reportRequests++;

        const requestBody = route.request().postDataJSON();

        expect(requestBody.transcript).toBe(transcriptText);
        expect(requestBody.model).toBe("qwen3:4b");

        if (reportRequests === 1) {
            // The backend returns manual mode when extraction fails,
            // even when the HTTP status is 200.
            await route.fulfill({
                json: {
                    mode: "manual",
                    fields: {},
                    warning: "Automatic filling is unavailable.",
                },
            });
            return;
        }

        await route.fulfill({
            json: {
                mode: "llm",
                fields: {
                    "[klant]": "Green Foods",
                    "[probleem]": "The packaging machine keeps stopping.",
                },
                warning: null,
            },
        });
    });

    await recordAndStop(page);

    await expect(page.locator("#activity-status")).toHaveText(
        "Activity: Error",
    );

    await expect(page.locator("#transcript")).toHaveValue(transcriptText);

    const savedAudioUrl = await page
        .locator("#harm-download")
        .getAttribute("href");

    const retryButton = page.locator("#retry-button");

    await expect(retryButton).toHaveText("Retry filling report");
    await expect(retryButton).toBeEnabled();

    await retryButton.click();

    await expect(page.locator("#activity-status")).toHaveText(
        "Activity: Completed",
    );

    await expect(page.locator("#retry-button")).toBeHidden();
    await expect(page.locator("#transcript")).toHaveValue(transcriptText);

    await expect(page.locator("#harm-download")).toHaveAttribute(
        "href",
        savedAudioUrl,
    );

    // Only report extraction runs again, not transcription.
    expect(transcriptionRequests).toBe(1);
    expect(reportRequests).toBe(2);
});
