const { defineConfig } = require("@playwright/test");

let serverCommand = ".venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8765";
if (process.platform === "win32") {
    serverCommand = ".venv\\Scripts\\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8765";
}

module.exports = defineConfig({
    testDir: "./tests/ui",
    use: {
        baseURL: "http://127.0.0.1:8765",
        browserName: "chromium",
        launchOptions: {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        }
    },
    webServer: {
        command: serverCommand,
        url: "http://127.0.0.1:8765",
        reuseExistingServer: false,
        timeout: 30000
    }
});
