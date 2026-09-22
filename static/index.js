import { startWavRecording, stopWavRecording } from "./recorder.js"; //these functions come from recorder.js

const activityStatus = document.getElementById("activity-status");
const activityMessage = document.getElementById("activity-message");
const connectionStatus = document.getElementById("connection-status");

const startButton = document.getElementById("start-button");
const stopButton = document.getElementById("stop-button");

const testIdleButton = document.getElementById("test-idle");
const testRecordingButton = document.getElementById("test-recording");
const testProcessingButton = document.getElementById("test-processing");
const testCompletedButton = document.getElementById("test-completed");
const testErrorButton = document.getElementById("test-error");

let recordingSessionActive = false; //prevents second recording session from being started
let stopRequested = false; //prevents stop from being requested more than once

function showState(state) {
    activityStatus.className = "status status-" + state; //build a class name using selected state, so if 'recording' "status status-" + "recording" and it will use css for this recording state

    if (state === "idle") {
        activityStatus.textContent = "Activity: Idle";
        activityMessage.textContent = "Application waiting to start";
    } else if (state === "recording") {
        activityStatus.textContent = "Activity: Recording";
        activityMessage.textContent = "Recording the call";
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

//start recording when 'start transcription' is clicked
startButton.addEventListener("click", async function () {
    //async is used bcs starting the recorder takes time, it waits for screen sharing and microphone permission
    if (recordingSessionActive === true) {
        return;
    }

    recordingSessionActive = true;
    stopRequested = false;

    startButton.disabled = true;
    stopButton.disabled = true;

    activityMessage.textContent =
        "Please choose a source to share and allow microphone access";

    try {
        //try to start recorder
        await startWavRecording(); //wait until wav recorder finished starting.
        //startWabRecording() comes from recorder.js. recorder.js requests shared audio and mic access. it uses pcm-worklet.js to capture audio samples

        connectionStatus.textContent = "Connection: Connected";
        stopButton.disabled = false;

        showState("recording");
    } catch {}
});
