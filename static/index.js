// noinspection RedundantIfStatementJS

import { startWavRecording, stopWavRecording } from "./recorder.js"; //these functions come from recorder.js

const activityStatus = document.getElementById("activity-status");
const activityMessage = document.getElementById("activity-message");
const connectionStatus = document.getElementById("connection-status");
const transcript = document.getElementById("transcript");
const transcriptionInfo = document.getElementById("transcription-info");

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
const missingDetails = document.getElementById("missing-details-form");
const missingDetailsSubmitButton = document.getElementById(
    "missing-details-submit-button",
);

const microphoneSelect = document.getElementById("microphone-select");
const reportModelSelect = document.getElementById("report-model-select");
const microphoneMessage = document.getElementById("microphone-message");
const listMicrophonesButton = document.getElementById(
    "list-microphones-button",
);

const microphonePreferenceKey = "preferredMicrophoneId"; //store mic preference in the browser

let harmUrl = null;
let callerUrl = null;
let recordingSessionActive = false; //prevents second recording session from being started
let stopRequested = false; //prevents stop from being requested more than once
let recordingStartedAt = null;

async function loadReportModels() {
    try {
        const response = await fetch("/report-models");
        if (!response.ok) throw new Error("Models could not be loaded.");
        const result = await response.json();
        for (const model of result.models) {
            const option = document.createElement("option");
            option.value = model.name;
            option.textContent = `${model.name} — ${model.memory}${model.installed ? "" : " (not installed)"}`;
            option.disabled = !model.installed;
            reportModelSelect.appendChild(option);
        }
        reportModelSelect.value = result.default;
    } catch (error) {
        reportModelSelect.value = "none";
    } finally {
        reportModelSelect.disabled = false;
    }
}

loadReportModels();

const jsonStringTemplate = `{
    "[machinenummer]": "",
    "[distributeur]": "",
    "[naam monteur]": "",
    "[contactpersoon]": "",
    "[klant]": "",
    "[tijdverschil]": "",

    "[datum]": "",
    "[engineer]": "",
    "[goedgekeurd]": "",
    "[datum / tijd]": "",

    "[telefoonnummer en/of e-mailadres]": "",
    "[taal]": "",
    "[naam van Repak medewerker die melding aangenomen heeft]": "",
    "[machine staat stil / productie beperkt / machine in productie]": "",
    "[audio link]": "",
    "[betrouwbaarheid transcriptie hoog / gemiddeld / laag]": "",
    "[tijdstippen of toelichting]": "",

    "[transcriptie]": "",
    "[probleem]": "",
    "[alarmcode of exacte tekst]": "",
    "[onderdeel of station]": "",
    "[datum / tijd / situatie]": "",
    "[eenmalig / af en toe / continu]": "",
    "[symptomen]": "",
    "[acties en resultaten]": "",
    "[onderhoud / instellingen / onderdelen / software]": "",

    "[ontbrekende informatie]": "",
    "[vragen]": "",
    "[oorzaak]": "",
    "[oorzaken]": "",
    "[feiten uit melding en kennisbron]": "",
    "[zekerheid analyse hoog / gemiddeld / laag]": "",

    "[zoekvraag]": "",
    "[zoektermen]": "",
    "[bronnen]": "",
    "[documentnaam, documentnummer en versie]": "",
    "[map of koppeling]": "",
    "[datum van bron]": "",
    "[relevantie van zoekresultaat hoog / gemiddeld / laag]": "",
    "[conceptadvies]": "",
    "[documentnaam, documentnummer, versie, paragraaf of pagina]": "",
    "[afwijkingen of onzekerheden]": ""
  }`;

const callDetails = JSON.parse(jsonStringTemplate);

function showMissingDetails() {
    missingDetails.replaceChildren();
    let fieldNumber = 1;

    for (let [key, value] of Object.entries(callDetails)) {
        if (value != null && String(value).trim() !== "") {
            continue;
        }

        let row = document.createElement("div");
        let label = document.createElement("label");
        let input = document.createElement("input");

        row.className = "missing-details-row";

        input.type = "text";
        input.name = key;
        input.id = "missing-field-" + fieldNumber;
        fieldNumber++;

        label.htmlFor = input.id;
        label.textContent = key.slice(1, -1) + ":"; //remove the surrounding square brackets

        // Save manual values without rebuilding the form while the user types.
        input.addEventListener("input", function () {
            callDetails[key] = input.value;
        });

        row.append(label, input);
        missingDetails.appendChild(row);
    }
}

showMissingDetails();

function fillCallDate(date) {
    const day = date.toLocaleDateString("en-GB").replaceAll("/", "-");
    const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    callDetails["[datum]"] = day;
    callDetails["[datum / tijd]"] = `${day} / ${time}`;
}

async function fillReportFromTranscript(text) {
    reportModelSelect.disabled = true;
    try {
        const response = await fetch("/extract-report", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript: text, model: reportModelSelect.value }),
        });
        if (!response.ok) {
            throw new Error("Automatic filling failed. Complete the remaining details manually.");
        }
        const result = await response.json();
        for (const [key, value] of Object.entries(result.fields)) {
            // Keep anything Harm has already entered for this call.
            if (Object.hasOwn(callDetails, key) && typeof value === "string" && !callDetails[key].trim()) {
                callDetails[key] = value;
            }
        }
        return result.warning;
    } catch (error) {
        return "Automatic filling is unavailable. Complete the remaining details manually.";
    } finally {
        reportModelSelect.disabled = false;
    }
}

async function submitCallData() {
    if (recordingSessionActive) {
        return;
    }
    missingDetailsSubmitButton.disabled = true;
    startButton.disabled = true;

    try {
        const docxGeneratorResponse = await fetch("/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                transcript: JSON.stringify(callDetails),
            }),
        });

        if (!docxGeneratorResponse.ok) {
            throw new Error("Document generation failed.");
        }

        // get the response file from the python script and assign a URL to it
        const responseFile = await docxGeneratorResponse.blob();
        const fileDownloadUrl = URL.createObjectURL(responseFile);

        // download generated file
        const fileDownloadLink = document.createElement("a");
        fileDownloadLink.href = fileDownloadUrl;
        fileDownloadLink.download =
            docxGeneratorResponse.headers.get("filename");
        document.body.appendChild(fileDownloadLink);
        fileDownloadLink.click();
        fileDownloadLink.remove();

        // remove temp URL after download start
        setTimeout(() => URL.revokeObjectURL(fileDownloadUrl), 1000);
    } catch (error) {
        alert(error.message);
    } finally {
        missingDetailsSubmitButton.disabled = false;
        startButton.disabled = false;
    }
}

missingDetailsSubmitButton.addEventListener("click", submitCallData);

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

async function transcribeRecording(files) {
    const formData = new FormData();

    formData.append("harm", files.harm, "harm.wav"); //add harm's mic recording

    if (files.caller !== undefined) {
        formData.append("caller", files.caller, "caller.wav");
    }

    let response;

    try {
        response = await fetch("/transcribe", {
            method: "POST",
            body: formData,
        });
    } catch {
        //fetch only throws when the request never reached the server
        throw new Error(
            "The recording could not be uploaded. Check that the server is running and press Start again.",
        );
    }

    if (!response.ok) {
        throw new Error(await readServerError(response));
    }

    const result = await response.json();
    return result;
}

function showTranscriptionInfo(info) {
    const channels = Object.entries(info);
    const showChannelNames = channels.length > 1;
    const lines = [];

    for (const [speaker, details] of channels) {
        const deviceLabel =
            details.device === "cuda" ? "GPU (CUDA)" : "CPU";
        const modelLabel =
            details.model.charAt(0).toUpperCase() + details.model.slice(1);
        const channelLabel = showChannelNames ? `${speaker}: ` : "";

        lines.push(`${channelLabel}${deviceLabel}, Size: ${modelLabel}`);
    }

    transcriptionInfo.textContent =
        `Transcription Model Info: ${lines.join(" | ")}`;
    transcriptionInfo.hidden = false;
}

function clearTranscriptionInfo() {
    transcriptionInfo.textContent = "";
    transcriptionInfo.hidden = true;
}

//build a readable message from a failed server response
async function readServerError(response) {
    let detail = "";

    try {
        const body = await response.json();
        if (typeof body.detail === "string") {
            detail = body.detail; //FastAPI puts the HTTPException message in "detail"
        }
    } catch {
        //the response had no JSON body, keep the generic message
    }

    let message =
        "The server could not transcribe the recording (error " +
        response.status +
        ").";
    if (detail !== "") {
        message = message + " " + detail;
    }

    return message;
}

//make Start available again after a recording session ends
function resetRecordingControls() {
    recordingSessionActive = false;
    stopRequested = false;
    missingDetailsSubmitButton.disabled = false;

    connectionStatus.textContent = "Connection: Not connected";

    startButton.disabled = false;
    stopButton.disabled = true;

    includeCaller.disabled = false;

    microphoneSelect.disabled = false;
    listMicrophonesButton.disabled = false;
}

function showError(message) {
    showState("error");
    activityMessage.textContent = message;
}

function handleUnexpectedStop(error, files) {
    clearTranscriptionInfo();
    resetRecordingControls();

    if (error !== null) {
        showError(error.message);
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
                "Recording your microphone and Windows system audio";
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
        showError("List the microphones and choose one before the recording");
        return;
    }

    recordingSessionActive = true;
    stopRequested = false;
    missingDetailsSubmitButton.disabled = true;
    clearRecordingReview();
    clearTranscriptionInfo();

    startButton.disabled = true;
    stopButton.disabled = true;

    includeCaller.disabled = true;

    microphoneSelect.disabled = true;
    listMicrophonesButton.disabled = true;

    activityMessage.textContent = "Please allow microphone access";
    if (includeCaller.checked) {
        activityMessage.textContent =
            "Choose Entire Screen, enable Share system audio, and allow microphone access";
    }

    try {
        //try to start recorder
        await startWavRecording(
            handleUnexpectedStop,
            includeCaller.checked,
            selectedMicrophoneId,
        );

        if (recordingStartedAt !== null) {
            // Each new recording gets its own report, not values from the previous call.
            Object.assign(callDetails, JSON.parse(jsonStringTemplate));
            transcript.value = "";
        }
        recordingStartedAt = new Date();
        fillCallDate(recordingStartedAt);
        showMissingDetails();
        missingDetailsSubmitButton.disabled = true;

        connectionStatus.textContent = "Connection: Connected";
        stopButton.disabled = false;

        showState("recording");
    } catch (error) {
        resetRecordingControls();
        showError(error.message);
    }
});

// Stop capture and let the user review audio before choosing to download it.
stopButton.addEventListener("click", async function () {
    if (recordingSessionActive === false || stopRequested === true) {
        return;
    }

    stopRequested = true;
    stopButton.disabled = true;
    missingDetailsSubmitButton.disabled = true;

    showState("processing");

    try {
        //stop recording and create the wav audio
        const files = await stopWavRecording();

        showRecordingReview(files);

        const transcriptionResult = await transcribeRecording(files); // upload both recordings and receive4 the combined transcript

        transcript.value = transcriptionResult.text;
        showTranscriptionInfo(transcriptionResult.transcription_info);

        callDetails["[transcriptie]"] = transcriptionResult.text;
        const warning = transcriptionResult.text.trim()
            ? await fillReportFromTranscript(transcriptionResult.text)
            : "No speech was transcribed. Complete the report manually.";
        showMissingDetails();

        resetRecordingControls();

        showState("completed");
        activityMessage.textContent =
            warning ?? "Call processed. Fill in any remaining details, then click Generate.";
    } catch (error) {
        //reset the interface if recording cant be stopped or transcribed
        clearTranscriptionInfo();
        resetRecordingControls();
        showError(error.message);
    }
});

//save the microphone selected by the user
function saveSelectedMicrophone() {
    const selectedMicrophoneId = microphoneSelect.value;

    //empty value means no microphone is selected
    if (selectedMicrophoneId === "") {
        localStorage.removeItem(microphonePreferenceKey);
        return;
    }

    //save microphone id in the browser
    localStorage.setItem(microphonePreferenceKey, selectedMicrophoneId);
}

//restore saved microphone if its still connected
function restoreSavedMicrophone() {
    const savedMicrophoneId = localStorage.getItem(microphonePreferenceKey);

    //there is no preference to restore
    if (savedMicrophoneId === null) {
        return;
    }

    let savedMicrophoneFound = false;

    //check every option in the microphone dropdown
    for (const microphoneOption of microphoneSelect.options) {
        if (microphoneOption.value === savedMicrophoneId) {
            savedMicrophoneFound = true;
        }
    }

    if (savedMicrophoneFound === true) {
        //select microphone saved by the user
        microphoneSelect.value = savedMicrophoneId;
    } else {
        //remove saved value if mic is unavailable
        localStorage.removeItem(microphonePreferenceKey);
    }
}

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

        //restore saved selection after creating all options
        restoreSavedMicrophone();

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

//save preference whenever selection changes
microphoneSelect.addEventListener("change", function () {
    saveSelectedMicrophone();
});

//if preference exists, restore it when the page is reopened
if (localStorage.getItem(microphonePreferenceKey) !== null) {
    listMicrophones();
}
