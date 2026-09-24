@echo off

cd /d "%~dp0"

echo Checking Python...
python --version

if errorlevel 1 (
    echo Python was not found.
    echo Install Python 3.10 or newer and try again.
    pause
    exit /b 1
)

echo Creating the Python environment...
python -m venv .venv

if errorlevel 1 (
    echo Failed to create the Python environment.
    pause
    exit /b 1
)

echo Installing dependencies...
".venv\Scripts\python.exe" -m pip install -r requirements.txt

if errorlevel 1 (
    echo Failed to install the dependencies.
    pause
    exit /b 1
)

echo Installation completed successfully.
pause