const { test, expect } = require("@playwright/test");

test("lists microphone names and closes the temporary stream", async function ({ page }) {
    await page.addInitScript(function () {
        window.stoppedMicrophoneTracks = 0;

        navigator.mediaDevices.getUserMedia = async function () {
            return {
                getTracks: function () {
                    return [
                        {
                            stop: function () {
                                window.stoppedMicrophoneTracks += 1;
                            }
                        }
                    ];
                }
            };
        };

        navigator.mediaDevices.enumerateDevices = async function () {
            return [
                { kind: "audioinput", label: "Desk microphone" },
                { kind: "videoinput", label: "Camera" },
                { kind: "audioinput", label: "Headset microphone" }
            ];
        };
    });

    await page.goto("/");
    await page.locator("#list-microphones-button").click();

    await expect(page.locator("#microphone-message")).toHaveText("2 microphone inputs found");
    await expect(page.locator("#microphone-list li")).toHaveText([
        "Desk microphone",
        "Headset microphone"
    ]);
    await expect(page.locator("#list-microphones-button")).toBeEnabled();
    await expect.poll(async function () {
        return await page.evaluate(function () {
            return window.stoppedMicrophoneTracks;
        });
    }).toBe(1);
});

test("shows the empty state when no microphone is connected", async function ({ page }) {
    await page.addInitScript(function () {
        navigator.mediaDevices.getUserMedia = async function () {
            throw new DOMException("No microphone connected", "NotFoundError");
        };
    });

    await page.goto("/");
    await page.locator("#list-microphones-button").click();

    await expect(page.locator("#microphone-message")).toHaveText("No microphone inputs were found");
    await expect(page.locator("#microphone-list li")).toHaveCount(0);
    await expect(page.locator("#list-microphones-button")).toBeEnabled();
});

test("explains denied microphone permission separately from an empty list", async function ({ page }) {
    await page.addInitScript(function () {
        navigator.mediaDevices.getUserMedia = async function () {
            throw new DOMException("Permission denied", "NotAllowedError");
        };
    });

    await page.goto("/");
    await page.locator("#list-microphones-button").click();

    await expect(page.locator("#microphone-message")).toHaveText(
        "Microphone access was denied. Allow access and try again"
    );
    await expect(page.locator("#microphone-list li")).toHaveCount(0);
    await expect(page.locator("#list-microphones-button")).toBeEnabled();
});
