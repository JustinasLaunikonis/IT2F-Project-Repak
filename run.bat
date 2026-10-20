@echo off
setlocal

cd /d "%~dp0"
if errorlevel 1 (
    echo could not open the application folder.
    pause
    exit /b 1
)

if not exist ".venv\scripts\python.exe" (
    echo the python environment was not found.
    echo run install.bat first.
    pause
    exit /b 1
)

rem load the device selected during installation
if not defined whisper_device (
    if exist ".venv\repak-settings.bat" call ".venv\repak-settings.bat"
)

rem use ollama from path, or its standard installation folder
set "ollama=ollama.exe"
where ollama.exe >nul 2>&1
if errorlevel 1 set "ollama=%localappdata%\programs\ollama\ollama.exe"

echo starting ollama if needed...
powershell -noprofile -command ^
    "$erroractionpreference = 'stop';" ^
    "try { invoke-restmethod 'http://127.0.0.1:11434/api/tags' -timeoutsec 2 | out-null; exit 0 } catch {};" ^
    "start-process -filepath $env:ollama -argumentlist 'serve' -windowstyle hidden;" ^
    "for ($attempt = 0; $attempt -lt 60; $attempt++) {" ^
    "    try {" ^
    "        invoke-restmethod 'http://127.0.0.1:11434/api/tags' -timeoutsec 2 | out-null;" ^
    "        exit 0;" ^
    "    } catch { start-sleep -seconds 1 }" ^
    "}; exit 1"
if errorlevel 1 (
    echo could not start ollama. run install.bat again if it is missing.
    pause
    exit /b 1
)

rem open the existing application if it is already running
powershell -noprofile -command ^
    "try {" ^
    "    $page = invoke-webrequest -usebasicparsing 'http://127.0.0.1:8000' -timeoutsec 2 -erroraction stop;" ^
    "    if ($page.content -like '*repak live call transcription*') { start-process 'http://127.0.0.1:8000'; exit 0 }" ^
    "} catch {}; exit 1"
if not errorlevel 1 exit /b 0

rem wait in the background, then open the browser when repak is ready
start "" /b powershell -noprofile -command ^
    "for ($attempt = 0; $attempt -lt 30; $attempt++) {" ^
    "    try {" ^
    "        $page = invoke-webrequest -usebasicparsing 'http://127.0.0.1:8000' -timeoutsec 2 -erroraction stop;" ^
    "        if ($page.content -like '*repak live call transcription*') { start-process 'http://127.0.0.1:8000'; exit 0 }" ^
    "    } catch {};" ^
    "    start-sleep -seconds 1;" ^
    "}; exit 1"

echo starting repak transcription...
echo the application will open in your default browser.
echo keep this window open. press ctrl+c to stop the application.

".venv\scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000

if errorlevel 1 (
    echo the application failed to start. check the error above.
    pause
    exit /b 1
)
