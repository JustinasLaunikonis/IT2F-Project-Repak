import { startWavRecording, stopWavRecording } from "./recorder.js"; //these functions come from recorder.js

const activityStatus = document.getElementById("activity-status");
const activityMessage = document.getElementById("activity-message");
const connectionStatus = document.getElementById("connection-status");

const startButton = document.getElementById("start-button");
const stopButton = document.getElementById("stop-button");

const stateTester = document.querySelector(".state-tester");
const testIdleButton = document.getElementById("test-idle");
const testRecordingButton = document.getElementById("test-recording");
const testProcessingButton = document.getElementById("test-processing");
const testCompletedButton = document.getElementById("test-completed");
const testErrorButton = document.getElementById("test-error");

const includeCaller = document.getElementById("include-caller");
const callerReview = document.getElementById("caller-review");
const recordingReview = document.getElementById("recording-review");
const harmPreview = document.getElementById("harm-preview");
const callerPreview = document.getElementById("caller-preview");
const harmDownload = document.getElementById("harm-download");
const callerDownload = document.getElementById("caller-download");

const microphoneSelect = document.getElementById("microphone-select");
const microphoneMessage = document.getElementById("microphone-message");
const listMicrophonesButton = document.getElementById(
    "list-microphones-button",
);

let harmUrl = null;
let callerUrl = null;
let recordingSessionActive = false; //prevents second recording session from being started
let stopRequested = false; //prevents stop from being requested more than once

function clearRecordingReview() {
    recordingReview.hidden = true;
    callerReview.hidden = true;
    harmPreview.removeAttribute("src");
    callerPreview.removeAttribute("src");
    harmDownload.removeAttribute("href");
    callerDownload.removeAttribute("href");

    if (harmUrl !== null) {
        URL.revokeObjectURL(harmUrl);
        harmUrl = null;
    }

    if (callerUrl !== null) {
        URL.revokeObjectURL(callerUrl);
        callerUrl = null;
    }
}

function showRecordingReview(files) {
    harmUrl = URL.createObjectURL(files.harm);
    harmPreview.src = harmUrl;
    harmDownload.href = harmUrl;

    if (files.caller !== undefined) {
        callerUrl = URL.createObjectURL(files.caller);
        callerPreview.src = callerUrl;
        callerDownload.href = callerUrl;
        callerReview.hidden = false;
    }

    recordingReview.hidden = false;
}

function handleUnexpectedStop(error, files) {
    recordingSessionActive = false;
    stopRequested = false;

    connectionStatus.textContent = "Connection: Not connected";

    startButton.disabled = false;
    stopButton.disabled = true;

    includeCaller.disabled = false;

    microphoneSelect.disabled = false;
    listMicrophonesButton.disabled = false;

    if (error !== null) {
        showState("error");
        activityMessage.textContent = error.message;
    } else {
        showRecordingReview(files);
        showState("idle");
        activityMessage.textContent =
            "An audio source disconnected. Review the available recording before downloading.";
    }
}

window.addEventListener("pagehide", clearRecordingReview);

//show test activity controls only when the URL includes ?debug=true
const urlParameters = new URLSearchParams(window.location.search);
if (urlParameters.get("debug") === "true") {
    stateTester.hidden = false;
} else {
    stateTester.hidden = true;
}

function showState(state) {
    activityStatus.className = "status status-" + state; //build a class name using selected state, so if 'recording' "status status-" + "recording" and it will use css for this recording state

    if (state === "idle") {
        activityStatus.textContent = "Activity: Idle";
        activityMessage.textContent = "Application waiting to start";
    } else if (state === "recording") {
        activityStatus.textContent = "Activity: Recording";
        activityMessage.textContent = "Recording your microphone";
        if (includeCaller.checked) {
            activityMessage.textContent =
                "Recording your microphone and caller audio";
        }
    } else if (state === "processing") {
        activityStatus.textContent = "Activity: Processing";
        activityMessage.textContent = "Processing the recording";
    } else if (state === "completed") {
        activityStatus.textContent = "Activity: Completed";
        activityMessage.textContent = "Transcription completed successfully";
    } else if (state === "error") {
        activityStatus.textContent = "Activity: Error";
        activityMessage.textContent =
            "Error - something went wrong while recording";
    }
}

testIdleButton.addEventListener("click", function () {
    showState("idle");
});

testRecordingButton.addEventListener("click", function () {
    showState("recording");
});

testProcessingButton.addEventListener("click", function () {
    showState("processing");
});

testCompletedButton.addEventListener("click", function () {
    showState("completed");
});

testErrorButton.addEventListener("click", function () {
    showState("error");
});

// Start capture after the user allows access to the selected audio sources.
startButton.addEventListener("click", async function () {
    if (recordingSessionActive === true) {
        return;
    }

    const selectedMicrophoneId = microphoneSelect.value; //get id of the microphone chosen by user

    if (selectedMicrophoneId === "") {
        showState("error");

        activityMessage.textContent =
            "List the microphones and choose one before the recording";

        return;
    }

    recordingSessionActive = true;
    stopRequested = false;
    clearRecordingReview();

    startButton.disabled = true;
    stopButton.disabled = true;

    includeCaller.disabled = true;

    microphoneSelect.disabled = true;
    listMicrophonesButton.disabled = true;

    activityMessage.textContent = "Please allow microphone access";
    if (includeCaller.checked) {
        activityMessage.textContent =
            "Please choose a source to share with audio and allow microphone access";
    }

    try {
        //try to start recorder
        await startWavRecording(
            handleUnexpectedStop,
            includeCaller.checked,
            selectedMicrophoneId,
        );

        connectionStatus.textContent = "Connection: Connected";
        stopButton.disabled = false;

        showState("recording");
    } catch (error) {
        recordingSessionActive = false;

        connectionStatus.textContent = "Connection: Not connected";

        startButton.disabled = false;
        stopButton.disabled = true;

        includeCaller.disabled = false;

        microphoneSelect.disabled = false;
        listMicrophonesButton.disabled = false;

        showState("error");
        activityMessage.textContent = error.message;
    }
});

// Stop capture and let the user review audio before choosing to download it.
stopButton.addEventListener("click", async function () {
    if (recordingSessionActive === false || stopRequested === true) {
        return;
    }

    stopRequested = true;
    stopButton.disabled = true;

    showState("processing");

    try {
        //stop recording and create the wav audio
        const files = await stopWavRecording();
        showRecordingReview(files);

        recordingSessionActive = false;
        stopRequested = false;

        connectionStatus.textContent = "Connection: Not connected";

        startButton.disabled = false;
        stopButton.disabled = true;

        includeCaller.disabled = false;

        microphoneSelect.disabled = false;
        listMicrophonesButton.disabled = false;

        showState("idle");
        activityMessage.textContent =
            "Recording stopped. Review your microphone audio before downloading. Transcription is not available yet.";
        if (files.caller !== undefined) {
            activityMessage.textContent =
                "Recording stopped. Review both audio files before downloading. Transcription is not available yet.";
        }
    } catch (error) {
        //reset the interface if recording cant be stopped
        recordingSessionActive = false;
        stopRequested = false;

        connectionStatus.textContent = "Connection: Not connected";

        startButton.disabled = false;
        stopButton.disabled = true;

        includeCaller.disabled = false;

        microphoneSelect.disabled = false;
        listMicrophonesButton.disabled = false;

        showState("error");
        activityMessage.textContent = error.message;
    }
});

//show names of all available microphones
async function listMicrophones() {
    microphoneSelect.innerHTML =
        '<option value="">Choose a microphone</option>'; //clear old mic options

    microphoneSelect.disabled = true;
    microphoneMessage.textContent = "Checking for microphones...";
    listMicrophonesButton.disabled = true;

    //check if browser supports mediadevices api
    if (!navigator.mediaDevices) {
        microphoneMessage.textContent =
            "This browser doesn't support microphone detection.";

        listMicrophonesButton.disabled = false;
        return;
    }

    let microphoneStream = null; //temporary live connection to microphone. here means no connection yet

    try {
        microphoneStream = await navigator.mediaDevices.getUserMedia({
            //ask user for temporary microphone permission
            audio: true,
        });

        const devices = await navigator.mediaDevices.enumerateDevices(); //give mics connected to the pc (count/list them one by one - enumerate)

        let microphoneCount = 0;

        //go through all connected media devices
        for (const device of devices) {
            if (device.kind === "audioinput") {
                //audioinput means microphone (mediadevices api standard)
                microphoneCount++;

                //create an option for this microphone
                const microphoneOption = document.createElement("option");

                //save the mic id inside the option
                microphoneOption.value = device.deviceId;

                if (device.label) {
                    microphoneOption.textContent = device.label;
                } else {
                    microphoneOption.textContent =
                        "Microphone" + microphoneCount;
                }

                microphoneSelect.appendChild(microphoneOption); //show the microphone in the dropdown
            }
        }

        if (microphoneCount === 0) {
            microphoneMessage.textContent = "No microphone inputs were found";
        } else {
            microphoneMessage.textContent =
                microphoneCount + " microphone inputs found. Choose one below";

            microphoneSelect.disabled = false; //this allows user to choose their microphone
        }
    } catch (error) {
        //show message when permissions are denied
        if (error.name === "NotAllowedError") {
            microphoneMessage.textContent =
                "Microphone access was denied. Allow access and try again";
        } else if (error.name === "NotFoundError") {
            microphoneMessage.textContent = "No microphone inputs were found";
        } else {
            microphoneMessage.textContent = "Microphones could not be loaded";
        }
    } finally {
        if (microphoneStream !== null) {
            const microphoneTracks = microphoneStream.getTracks(); //get the mic connectin from the stream. track = one live audio connection from media stream

            //stop every mic connection
            for (const microphoneTrack of microphoneTracks) {
                microphoneTrack.stop();
            }
        }

        listMicrophonesButton.disabled = false;
    }
}

listMicrophonesButton.addEventListener("click", function () {
    listMicrophones();
});
