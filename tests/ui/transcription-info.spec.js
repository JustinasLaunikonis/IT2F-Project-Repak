const { test, expect } = require("@playwright/test");

test("transcription info starts hidden", async function ({ page }) {
    await page.goto("/");

    await expect(page.locator("#transcription-info")).toBeHidden();
});
