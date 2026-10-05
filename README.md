# IT2F Project Repak

## Set up and run on Windows

1. Install [Python 3.10 or newer](https://www.python.org/downloads/windows/). During installation, select **Add python.exe to PATH**.
2. Download this project and unzip it to a folder on this computer. Keep all project files together.
3. With an internet connection, double-click `install.bat` in that folder. It creates a private Python environment, installs the required packages, and downloads the Whisper model. If CUDA is detected, it also downloads the smaller CPU model in case GPU loading fails. The first installation can take several minutes and requires space for the packages and models. Wait for **Installation completed successfully**.
4. Double-click `run.bat`. Leave its window open. Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in a browser on the same computer. Press **Ctrl+C** in the window to stop the application.

For later runs, use only `run.bat`. If installation stops with an error, read the message in its window and run `install.bat` again after fixing the problem. The model download needs internet during installation; audio processing is local. The current browser page is a local application preview. The full recording and transcription flow is still being developed.

## Prepare the application for offline use

Complete these one-time downloads while the computer is connected to the
internet:

1. Install Python 3.10 or newer.
2. Download and unzip this project.
3. Run `install.bat`. It creates `.venv`, installs the Python packages from
   `requirements.txt`, and stores the Whisper model in the local Hugging Face
   cache.
4. If the computer will use an NVIDIA GPU, install the compatible NVIDIA
   driver, CUDA 12 cuBLAS, and CUDA 12 cuDNN 9. These are not needed for the
   CPU fallback.
5. Open the application once with `run.bat` and confirm that
   [http://127.0.0.1:8000](http://127.0.0.1:8000) loads.

Keep the project folder, its `.venv` folder, and the downloaded model cache on
the computer. After this setup, `run.bat`, recording, transcription, and DOCX
export do not need an internet connection. Whisper is opened with
`local_files_only=True`, so it will report an error instead of downloading a
missing model during transcription.

### Verify the complete workflow without a network connection

1. Finish the one-time setup above, close the application, and turn off Wi-Fi
   and any wired network connection.
2. Double-click `run.bat` and open
   [http://127.0.0.1:8000](http://127.0.0.1:8000).
3. Select a microphone, record a short test call, stop the recording, listen
   to it, and download `harm.wav`. Download `caller.wav` too if caller audio
   was enabled.
4. In PowerShell, transcribe each downloaded recording locally:

   ```powershell
   .\.venv\Scripts\python.exe whisper_demo.py "C:\path\to\harm.wav"
   .\.venv\Scripts\python.exe whisper_demo.py "C:\path\to\caller.wav"
   ```

5. Copy the transcript into the **transcriptie** field in the browser, fill in
   the other required call details, and save the generated DOCX report.
6. Open the DOCX and confirm that it contains the transcript and call details.

The current interface does not send recordings directly to Whisper. The two
local transcription commands are therefore a manual step in this offline
verification cycle.

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

### Test the WAV upload endpoint

Start the application with `run.bat`. In PowerShell, set the path to a WAV
file on your computer and upload it:

```powershell
$audioFile = "C:\Path\To\recording.wav"
curl.exe -X POST http://127.0.0.1:8000/transcribe -F "file=@$audioFile"
```

A successful request returns JSON such as `{"text":"Hello, this is a test."}`.
The file is processed locally. Browser recording and upload integration are
still being developed.

## Run the browser tests

First run `install.bat`. Install Node.js and npm, then run these commands in PowerShell from the project folder:

```powershell
npm ci
npx playwright install chromium
npm run test:ui
```

The tests start a local server automatically and check activity status,
microphone selection, recording, and export in Chromium.

The record-to-export test uses Chromium's fake microphone with
`--use-fake-device-for-media-stream` and `--use-fake-ui-for-media-stream`,
and grants microphone permission in its test context. It records through
browser audio APIs, replaces only
the `/transcribe` response with synthetic fixture JSON, checks the completed
state and transcript, and downloads a DOCX from the real `/export` endpoint.
No physical microphone, Whisper model download, or GPU is needed for this
test. It checks browser integration, not Whisper transcription accuracy.
CI runs it automatically with the rest of the browser tests.

To run only this flow:

```powershell
npm run test:ui -- tests/ui/record-to-export.spec.js
```

### Check microphone and caller timing

Both recordings use one audio clock. Silence stays in each file, including
periods when an input temporarily supplies no audio samples. The two WAVs
start together and end on the same frame.

Whisper uses word alignment to estimate segment boundaries against each
untrimmed WAV. The transcript keeps those times when combining the speakers;
it does not reset either speaker's first words to zero. Recognition times
are estimates and still need comparison with a real conversation.

Run the timing regression tests with:

```powershell
npm run test:ui -- tests/ui/recording-sync.spec.js
```

These tests check delayed starts, missing input, overlapping audio, and a
shared stop boundary. They also use Chromium's real audio processor at
44.1 and 48 kHz. They do not measure Whisper's recognition accuracy.

Before completing issue #69, record a natural two-person test call with caller
audio enabled. Have the caller wait before speaking, leave pauses, and include
quick replies and interruptions. Download both WAVs and check that their
durations match. Listen to both files from time zero and compare the transcript
times and speaker order with the audio. Record the browser, model, device,
and any timing differences in the PR. A consistent shift in either channel
or an incorrect speaker order needs further investigation.

## Scripted test calls

The `test_calls` directory contains five short synthetic English service calls for demonstrations, transcription accuracy checks, and automated testing.

All conversations are fictional. They contain no real customer audio or customer information.

| Call | Machine problem |
| --- | --- |
| Call 01 | Conveyor belt moves backwards |
| Call 02 | Label printer keeps printing the word banana |
| Call 03 | Robot arm waves instead of picking up boxes |
| Call 04 | Packaging machine wraps empty space |
| Call 05 | Coffee machine makes coffee without a cup |

Each call directory contains:

- `harm.wav`: the Operator's microphone recording.
- `caller.wav`: the Technician's caller-audio recording.
- `transcript.txt`: the exact scripted conversation for both speakers.

The recordings are mono, 16-bit PCM WAV files at 16 kHz.

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
