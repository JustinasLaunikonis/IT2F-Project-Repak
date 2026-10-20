@echo off
setlocal

cd /d "%~dp0"
if errorlevel 1 (
    echo could not open the application folder.
    pause
    exit /b 1
)

set "python=%localappdata%\programs\python\python313\python.exe"
set "installer=%temp%\python-3.13.0-amd64.exe"

rem skip installation if python 3.13 is already installed
"%python%" --version >nul 2>&1 && goto python_install_done

echo downloading python 3.13...
powershell -noprofile -command "$erroractionpreference='stop'; invoke-webrequest -usebasicparsing 'https://www.python.org/ftp/python/3.13.0/python-3.13.0-amd64.exe' -outfile $env:installer"
if errorlevel 1 goto python_install_fail

echo installing python 3.13...
rem python installer option names are case-sensitive
start "" /wait "%installer%" /quiet InstallAllUsers=0 InstallLauncherAllUsers=0 PrependPath=1 TargetDir="%localappdata%\programs\python\python313"
if errorlevel 1 goto python_install_fail

:python_install_done
"%python%" --version || goto python_install_fail
echo python 3.13 installation is complete.

rem use ollama from path, or fall back to its standard installation folder
set "ollama=ollama.exe"
where ollama.exe >nul 2>&1
if errorlevel 1 set "ollama=%localappdata%\programs\ollama\ollama.exe"
"%ollama%" --version >nul 2>&1
if not errorlevel 1 goto ollama_done

echo downloading ollama...
powershell -noprofile -command "$erroractionpreference='stop'; invoke-webrequest -usebasicparsing 'https://ollama.com/download/OllamaSetup.exe' -outfile (join-path $env:temp 'ollamasetup.exe')"
if errorlevel 1 goto ollama_fail

echo installing ollama...
start "" /wait "%temp%\ollamasetup.exe" /verysilent /norestart /suppressmsgboxes
if errorlevel 1 goto ollama_fail
set "ollama=%localappdata%\programs\ollama\ollama.exe"
"%ollama%" --version >nul 2>&1 || goto ollama_fail

:ollama_done
rem start ollama only if it's not running
powershell -noprofile -command "try { invoke-restmethod 'http://127.0.0.1:11434/api/tags' -timeoutsec 2 -erroraction stop | out-null; exit 0 } catch { exit 1 }"
if not errorlevel 1 goto ollama_ready
echo starting ollama...
powershell -noprofile -command "$erroractionpreference='stop'; start-process -filepath $env:ollama -argumentlist 'serve' -windowstyle hidden"
if errorlevel 1 goto ollama_fail
powershell -noprofile -command ^
    "for ($attempt = 0; $attempt -lt 60; $attempt++) {" ^
    "    try {" ^
    "        invoke-restmethod 'http://127.0.0.1:11434/api/tags' -timeoutsec 2 -erroraction stop | out-null;" ^
    "        exit 0;" ^
    "    } catch {" ^
    "        start-sleep -seconds 1;" ^
    "    }" ^
    "}; exit 1"
if errorlevel 1 goto ollama_fail

:ollama_ready
echo downloading the report model...
"%ollama%" pull qwen3:4b
if errorlevel 1 (
    echo could not download the report model. check your internet connection and run install.bat again.
    pause
    exit /b 1
)

echo creating the python environment...
"%python%" -m venv .venv

if errorlevel 1 (
    echo failed to create the python environment.
    pause
    exit /b 1
)

echo installing dependencies...
".venv\scripts\python.exe" -m pip install -r requirements.txt

if errorlevel 1 (
    echo failed to install the dependencies.
    pause
    exit /b 1
)

rem reuse the saved device unless the user supplied a different setting
if not defined whisper_device (
    if exist ".venv\repak-settings.bat" call ".venv\repak-settings.bat"
)
if not defined whisper_device set "whisper_device=auto"
if /i "%whisper_device%"=="cpu" goto save_device

echo checking for an nvidia gpu...
".venv\scripts\python.exe" -c "from whisper_demo import get_whisper_device; import sys; sys.exit(get_whisper_device() != 'cuda')"
if errorlevel 1 goto save_device

echo installing cuda 12 and cudnn 9 libraries for windows...
echo these downloads can take several minutes.
".venv\scripts\python.exe" -m pip install -r requirements-cuda-windows.txt

if errorlevel 1 (
    echo could not install the nvidia libraries. continuing with the cpu.
    set "whisper_device=cpu"
)

:save_device
rem clear any earlier gpu error before saving the setting
ver >nul
> ".venv\repak-settings.bat" echo @set "whisper_device=%whisper_device%"
if errorlevel 1 (
    echo could not save the transcription device setting.
    pause
    exit /b 1
)

echo downloading the whisper models for this computer...
".venv\scripts\python.exe" download_whisper_model.py

if errorlevel 1 (
    echo failed to download the whisper model.
    echo check your internet connection and run install.bat again.
    pause
    exit /b 1
)

echo installation completed successfully.
echo double-click run.bat to start the application.
pause
exit /b 0

:python_install_fail
echo python 3.13 installation failed.
pause
exit /b 1

:ollama_fail
echo could not install or start ollama. run install.bat again.
pause
exit /b 1
