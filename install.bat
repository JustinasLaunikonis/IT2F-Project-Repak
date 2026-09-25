@echo off

cd /d "%~dp0"
if errorlevel 1 (
    echo Could not open the application folder.
    pause
    exit /b 1
)

echo Checking Python...
python --version

if errorlevel 1 (
    echo Python was not found.
    echo Install Python 3.10 or newer and try again.
    pause
    exit /b 1
)

set "python_major="
set "python_minor="
for /f "tokens=1,2" %%A in ('python -c "import sys; print(sys.version_info.major, sys.version_info.minor)"') do (
    set "python_major=%%A"
    set "python_minor=%%B"
)

if not defined python_major goto python_version_failed
if not defined python_minor goto python_version_failed

if %python_major% LSS 3 goto python_too_old
if %python_major% EQU 3 (
    if %python_minor% LSS 10 goto python_too_old
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

echo Downloading the Whisper model for this computer...
".venv\Scripts\python.exe" download_whisper_model.py

if errorlevel 1 (
    echo Failed to download the Whisper model.
    echo Check your internet connection and run install.bat again.
    pause
    exit /b 1
)

echo Installation completed successfully.
echo Double-click run.bat to start the application.
pause
exit /b 0

:python_version_failed
echo Could not check the Python version.
pause
exit /b 1

:python_too_old
echo Python 3.10 or newer is required.
pause
exit /b 1
