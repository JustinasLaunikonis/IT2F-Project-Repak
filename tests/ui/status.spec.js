const { test, expect } = require("@playwright/test");

const normalPageUrls = ["/", "/?debug=false"];

for (const pageUrl of normalPageUrls) {
    test("status preview controls stay hidden on " + pageUrl, async function ({ page }) {
        await page.goto(pageUrl);

        await expect(page.locator(".state-tester")).toBeHidden();

        const previewButtonIds = [
            "#test-idle",
            "#test-recording",
            "#test-processing",
            "#test-completed",
            "#test-error"
        ];

        for (const buttonId of previewButtonIds) {
            await expect(page.locator(buttonId)).toBeHidden();
        }

        await expect(page.locator("#start-button")).toBeVisible();
        await expect(page.locator("#start-button")).toBeEnabled();
        await expect(page.locator("#stop-button")).toBeVisible();
        await expect(page.locator("#activity-status")).toHaveText("Activity: Idle");
    });
}

test("status preview buttons show each state and its message", async function ({ page }) {
    await page.goto("/?debug=true");

    await expect(page.locator(".state-tester")).toBeVisible();

    const status = page.locator("#activity-status");
    const message = page.locator("#activity-message");

    await expect(status).toHaveText("Activity: Idle");
    await expect(status).toHaveClass("status status-idle");
    await expect(message).toHaveText("Application waiting to start.");

    const states = [
        { button: "#test-recording", name: "Recording", message: "Recording your microphone" },
        { button: "#test-processing", name: "Processing", message: "Processing the recording" },
        { button: "#test-completed", name: "Completed", message: "Transcription completed successfully" },
        { button: "#test-error", name: "Error", message: "Error - something went wrong while recording" },
        { button: "#test-idle", name: "Idle", message: "Application waiting to start" }
    ];

    for (const state of states) {
        await expect(page.locator(state.button)).toBeVisible();
        await page.locator(state.button).click();
        await expect(status).toHaveText("Activity: " + state.name);
        await expect(status).toHaveClass("status status-" + state.name.toLowerCase());
        await expect(message).toHaveText(state.message);
    }
});

test("a denied recording request shows the real error state", async function ({ page }) {
    await page.addInitScript(function () {
        navigator.mediaDevices.getUserMedia = async function () {
            throw new Error("Microphone permission denied");
        };
    });

    await page.goto("/");
    await page.locator("#start-button").click();

    await expect(page.locator("#activity-status")).toHaveText("Activity: Error");
    await expect(page.locator("#activity-status")).toHaveClass("status status-error");
    await expect(page.locator("#activity-message")).toHaveText("Microphone permission denied");
    await expect(page.locator("#connection-status")).toHaveText("Connection: Not connected");
    await expect(page.locator("#start-button")).toBeEnabled();
    await expect(page.locator("#stop-button")).toBeDisabled();
});
