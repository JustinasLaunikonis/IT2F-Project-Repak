const { test, expect } = require("@playwright/test");

test("status preview buttons show each state and its message", async function ({ page }) {
    await page.goto("/");

    const status = page.locator("#activity-status");
    const message = page.locator("#activity-message");

    await expect(status).toHaveText("Activity: Idle");
    await expect(status).toHaveClass("status status-idle");
    await expect(message).toHaveText("Application waiting to start.");

    const states = [
        { button: "#test-recording", name: "Recording", message: "Recording the call" },
        { button: "#test-processing", name: "Processing", message: "Processing the recording" },
        { button: "#test-completed", name: "Completed", message: "Transcription completed successfully" },
        { button: "#test-error", name: "Error", message: "Error - something went wrong while recording" },
        { button: "#test-idle", name: "Idle", message: "Application waiting to start" }
    ];

    for (const state of states) {
        await page.locator(state.button).click();
        await expect(status).toHaveText("Activity: " + state.name);
        await expect(status).toHaveClass("status status-" + state.name.toLowerCase());
        await expect(message).toHaveText(state.message);
    }
});

test("a denied recording request shows the real error state", async function ({ page }) {
    await page.addInitScript(function () {
        navigator.mediaDevices.getDisplayMedia = async function () {
            throw new Error("Screen sharing permission denied");
        };
    });

    await page.goto("/");
    await page.locator("#start-button").click();

    await expect(page.locator("#activity-status")).toHaveText("Activity: Error");
    await expect(page.locator("#activity-status")).toHaveClass("status status-error");
    await expect(page.locator("#activity-message")).toHaveText("Screen sharing permission denied");
    await expect(page.locator("#connection-status")).toHaveText("Connection: Not connected");
    await expect(page.locator("#start-button")).toBeEnabled();
    await expect(page.locator("#stop-button")).toBeDisabled();
});
