// noinspection RedundantIfStatementJS

import { startWavRecording, stopWavRecording } from "./recorder.js"; //these functions come from recorder.js
import {
    addFailureMarker,
    addSegments,
    formatTimestamp,
    formatTranscript,
    hasSpokenText,
    replaceFailureMarker,
} from "./live-transcript.js";

const activityStatus = document.getElementById("activity-status");
const activityMessage = document.getElementById("activity-message");
const connectionStatus = document.getElementById("connection-status");
const transcript = document.getElementById("transcript");
const transcriptionInfo = document.getElementById("transcription-info");
const liveLag = document.getElementById("live-lag");
const liveError = document.getElementById("live-error");

const startButton = document.getElementById("start-button");
const stopButton = document.getElementById("stop-button");
const retryButton = document.getElementById("retry-button");

const uploadHarmInput = document.getElementById("upload-harm-file");
const uploadCallerInput = document.getElementById("upload-caller-file");
const uploadButton = document.getElementById("upload-button");
const uploadError = document.getElementById("upload-error");

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
const harmSaveControls = findSaveControls("harm", harmDownload);
const callerSaveControls = findSaveControls("caller", callerDownload);
const missingDetails = document.getElementById("missing-details-form");
const missingDetailsSubmitButton = document.getElementById(
    "missing-details-submit-button",
);
const extractFieldsButton = document.getElementById("extract-fields-button");

const microphoneSelect = document.getElementById("microphone-select");
const reportModelSelect = document.getElementById("report-model-select");
const downloadModelButton = document.getElementById("download-report-model");
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
let callLoadedBefore = false;
let savedRecording = null;
let savedCallSource = null;
let savedTranscript = null;
let savedLiveSession = null; //live chunks of the saved recording, used for retries
let retryStep = null;
let processingCall = false; //prevents processing the same call more than once at the time

function updateRetryButton() {
    const canRetry = savedRecording !== null && retryStep !== null;

    retryButton.hidden = !canRetry;

    //dont allow retry while recording or processing
    retryButton.disabled = processingCall || recordingSessionActive;

    if (retryStep === "transcription") {
        retryButton.textContent = "Retry transcription";
    } else if (retryStep === "report") {
        retryButton.textContent = "Retry filling report";
    }
}

// Audio is sent for live transcription in pieces of this many seconds.
const liveChunkSeconds = 5;
// Tell the user when the live transcript falls this far behind the recording.
const liveLagWarningSeconds = 15;
let liveSession = null;

async function loadReportModels() {
    try {
        const response = await fetch("/report-models");
        if (!response.ok) throw new Error("Models could not be loaded.");
        const result = await response.json();
        for (const model of result.models) {
            const option = document.createElement("option");
            option.value = model.name;
            option.textContent = `${model.label}${model.installed ? "" : " (not installed)"}`;
            option.title = model.memory;
            option.dataset.installed = model.installed;
            reportModelSelect.appendChild(option);
        }
        reportModelSelect.value = result.default;
        if (result.total_vram == null) {
            reportModelHelp.textContent = "GPU VRAM could not be detected. No model size recommendation available.";
        } else {
            const recommendation = result.recommended || "None";
            reportModelHelp.textContent = `Total GPU VRAM: ${result.total_vram.toFixed(1)} GB. Recommended model: ${recommendation} (1 GB free for buffer).`;
        }
    } catch (error) {
        reportModelSelect.value = "none";
        reportModelHelp.textContent = "Model information could not be loaded.";
    } finally {
        reportModelSelect.disabled = false;
    }
}

loadReportModels();

function showModelDownload() {
    downloadModelButton.hidden = reportModelSelect.selectedOptions[0].dataset.installed !== "false";
}

extractFieldsButton.addEventListener("click", async () => {
    if (recordingSessionActive || reportModelSelect.disabled) return;
    if (!transcript.value.trim()) {
        activityMessage.textContent = "Enter a transcript before extracting fields.";
        return;
    }
    // Each retry starts fresh, keeping only the transcript and call date.
    Object.assign(callDetails, JSON.parse(jsonStringTemplate), {
        "[datum]": callDetails["[datum]"],
        "[datum / tijd]": callDetails["[datum / tijd]"],
        "[transcriptie]": transcript.value,
    });
    showMissingDetails();
    activityMessage.textContent = "Extracting fields...";
    const warning = await fillReportFromTranscript(transcript.value);
    showMissingDetails();
    activityMessage.textContent = warning ?? "Fields extracted. Complete any remaining details.";
});

reportModelSelect.addEventListener("change", showModelDownload);

downloadModelButton.addEventListener("click", async function () {
    await fetch(`/report-models/download?model=${encodeURIComponent(reportModelSelect.value)}`, {
        method: "POST",
    });
    alert("Refresh the page after a few minutes to see whether the model downloaded successfully.");
});

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

transcript.addEventListener("input", function () {
    callDetails["[transcriptie]"] = transcript.value;
});

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
    const time = date.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
    });
    callDetails["[datum]"] = day;
    callDetails["[datum / tijd]"] = `${day} / ${time}`;
}

async function fillReportFromTranscript(text) {
    extractFieldsButton.disabled = true;
    reportModelSelect.disabled = true;
    startButton.disabled = true;
    missingDetailsSubmitButton.disabled = true;
    transcript.readOnly = true;
    try {
        //reuse successful live chunks, a transcription retry sends only the failed chunks
        if (savedTranscript === null || retryStep === "transcription") {
            retryStep = "transcription";

            if (savedCallSource === "upload") {
                activityMessage.textContent =
                    "Transcribing the uploaded audio. Long files can take several minutes.";

                savedTranscript = await transcribeUploadedAudio(savedRecording);
            } else {
                activityMessage.textContent = "Finishing the live transcript";

                savedTranscript = await finishLiveTranscript(savedLiveSession);
            }

            callDetails["[transcriptie]"] = savedTranscript;
        }
        const result = await response.json();
        for (const [key, value] of Object.entries(result.fields)) {
            // Keep call metadata and any details entered while extraction runs.
            if (Object.hasOwn(callDetails, key) && typeof value === "string" && !callDetails[key].trim()) {
                callDetails[key] = value;
            }
        }

        retryStep = null;

        if (savedCallSource === "upload") {
            showState("completed");
            activityMessage.textContent = message;
        } else {
            if (savedLiveSession.failedChunks.length > 0) {
                retryStep = "transcription";
            }

            showState("completed");
            activityMessage.textContent = completedMessage(savedLiveSession, message);
        }
    } catch (error) {
        let message;

        if (retryStep === "transcription" && savedCallSource === "upload") {
            message =
                "Transcription of the uploaded file failed. " +
                "Click Retry transcription to try again.";
        } else if (retryStep === "transcription") {
            message =
                "Transcription failed. Your recording is still available. " +
                "Click Retry transcription.";
        } else {
            message =
                "The report could not be filled. Your recording and " +
                "transcript are still available. Click Retry filling report.";
        }

        showError(message + " " + error.message);
    } finally {
        extractFieldsButton.disabled = false;
        reportModelSelect.disabled = false;
        startButton.disabled = recordingSessionActive;
        missingDetailsSubmitButton.disabled = recordingSessionActive;
        transcript.readOnly = false;
    }
}

retryButton.addEventListener("click", async function () {
    await processSavedRecording();
});

function savedCallHasSpeech() {
    if (savedCallSource === "upload") {
        return savedTranscript.trim() !== "";
    }

    return hasSpokenText(savedLiveSession.entries);
}

function setUploadControlsDisabled(disabled) {
    uploadHarmInput.disabled = disabled;
    uploadCallerInput.disabled = disabled;
    uploadButton.disabled = disabled;
}

function showUploadError(message) {
    uploadError.textContent = message;
    uploadError.hidden = false;
}

function hideUploadError() {
    uploadError.textContent = "";
    uploadError.hidden = true;
}

function getChosenFile(fileInput) {
    if (fileInput.files.length === 0) {
        return null;
    }

    return fileInput.files[0];
}

function isWavFile(file) {
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith(".wav")) {
        return true;
    }

    return false;
}

async function transcribeUploadedAudio(files) {
    const formData = new FormData();
    formData.append("harm", files.harm, files.harm.name);

    if (files.caller !== undefined) {
        formData.append("caller", files.caller, files.caller.name);
    }

    let response;

    try {
        response = await fetch("/transcribe", {
            method: "POST",
            body: formData,
        });
    } catch {
        throw new Error(
            "The audio file could not be uploaded. " +
                "Check that the file still exists and that the server is running.",
        );
    }

    if (!response.ok) {
        throw new Error(await readServerError(response, "this file"));
    }

    const result = await response.json();

    transcript.value = result.text;
    showTranscriptionInfo(result.transcription_info);

    return result.text;
}

async function submitCallData() {
    if (recordingSessionActive || processingCall) {
        return;
    }

    processingCall = true;
    updateRetryButton();

    missingDetailsSubmitButton.disabled = true;
    startButton.disabled = true;
    setUploadControlsDisabled(true);

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
        processingCall = false;
        missingDetailsSubmitButton.disabled = false;
        startButton.disabled = false;
        setUploadControlsDisabled(false);
        updateRetryButton();
    }
}

missingDetailsSubmitButton.addEventListener("click", submitCallData);

function findSaveControls(prefix, downloadLink) {
    const controls = {
        defaultName: prefix,
        downloadLink: downloadLink,
        saveButton: document.getElementById(prefix + "-save-button"),
        panel: document.getElementById(prefix + "-save-panel"),
        fileNameInput: document.getElementById(prefix + "-filename"),
        confirmButton: document.getElementById(prefix + "-save-confirm"),
        cancelButton: document.getElementById(prefix + "-save-cancel"),
        errorMessage: document.getElementById(prefix + "-filename-error"),
    };

    return controls;
}

function isForbiddenFileNameCharacter(character) {
    const forbiddenCharacters = "<>:\"/\\|?*";

    if (forbiddenCharacters.includes(character)) {
        return true;
    }

    if (character.charCodeAt(0) < 32) {
        return true;
    }

    return false;
}
 
function trimDotsAndSpaces(name) {
    let start = 0;
    let end = name.length;

    while (start < end && (name[start] === "." || name[start] === " ")) {
        start++;
    }

    while (end > start && (name[end - 1] === "." || name[end - 1] === " ")) {
        end--;
    }

    return name.slice(start, end);
}

function cleanAudioFileName(typedName) {
    const maximumLength = 100;
    let name = typedName.trim();

    let safeName = "";
    for (const character of name) {
        if (isForbiddenFileNameCharacter(character)) {
            safeName = safeName + "-";
        } else {
            safeName = safeName + character;
        }
    }
    name = trimDotsAndSpaces(safeName);

    if (name.length > maximumLength) {
        name = name.slice(0, maximumLength);
        name = trimDotsAndSpaces(name);
    }

    while (name.toLowerCase().endsWith(".wav")) {
        name = name.slice(0, name.length - ".wav".length);
        name = trimDotsAndSpaces(name);
    }

    return name;
}

function showFileNameError(controls, message) {
    controls.errorMessage.textContent = message;
    controls.errorMessage.hidden = false;
}

function hideFileNameError(controls) {
    controls.errorMessage.textContent = "";
    controls.errorMessage.hidden = true;
}

function openSavePanel(controls) {
    hideFileNameError(controls);
    controls.saveButton.hidden = true;
    controls.panel.hidden = false;

    controls.fileNameInput.focus();
    controls.fileNameInput.select();
}

function closeSavePanel(controls) {
    hideFileNameError(controls);
    controls.panel.hidden = true;
    controls.saveButton.hidden = false;

    controls.saveButton.focus();
}

function downloadAudio(controls) {
    const fileName = cleanAudioFileName(controls.fileNameInput.value);

    if (fileName === "") {
        showFileNameError(controls, "Enter a file name before downloading.");
        return;
    }

    controls.downloadLink.download = fileName + ".wav";
    controls.downloadLink.click();

    closeSavePanel(controls);
}

function resetSaveControls(controls) {
    controls.panel.hidden = true;
    controls.saveButton.hidden = false;
    hideFileNameError(controls);
    controls.fileNameInput.value = controls.defaultName;
    controls.downloadLink.download = controls.defaultName + ".wav";
}

function setUpSaveControls(controls) {
    controls.saveButton.addEventListener("click", function () {
        openSavePanel(controls);
    });

    controls.confirmButton.addEventListener("click", function () {
        downloadAudio(controls);
    });

    controls.cancelButton.addEventListener("click", function () {
        closeSavePanel(controls);
    });

    controls.fileNameInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
            event.preventDefault();
            downloadAudio(controls);
        }
    });
}

setUpSaveControls(harmSaveControls);
setUpSaveControls(callerSaveControls);

function clearRecordingReview() {
    recordingReview.hidden = true;
    callerReview.hidden = true;
    harmPreview.removeAttribute("src");
    callerPreview.removeAttribute("src");
    harmDownload.removeAttribute("href");
    callerDownload.removeAttribute("href");
    resetSaveControls(harmSaveControls);
    resetSaveControls(callerSaveControls);

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

function showUploadedAudioReview(files) {
    showRecordingReview(files);

    harmSaveControls.saveButton.hidden = true;
    callerSaveControls.saveButton.hidden = true;
}

function createLiveSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }
    return Date.now() + "-" + Math.random().toString(16).slice(2);
}

function startLiveSession() {
    liveSession = {
        id: createLiveSessionId(),
        entries: [], //transcript lines and failure markers in spoken order
        info: {}, //Whisper model and device per speaker
        queue: Promise.resolve(), //chunks are sent one after another
        pendingChunks: [],
        failedChunks: [],
        nextChunkId: 1,
        recordedSeconds: 0,
    };
    liveLag.hidden = true;
    liveError.hidden = true;
    liveError.textContent = "";
    return liveSession;
}

async function sendLiveChunk(session, chunk) {
    const formData = new FormData();
    formData.append("audio", chunk.wav, "chunk.wav");
    formData.append("speaker", chunk.speaker);
    formData.append("start_seconds", String(chunk.startSeconds));
    formData.append("session_id", session.id);

    let response;

    try {
        response = await fetch("/transcribe-chunk", {
            method: "POST",
            body: formData,
        });
    } catch {
        //fetch only throws when the request never reached the server
        throw new Error("The audio could not be uploaded. Check that the server is running.");
    }

    if (!response.ok) {
        throw new Error(await readServerError(response, "this part"));
    }

    const result = await response.json();
    const speaker = chunk.speaker === "harm" ? "Harm" : "Caller";
    session.info[speaker] = { model: result.model, device: result.device };
    return result;
}

function showLiveTranscript(session) {
    //ignore late answers that belong to an earlier recording
    if (session !== liveSession) {
        return;
    }

    transcript.value = formatTranscript(session.entries);
    transcript.scrollTop = transcript.scrollHeight;

    //keep Harm before Caller, like the transcription info after recording
    const info = {};
    for (const speaker of ["Harm", "Caller"]) {
        if (session.info[speaker] !== undefined) {
            info[speaker] = session.info[speaker];
        }
    }
    if (Object.keys(info).length > 0) {
        showTranscriptionInfo(info);
    }
}

function showLiveLag(session) {
    if (session !== liveSession) {
        return;
    }

    let behindSeconds = 0;
    for (const chunk of session.pendingChunks) {
        behindSeconds = Math.max(behindSeconds, session.recordedSeconds - chunk.startSeconds);
    }

    if (behindSeconds >= liveLagWarningSeconds) {
        liveLag.textContent =
            "The live transcript is about " +
            Math.round(behindSeconds) +
            " seconds behind the recording.";
        liveLag.hidden = false;
    } else {
        liveLag.hidden = true;
    }
}

function showLiveError(session, chunk, error) {
    if (session !== liveSession) {
        return;
    }

    const speaker = chunk.speaker === "harm" ? "Harm" : "Caller";
    const end = chunk.startSeconds + chunk.durationSeconds;
    liveError.textContent =
        speaker +
        "'s audio from " +
        formatTimestamp(chunk.startSeconds) +
        " to " +
        formatTimestamp(end) +
        " could not be transcribed. " +
        error.message.replace(/([^.!?])$/, "$1.") + //server details have no full stop
        " The recording continues, and this part is tried again after you stop.";
    liveError.hidden = false;
}

// Called by the recorder for every new piece of audio, also while recording.
function queueLiveChunk(session, chunk) {
    chunk.id = session.nextChunkId;
    session.nextChunkId++;
    session.pendingChunks.push(chunk);
    session.recordedSeconds = Math.max(
        session.recordedSeconds,
        chunk.startSeconds + chunk.durationSeconds,
    );
    showLiveLag(session);

    session.queue = session.queue.then(async function () {
        try {
            const result = await sendLiveChunk(session, chunk);
            addSegments(session.entries, result.segments);
        } catch (error) {
            //keep the text received so far and mark the missing part
            session.failedChunks.push(chunk);
            addFailureMarker(session.entries, chunk);
            showLiveError(session, chunk, error);
        } finally {
            session.pendingChunks.splice(session.pendingChunks.indexOf(chunk), 1);
            showLiveTranscript(session);
            showLiveLag(session);
        }
    });
}

function endLiveSession(session) {
    if (session === null) {
        return Promise.resolve();
    }
    //lets the server unload Whisper, for example before the report model runs
    return fetch("/live/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: session.id }),
    }).catch(function () {
        //the server also unloads the model after a minute without audio
    });
}

// Wait for the last chunks, retry failed chunks once, and return the final text.
async function finishLiveTranscript(session) {
    let queue;
    do {
        queue = session.queue;
        await queue;
    } while (queue !== session.queue);

    const retries = session.failedChunks;
    session.failedChunks = [];
    for (const chunk of retries) {
        try {
            const result = await sendLiveChunk(session, chunk);
            replaceFailureMarker(session.entries, chunk.id, result.segments);
        } catch {
            session.failedChunks.push(chunk);
        }
    }

    if (session.failedChunks.length === 0) {
        liveError.hidden = true;
    }
    showLiveTranscript(session);
    await endLiveSession(session);
    return formatTranscript(session.entries);
}

function completedMessage(session, warning) {
    let message =
        warning ?? "Call processed. Fill in any remaining details, then click Generate.";
    const failures = session.failedChunks.length;
    if (failures === 1) {
        message =
            "1 part of the recording could not be transcribed and is marked in the transcript. " +
            message;
    } else if (failures > 1) {
        message =
            failures +
            " parts of the recording could not be transcribed and are marked in the transcript. " +
            message;
    }
    return message;
}

function showTranscriptionInfo(info) {
    const channels = Object.entries(info);
    const showChannelNames = channels.length > 1;
    const lines = [];

    for (const [speaker, details] of channels) {
        const deviceLabel = details.device === "cuda" ? "GPU (CUDA)" : "CPU";
        const modelLabel =
            details.model.charAt(0).toUpperCase() + details.model.slice(1);
        const channelLabel = showChannelNames ? `${speaker}: ` : "";

        lines.push(`${channelLabel}${deviceLabel}, Size: ${modelLabel}`);
    }

    transcriptionInfo.textContent = `Transcription Model Info: ${lines.join(" | ")}`;
    transcriptionInfo.hidden = false;
}

function clearTranscriptionInfo() {
    transcriptionInfo.textContent = "";
    transcriptionInfo.hidden = true;
}

//build a readable message from a failed server response
//audioDescription is "this part" for a live chunk or "this file" for an upload
async function readServerError(response, audioDescription) {
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
        "The server could not transcribe " +
        audioDescription +
        " (error " +
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

    setUploadControlsDisabled(false);

    updateRetryButton();
}

function showError(message) {
    showState("error");
    activityMessage.textContent = message;
}

async function handleUnexpectedStop(error, files) {
    const session = liveSession;
    //Stop cannot be used while the last live chunks are finished
    stopRequested = true;
    stopButton.disabled = true;

    if (error !== null || session === null) {
        clearTranscriptionInfo();
        endLiveSession(session);
    } else {
        callDetails["[transcriptie]"] = await finishLiveTranscript(session);
    }
    resetRecordingControls();

    if (error !== null) {
        showError(error.message);
        return;
    }

    savedRecording = files;
    savedCallSource = "recording";
    savedLiveSession = session;
    savedTranscript = null;
    retryStep = "transcription";

    showRecordingReview(files);

    showError(
        "An audio source disconnected. Review the available recording, " +
            "then click Retry transcription to process it",
    );

    updateRetryButton();
}

window.addEventListener("pagehide", clearRecordingReview);

window.addEventListener("pagehide", function () {
    //closing the tab while recording, let the server unload Whisper straight away
    if (recordingSessionActive && liveSession !== null) {
        const body = new Blob([JSON.stringify({ session_id: liveSession.id })], {
            type: "application/json",
        });
        navigator.sendBeacon("/live/end", body);
    }
});

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
    if (recordingSessionActive || processingCall) {
        return;
    }

    const selectedMicrophoneId = microphoneSelect.value; //get id of the microphone chosen by user

    if (selectedMicrophoneId === "") {
        showError("List the microphones and choose one before the recording");
        return;
    }

    //ask before replacing the previous recording
    if (savedRecording !== null) {
        const replaceRecording = window.confirm(
            "Starting a new recording replaces the saved call. " +
                "Save the current audio first if you want to keep it. " +
                "Continue?",
        );

        if (!replaceRecording) {
            return;
        }
    }

    recordingSessionActive = true;
    stopRequested = false;
    updateRetryButton();
    missingDetailsSubmitButton.disabled = true;

    startButton.disabled = true;
    stopButton.disabled = true;

    includeCaller.disabled = true;

    microphoneSelect.disabled = true;
    listMicrophonesButton.disabled = true;

    setUploadControlsDisabled(true);
    hideUploadError();

    activityMessage.textContent = "Please allow microphone access";
    if (includeCaller.checked) {
        activityMessage.textContent =
            "Choose Entire Screen, enable Share system audio, and allow microphone access";
    }

    //a saved call can still be retried if the new recording does not start
    const previousSession = liveSession;
    const session = startLiveSession();

    try {
        //try to start recorder, new audio is transcribed every few seconds
        await startWavRecording(
            handleUnexpectedStop,
            includeCaller.checked,
            selectedMicrophoneId,
            {
                onLiveChunk: function (chunk) {
                    queueLiveChunk(session, chunk);
                },
                chunkSeconds: liveChunkSeconds,
            },
        );

        //clear the previous call only afrer when recording starts
        savedRecording = null;
        savedCallSource = null;
        savedTranscript = null;
        savedLiveSession = null;
        retryStep = null;

        clearRecordingReview();
        clearTranscriptionInfo();
        updateRetryButton();

        if (callLoadedBefore) {
            // Each new recording gets its own report, not values from the previous call.
            Object.assign(callDetails, JSON.parse(jsonStringTemplate));
        }
        callLoadedBefore = true;
        transcript.value = "";
        recordingStartedAt = new Date();
        fillCallDate(recordingStartedAt);
        showMissingDetails();
        missingDetailsSubmitButton.disabled = true;

        connectionStatus.textContent = "Connection: Connected";
        stopButton.disabled = false;

        showState("recording");
    } catch (error) {
        liveSession = previousSession;
        resetRecordingControls();
        updateRetryButton();
        showError(error.message);
    }
});

// Stop capture and let the user review audio before choosing to download it.
stopButton.addEventListener("click", async function () {
    if (
        recordingSessionActive === false ||
        stopRequested === true ||
        processingCall
    ) {
        return;
    }

    stopRequested = true;
    stopButton.disabled = true;
    missingDetailsSubmitButton.disabled = true;

    showState("processing");
    const session = liveSession;

    try {
        //stop recording and create the wav audio, the last live chunks are queued now
        const files = await stopWavRecording();

        //keep the audio before sending it to the server
        savedRecording = files;
        savedCallSource = "recording";
        savedLiveSession = session;
        savedTranscript = null;
        retryStep = "transcription";

        showRecordingReview(files);
        resetRecordingControls();

        //the live text is final, only the remaining and failed chunks are transcribed
        await processSavedRecording();
    } catch (error) {
        //reset the interface if recording cant be stopped, the live text stays visible
        clearTranscriptionInfo();
        endLiveSession(session);
        resetRecordingControls();
        showError(error.message);
        updateRetryButton();
    }
});

function checkUploadFile(file, description) {
    if (!isWavFile(file)) {
        return "The " + description + " must be a WAV file.";
    }

    if (file.size === 0) {
        return "The " + description + " is empty.";
    }

    return null;
}

uploadButton.addEventListener("click", async function () {
    if (recordingSessionActive || processingCall) {
        return;
    }

    hideUploadError();

    const harmFile = getChosenFile(uploadHarmInput);
    const callerFile = getChosenFile(uploadCallerInput);

    if (harmFile === null) {
        showUploadError("Choose a microphone (Harm) audio file before clicking Transcribe file.");
        return;
    }

    const harmProblem = checkUploadFile(harmFile, "microphone (Harm) file");
    if (harmProblem !== null) {
        showUploadError(harmProblem);
        return;
    }

    if (callerFile !== null) {
        const callerProblem = checkUploadFile(callerFile, "caller file");
        if (callerProblem !== null) {
            showUploadError(callerProblem);
            return;
        }
    }

    if (savedRecording !== null) {
        const replaceCall = window.confirm(
            "Transcribing a file replaces the saved call. " +
                "Save the current audio first if you want to keep it. " +
                "Continue?",
        );

        if (!replaceCall) {
            return;
        }
    }

    const files = { harm: harmFile };
    if (callerFile !== null) {
        files.caller = callerFile;
    }

    liveSession = null;
    liveLag.hidden = true;
    liveError.hidden = true;
    liveError.textContent = "";

    clearRecordingReview();
    clearTranscriptionInfo();

    if (callLoadedBefore) {
        Object.assign(callDetails, JSON.parse(jsonStringTemplate));
    }
    callLoadedBefore = true;
    transcript.value = "";
    showMissingDetails();

    savedRecording = files;
    savedCallSource = "upload";
    savedLiveSession = null;
    savedTranscript = null;
    retryStep = "transcription";

    showUploadedAudioReview(files);

    await processSavedRecording();
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
