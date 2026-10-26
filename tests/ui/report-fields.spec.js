const { test, expect } = require("@playwright/test");

const transcript = "Caller: Our machine RP-204 displays E204. Restarting did not help.";

test.beforeEach(async function ({ page }) {
    await page.route("**/report-models", route => route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ default: "qwen3:4b", models: [
            { name: "qwen3:1.7b", label: "1.7B (fastest)", memory: "~4 GB VRAM", installed: true },
            { name: "qwen3:4b", label: "4B (detailed, slower)", memory: "~6 GB VRAM", installed: true },
            { name: "qwen3:8b", label: "8B (larger, slower)", memory: "~10 GB VRAM", installed: false },
            { name: "qwen3:14b", label: "14B (best, slowest)", memory: "~14 GB VRAM", installed: true },
        ] }),
    }));
    // Recording itself is tested separately. These tests cover the report flow.
    await page.route("**/static/recorder.js", route => route.fulfill({
        contentType: "text/javascript",
        body: `
            export async function startWavRecording() {}
            export async function stopWavRecording() {
                return { harm: new Blob(["test recording"], { type: "audio/wav" }) };
            }
        `,
    }));
    await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = async () => ({
            getTracks: () => [{ stop() {} }],
        });
        navigator.mediaDevices.enumerateDevices = async () => [{
            kind: "audioinput", label: "Test microphone", deviceId: "test-microphone",
        }];
    });
    await page.route("**/transcribe", route => route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
            text: transcript,
            transcription_info: { Harm: { model: "small", device: "cpu" } },
        }),
    }));
});

async function recordCall(page) {
    await page.locator("#list-microphones-button").click();
    await page.locator("#microphone-select").selectOption("test-microphone");
    await page.locator("#start-button").click();
    await page.locator("#stop-button").click();
    await expect(page.locator("#activity-status")).toHaveText("Activity: Completed");
}

test("only empty fields are shown and Generate exports manual values", async ({ page }) => {
    let exports = 0;
    let submitted;
    await page.route("**/extract-report", route => {
        expect(route.request().postDataJSON()).toEqual({ transcript, model: "qwen3:1.7b" });
        return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ fields: {
                "[machinenummer]": "RP-204",
                "[alarmcode of exacte tekst]": "E204",
                "[klant]": "",
                "[transcriptie]": transcript,
            }, warning: null }),
        });
    });
    await page.route("**/export", route => {
        exports++;
        submitted = JSON.parse(route.request().postDataJSON().transcript);
        return route.fulfill({
            contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers: { filename: "call-report.docx" },
            body: "Download response",
        });
    });

    await page.goto("/");
    const modelSelect = page.getByLabel("Interpretation model");
    await expect(modelSelect).toHaveValue("qwen3:4b");
    await expect(modelSelect.locator('option[value="qwen3:1.7b"]')).toHaveText("1.7B (fastest)");
    await expect(modelSelect.locator('option[value="qwen3:14b"]')).toHaveText("14B (best, slowest)");
    await expect(modelSelect.locator('option[value="qwen3:8b"]')).toHaveText("8B (larger, slower) (not installed)");
    await expect(page.locator("#report-model-help")).toHaveCount(0);
    await expect(modelSelect.locator('option[value="qwen3:0.6b"]')).toHaveCount(0);
    const downloadModel = page.getByRole("button", { name: "Download model", exact: true });
    await expect(downloadModel).toBeHidden();
    await modelSelect.selectOption("qwen3:8b");
    await expect(downloadModel).toBeVisible();
    await page.route("**/report-models/download?model=qwen3%3A8b", route => route.fulfill({
        json: { status: "started" },
    }));
    page.once("dialog", async dialog => {
        expect(dialog.message()).toContain("Refresh the page after a few minutes");
        await dialog.accept();
    });
    await downloadModel.click();
    await expect(modelSelect).toHaveValue("qwen3:8b");
    await expect(modelSelect.locator('option[value="qwen3:8b"]')).toContainText("not installed");
    await modelSelect.selectOption("qwen3:1.7b");
    await recordCall(page);

    expect(exports).toBe(0);
    await expect(page.locator('input[name="[machinenummer]"]')).toHaveCount(0);
    await expect(page.locator('input[name="[alarmcode of exacte tekst]"]')).toHaveCount(0);
    await expect(page.locator('input[name="[datum]"]')).toHaveCount(0);
    await expect(page.locator('input[name="[transcriptie]"]')).toHaveCount(0);
    await expect(page.locator("#missing-count, #extraction-message")).toHaveCount(0);

    const customer = page.locator('input[name="[klant]"]');
    await customer.fill("Manual customer");
    await expect(customer).toBeVisible(); // Typing does not rebuild the form.

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    expect((await download).suggestedFilename()).toBe("call-report.docx");
    expect(exports).toBe(1);
    expect(submitted["[klant]"]).toBe("Manual customer");
    expect(submitted["[machinenummer]"]).toBe("RP-204");
    expect(submitted["[transcriptie]"]).toBe(transcript);
    expect(submitted["[datum]"]).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    expect(submitted["[datum / tijd]"]).toMatch(/^\d{2}-\d{2}-\d{4} \/ \d{2}:\d{2}$/);
});

test("Generate waits for extraction and existing manual values are preserved", async ({ page }) => {
    let finishExtraction;
    const waiting = new Promise(resolve => { finishExtraction = resolve; });
    await page.route("**/extract-report", async route => {
        await waiting;
        await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ fields: { "[klant]": "Model customer" }, warning: null }),
        });
    });
    let submitted;
    await page.route("**/export", route => {
        submitted = JSON.parse(route.request().postDataJSON().transcript);
        return route.fulfill({ headers: { filename: "report.docx" }, body: "Download" });
    });

    await page.goto("/");
    await page.locator('input[name="[klant]"]').fill("Harm's customer");
    await page.locator("#list-microphones-button").click();
    await page.locator("#microphone-select").selectOption("test-microphone");
    await page.locator("#start-button").click();
    await page.locator("#stop-button").click();
    await expect(page.locator("#activity-status")).toHaveText("Activity: Processing");
    await expect(page.getByRole("button", { name: "Generate", exact: true })).toBeDisabled();
    await expect(page.locator("#start-button")).toBeDisabled();
    await expect(page.getByLabel("Interpretation model")).toBeDisabled();
    finishExtraction();
    await expect(page.locator("#activity-status")).toHaveText("Activity: Completed");
    await expect(page.getByLabel("Interpretation model")).toBeEnabled();
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect.poll(() => submitted?.["[klant]"]).toBe("Harm's customer");
});

test("extracting again with another model replaces old fields and manual entries", async ({ page }) => {
    const correctedTranscript = "Caller: The correct machine is RP-315. Our company is New customer.";
    let finishExtraction;
    const waiting = new Promise(resolve => { finishExtraction = resolve; });
    let calls = 0;
    await page.route("**/extract-report", async route => {
        if (++calls === 1) {
            return route.fulfill({ json: { fields: {
                "[machinenummer]": "WRONG-204", "[alarmcode of exacte tekst]": "E204",
                "[symptomen]": "Old symptoms",
            } } });
        }
        expect(route.request().postDataJSON()).toEqual({ transcript: correctedTranscript, model: "qwen3:1.7b" });
        await waiting;
        await route.fulfill({ json: { fields: {
            "[machinenummer]": "RP-315", "[klant]": "New customer", "[alarmcode of exacte tekst]": "",
        } } });
    });
    let submitted;
    await page.route("**/export", route => {
        submitted = JSON.parse(route.request().postDataJSON().transcript);
        return route.fulfill({ headers: { filename: "report.docx" }, body: "Download" });
    });

    await page.goto("/");
    await recordCall(page);
    await page.locator('input[name="[klant]"]').fill("Old manual customer");
    await page.locator('input[name="[distributeur]"]').fill("Old manual distributor");
    await page.getByLabel("Interpretation model").selectOption("qwen3:1.7b");
    await page.locator("#transcript").fill(correctedTranscript);
    const extract = page.getByRole("button", { name: "Extract Fields", exact: true });
    const generate = page.getByRole("button", { name: "Generate", exact: true });
    await extract.click();

    await expect(extract).toBeDisabled();
    await expect(generate).toBeDisabled();
    await expect(page.locator("#start-button")).toBeDisabled();
    await expect(page.locator("#transcript")).not.toBeEditable();
    await expect(page.locator('input[name="[machinenummer]"]')).toHaveValue("");
    await expect(page.locator('input[name="[klant]"]')).toHaveValue("");
    await expect(page.locator('input[name="[distributeur]"]')).toHaveValue("");
    finishExtraction();

    await expect(extract).toBeEnabled();
    await expect(generate).toBeEnabled();
    await expect(page.locator("#start-button")).toBeEnabled();
    await expect(page.locator("#transcript")).toBeEditable();
    await expect(page.locator('input[name="[alarmcode of exacte tekst]"]')).toHaveValue("");
    await expect(page.locator('input[name="[symptomen]"]')).toHaveValue("");
    await generate.click();
    await expect.poll(() => submitted?.["[machinenummer]"]).toBe("RP-315");
    expect(submitted["[klant]"]).toBe("New customer");
    expect(submitted["[distributeur]"]).toBe("");
    expect(submitted["[alarmcode of exacte tekst]"]).toBe("");
    expect(submitted["[symptomen]"]).toBe("");
    expect(submitted["[transcriptie]"]).toBe(correctedTranscript);
    expect(submitted["[datum]"]).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    expect(submitted["[datum / tijd]"]).toMatch(/^\d{2}-\d{2}-\d{4} \/ \d{2}:\d{2}$/);
});

for (const failure of ["manual", "server", "malformed"]) {
    test(`a failed extraction retry (${failure}) clears the previous report`, async ({ page }) => {
        let calls = 0;
        await page.route("**/extract-report", route => {
            if (++calls === 1) {
                return route.fulfill({ json: { fields: { "[machinenummer]": "OLD-204" } } });
            }
            return route.fulfill({
                status: failure === "server" ? 500 : 200,
                json: failure === "malformed" ? { fields: null } : {
                    fields: {}, mode: "manual", warning: "Complete the details manually.",
                },
            });
        });
        await page.goto("/");
        await recordCall(page);
        await page.locator('input[name="[klant]"]').fill("Old customer");
        await page.getByRole("button", { name: "Extract Fields", exact: true }).click();

        await expect(page.getByRole("button", { name: "Extract Fields", exact: true })).toBeEnabled();
        await expect(page.locator("#activity-message")).toContainText("manually");
        await expect(page.locator('input[name="[machinenummer]"]')).toHaveValue("");
        await expect(page.locator('input[name="[klant]"]')).toHaveValue("");
        await expect(page.locator("#transcript")).toHaveValue(transcript);
        await expect(page.locator("#transcript")).toBeEditable();
        await expect(page.getByRole("button", { name: "Generate", exact: true })).toBeEnabled();
    });
}

for (const failure of ["manual", "server", "malformed"]) {
    test(`extraction failure (${failure}) leaves manual entry available`, async ({ page }) => {
        await page.route("**/extract-report", route => route.fulfill({
            status: failure === "server" ? 500 : 200,
            contentType: "application/json",
            body: JSON.stringify(failure === "malformed" ? { fields: null } : {
                fields: {}, mode: "manual", warning: "Fill in the details manually.",
            }),
        }));
        await page.goto("/");
        await recordCall(page);
        await expect(page.locator("#transcript")).toHaveValue(transcript);
        await expect(page.locator('input[name="[machinenummer]"]')).toBeEnabled();
        await expect(page.getByRole("button", { name: "Generate", exact: true })).toBeEnabled();
        await expect(page.locator("#harm-download")).toHaveAttribute("href", /^blob:/);
    });
}

test("a second call does not inherit the first call's fields", async ({ page }) => {
    let calls = 0;
    await page.route("**/extract-report", route => route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ fields: ++calls === 1 ? { "[machinenummer]": "RP-204" } : {}, warning: null }),
    }));
    await page.goto("/");
    await recordCall(page);
    await page.locator('input[name="[klant]"]').fill("Previous customer");
    await recordCall(page);
    await expect(page.locator('input[name="[machinenummer]"]')).toHaveValue("");
    await expect(page.locator('input[name="[klant]"]')).toHaveValue("");
});

test("manual choice preserves transcription and model-list failure keeps manual entry available", async ({ page }) => {
    await page.route("**/extract-report", route => {
        expect(route.request().postDataJSON()).toEqual({ transcript, model: "none" });
        return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ fields: {}, warning: "Complete the details manually." }),
        });
    });
    await page.goto("/");
    await page.getByLabel("Interpretation model").selectOption("none");
    await recordCall(page);
    await expect(page.locator("#transcript")).toHaveValue(transcript);
    await expect(page.getByRole("button", { name: "Generate", exact: true })).toBeEnabled();

    await page.route("**/report-models", route => route.fulfill({ status: 500, body: "Unavailable" }));
    await page.reload();
    await expect(page.getByLabel("Interpretation model")).toBeEnabled();
    await expect(page.getByLabel("Interpretation model")).toHaveValue("none");
});
