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
                { kind: "audioinput", label: "Desk microphone", deviceId: "desk-device" },
                { kind: "videoinput", label: "Camera" },
                { kind: "audioinput", label: "Headset microphone", deviceId: "headset-device" }
            ];
        };
    });

    await page.goto("/");
    await page.locator("#list-microphones-button").click();

    await expect(page.locator("#microphone-message")).toHaveText("2 microphone inputs found. Choose one below");
    await expect(page.locator("#microphone-select option")).toHaveText([
        "Choose a microphone", "Desk microphone", "Headset microphone"
    ]);
    await expect(page.locator("#microphone-select option").nth(0)).toHaveAttribute("value", "");
    await expect(page.locator("#microphone-select option").nth(1)).toHaveAttribute("value", "desk-device");
    await expect(page.locator("#microphone-select option").nth(2)).toHaveAttribute("value", "headset-device");
    await expect(page.locator("#microphone-select")).toBeEnabled();
    await expect(page.locator("#list-microphones-button")).toBeEnabled();
    await expect.poll(async function () {
        return await page.evaluate(function () {
            return window.stoppedMicrophoneTracks;
        });
    }).toBe(1);
});

test("recording requests the selected microphone from two available inputs", async function ({ page }) {
    await page.addInitScript(function () {
        window.microphoneRequests = [];
        navigator.mediaDevices.enumerateDevices = async function () {
            return [
                { kind: "audioinput", label: "Desk microphone", deviceId: "desk-device" },
                { kind: "audioinput", label: "Headset microphone", deviceId: "headset-device" }
            ];
        };
        navigator.mediaDevices.getUserMedia = async function (constraints) {
            window.microphoneRequests.push(constraints);
            return {
                getTracks: function () {
                    return [{ stop: function () {} }];
                },
                getAudioTracks: function () {
                    return [];
                }
            };
        };
    });

    await page.goto("/");
    await page.locator("#list-microphones-button").click();
    await expect(page.locator("#microphone-select")).toBeEnabled();
    await page.locator("#microphone-select").selectOption("headset-device");
    await page.locator("#start-button").click();
    await expect(page.locator("#activity-message")).toHaveText("The selected microphone did not provide audio.");

    const requests = await page.evaluate(function () {
        return window.microphoneRequests;
    });
    expect(requests).toEqual([
        { audio: true },
        { audio: { deviceId: { exact: "headset-device" } } }
    ]);
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
    await expect(page.locator("#microphone-select option")).toHaveCount(1);
    await expect(page.locator("#microphone-select")).toBeDisabled();
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
    await expect(page.locator("#microphone-select option")).toHaveCount(1);
    await expect(page.locator("#microphone-select")).toBeDisabled();
    await expect(page.locator("#list-microphones-button")).toBeEnabled();
});
