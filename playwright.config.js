const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
    testDir: "./tests/ui",
    use: {
        baseURL: "http://127.0.0.1:8765",
        browserName: "chromium"
    },
    webServer: {
        command: ".venv\\Scripts\\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8765",
        url: "http://127.0.0.1:8765",
        reuseExistingServer: false,
        timeout: 30000
    }
});
