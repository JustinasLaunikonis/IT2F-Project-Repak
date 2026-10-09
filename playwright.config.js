const fs = require("fs");
const { defineConfig } = require("@playwright/test");

let venvPython = ".venv/bin/python";
if (process.platform === "win32") {
    venvPython = ".venv\\Scripts\\python.exe";
}

//CI has no .venv folder, so use the normal python there
let python = "python";
if (fs.existsSync(venvPython)) {
    python = venvPython;
}

const serverCommand = python + " -m uvicorn main:app --host 127.0.0.1 --port 8765";

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
