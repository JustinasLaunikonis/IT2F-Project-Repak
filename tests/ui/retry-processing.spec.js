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

const transcriptText =
    "The customer is Green Foods. Their packaging machine keeps stopping.";

const transcriptionResult = {
    text: transcriptText,
    transcription_info: {
        Harm: {
            model: "small",
            device: "cpu",
        },
    },
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
                export async function startWavRecording() {
                    // No real recording is needed for retry tests.
                }

                export async function stopWavRecording() {
                    return {
                        harm: new Blob(
                            ["saved-test-recording"],
                            { type: "audio/wav" }
                        ),
                    };
                }
            `,
        });
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

// Check both one failure and repeated failures.
for (const failuresBeforeSuccess of [1, 2]) {
    test(`retry transcription after ${failuresBeforeSuccess} failed attempts`, async function ({
        page,
    }) {
        let transcriptionRequests = 0;

        await page.route("**/transcribe", async function (route) {
            transcriptionRequests++;

            // Each attempt must upload the saved recording.
            expect(route.request().postData()).toContain(
                "saved-test-recording",
            );

            if (transcriptionRequests <= failuresBeforeSuccess) {
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
            "Activity: Error",
        );

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
                    "Activity: Error",
                );
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

        expect(transcriptionRequests).toBe(failuresBeforeSuccess + 1);
    });
}

test("retry report extraction without transcribing again", async function ({
    page,
}) {
    let transcriptionRequests = 0;
    let reportRequests = 0;

    await page.route("**/transcribe", async function (route) {
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
