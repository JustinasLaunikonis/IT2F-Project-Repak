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

const listMicrophonesButton = document.getElementById(
    "list-microphones-button",
);
const microphoneMessage = document.getElementById("microphone-message");
const microphoneList = document.getElementById("microphone-list");

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

//start recording when 'start transcription' is clicked, update the activity state to 'recording'
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
    } catch (error) {
        recordingSessionActive = false;

        connectionStatus.textContent = "Connection: Not connected";
        startButton.disabled = false;
        stopButton.disabled = true;

        showState("error");
        activityMessage.textContent = error.message;
    }
});

//stop recording when 'stop transcription is pressed, update the activity state to 'processing'
stopButton.addEventListener("click", async function () {
    if (recordingSessionActive === false || stopRequested === true) {
        return;
    }

    stopRequested = true;
    stopButton.disabled = true;

    showState("processing");

    try {
        //stop recording and create the wav audio
        await stopWavRecording();

        recordingSessionActive = false;
        stopRequested = false;

        connectionStatus.textContent = "Connection: Not connected";
        startButton.disabled = false;
        stopButton.disabled = true;

        showState("idle");
        activityMessage.textContent =
            "Recording stopped. Transcription is not available yet.";
    } catch (error) {
        //reset the interface if recording cant be stopped
        recordingSessionActive = false;
        stopRequested = false;

        connectionStatus.textContent = "Connection: Not connected";
        startButton.disabled = false;
        stopButton.disabled = true;

        showState("error");
        activityMessage.textContent = error.message;
    }
});

//show names of all available microphones
async function listMicrophones() {
    microphoneList.textContent = ""; //clear old mic list

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

                const listItem = document.createElement("li");

                if (device.label) {
                    listItem.textContent = device.label;
                } else {
                    listItem.textContent = "Microphone" + microphoneCount;
                }

                microphoneList.appendChild(listItem); //once device is found, add it to the list and show it
            }
        }

        if (microphoneCount === 0) {
            microphoneMessage.textContent = "No microphone inputs were found";
        } else {
            microphoneMessage.textContent =
                microphoneCount + " microphone inputs found";
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
