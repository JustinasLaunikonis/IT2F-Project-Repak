# IT2F Project Repak

## Set up and run on Windows

1. Install [Python 3.10 or newer](https://www.python.org/downloads/windows/). During installation, select **Add python.exe to PATH**.
2. Download this project and unzip it to a folder on this computer. Keep all project files together.
3. With an internet connection, double-click `install.bat` in that folder. It creates a private Python environment, installs the required packages, and downloads the Whisper model. If CUDA is detected, it also downloads the smaller CPU model in case GPU loading fails. The first installation can take several minutes and requires space for the packages and models. Wait for **Installation completed successfully**.
4. Double-click `run.bat`. Leave its window open. Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in a browser on the same computer. Press **Ctrl+C** in the window to stop the application.

For later runs, use only `run.bat`. If installation stops with an error, read the message in its window and run `install.bat` again after fixing the problem. The model download needs internet during installation; audio processing is local. The current browser page is a local application preview. The full recording and transcription flow is still being developed.

## Run local Whisper transcription

The standalone transcription command selects `large-v3-turbo` with CUDA and
`float16` when an NVIDIA GPU is available. On a CPU machine it uses `small`
with `int8` and prints a warning. It logs the model, device, and compute type
before transcribing. `install.bat` downloads the selected model ahead of time.
Transcription uses only local model files. If a model is missing, run
`install.bat` again while connected to the internet.

```powershell
.\.venv\Scripts\python.exe whisper_demo.py path\to\recording.wav
```

Set `WHISPER_DEVICE` to `auto` (default), `cuda`, or `cpu`. Set `WHISPER_MODEL`
to override the model for either device. The override may also be a local model
folder. Run `install.bat` with the same settings before transcribing; it
downloads a named model or checks an existing local folder for the required
model files. For example:

```powershell
$env:WHISPER_DEVICE = "cpu"
$env:WHISPER_MODEL = "base"
.\install.bat
.\.venv\Scripts\python.exe whisper_demo.py path\to\recording.wav
```

Remove the overrides with `Remove-Item Env:WHISPER_DEVICE, Env:WHISPER_MODEL`.
If CUDA is unavailable or its libraries fail to load, the command warns and
uses the CPU. A model override remains in effect during that fallback.

GPU inference requires a compatible NVIDIA driver, [CUDA 12 cuBLAS and CUDA 12
cuDNN 9](https://github.com/SYSTRAN/faster-whisper#gpu). On Windows, install
these libraries separately and add their DLL directories to `PATH` before
starting Python. The `nvidia-*` packages in `requirements.txt` apply only to
Linux, as faster-whisper documents their pip installation for Linux. On Linux,
set `LD_LIBRARY_PATH` to the installed cuBLAS and cuDNN library directories
before starting Python. CPU transcription does not require these GPU libraries.

## Run the UI status test

First run `install.bat`. Install Node.js and npm, then run these commands in PowerShell from the project folder:

```powershell
npm ci
npx playwright install chromium
npm run test:ui
```

The test starts a local server automatically and checks the visible activity status and error message in Chromium. It tests the status preview buttons and a simulated recording permission failure, without recording audio.

## Contributing through pull requests

All changes to `main` must go through a pull request (PR). Reviewer approvals are not required, but asking a teammate to review your PR is encouraged.

Each feature should have its own branch and subsequently a pull request.

Branches allow normal commits and pushes. Work on a separate branch, push it, and open a PR targeting `main`. Merge that PR on GitHub. **DO NOT** merge locally into `main` and try to push it directly.


### 1. Update main, then create and check out a branch

These examples use PowerShell. Change the repository path if your clone is elsewhere, and choose a new branch name for each task.

```powershell
Set-Location "C:\Users\MSI\Desktop\IT2F-Project-Repak"
git status

# Switch to the existing main branch on your computer.
git checkout main

# Download main from GitHub (origin). --ff-only stops if local and remote history have diverged.
git pull --ff-only origin main

git checkout -b docs/update-contribution-guide
```

`git checkout -b` creates the branch and switches to it. To return to an existing local branch later, use:

```powershell
git checkout docs/update-contribution-guide
```

### 2. Edit, commit, and push your branch

After editing the relevant files, review your changes and stage only the files for this task. This example commits a README change:

```powershell
git status
git add README.md
git commit -m "document the pull request contribution workflow"

# Upload this branch to GitHub. -u remembers its remote branch for future git push commands.
git push -u origin docs/update-contribution-guide
```
For later commits on this branch, repeat the review and commit steps, then run `git push`.

### 3. Open and merge the pull request

1. Open the repository's [pull requests page](https://github.com/JustinasLaunikonis/IT2F-Project-Repak/pulls) and select **New pull request**.
2. Choose `main` as the base and `docs/update-contribution-guide` as the compare branch.
3. Review the changes, describe what changed and how you checked it, then create the PR.
4. Resolve any conflicts and address feedback. When the PR is ready, use GitHub merge button and confirm the merge.


Alternatively, install the GitHub CLI (`gh`) and run these commands from the repository directory. If you have not authenticated yet, sign in first:

```powershell
gh auth login
```

Create the PR after pushing your branch:

```powershell
# Open a PR into --base main from your --head branch. Follow the title and description prompts.
gh pr create --base main --head docs/update-contribution-guide
```

After reviewing the PR, resolving conflicts, and addressing feedback, merge it with:

```powershell
# Merge this branch's PR on GitHub. --merge joins its commits into main with a merge commit.
gh pr merge docs/update-contribution-guide --merge
```

### 4. Update main and delete the finished branch

After GitHub confirms that the PR was merged, switch back to `main` and download the merged changes:

```powershell
git checkout main

# Download the merged main from GitHub. --ff-only stops if local and remote history have diverged.
git pull --ff-only origin main
```

While on `main`, check that all your branch's changes reached `main` and that no unmerged work remains. Then delete the finished branch on GitHub and on your computer:

```powershell
# Delete the finished branch on GitHub (origin). This does not delete your local branch.
git push origin --delete docs/update-contribution-guide

# Delete the local feature branch. -d refuses if Git does not consider its commits merged.
git branch -d docs/update-contribution-guide
```

If GitHub already deleted the branch, skip only `git push origin --delete docs/update-contribution-guide`. In that case run the local deletion command.
