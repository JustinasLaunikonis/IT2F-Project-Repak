@echo off

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo The Python environment was not found.
    echo Run install.bat first.
    pause
    exit /b 1
)

echo Starting Repak transcription...
echo Open http://127.0.0.1:8000 in your browser.
echo Press Ctrl+C to stop the application.

".venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000

if errorlevel 1 (
    echo The application failed to start.
    pause
)