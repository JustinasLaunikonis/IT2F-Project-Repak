const activityStatus = document.getElementById("activity-status");
const activityMessage = document.getElementById("activity-message");

const testIdleButton = document.getElementById("test-idle");
const testRecordingButton = document.getElementById("test-recording");
const testProcessingButton = document.getElementById("test-processing");
const testCompletedButton = document.getElementById("test-completed");
const testErrorButton = document.getElementById("test-error");

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
