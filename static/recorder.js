import { encodeWav } from "./wav.js";

// This file only handles audio capture for IT2F-33.
// The page controls and status messages can call these exported functions later.

let activeRecording = null;
let latestWav = null;
let latestWavDownloaded = true;

function stopAllTracks(streams) {
    for (let streamIndex = 0; streamIndex < streams.length; streamIndex++) {
        const tracks = streams[streamIndex].getTracks();

        for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
            tracks[trackIndex].stop();
        }
    }
}

function anyTrackEnded(streams) {
    for (let streamIndex = 0; streamIndex < streams.length; streamIndex++) {
        const tracks = streams[streamIndex].getTracks();

        for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
            if (tracks[trackIndex].readyState === "ended") {
                return true;
            }
        }
    }

    return false;
}

async function cleanUpRecording(recording) {
    stopAllTracks(recording.streams);

    if (recording.node !== null) {
        recording.node.disconnect();
    }

    if (recording.context !== null && recording.context.state !== "closed") {
        await recording.context.close();
    }
}

async function completeRecording(recording) {
    if (recording.finished) {
        return;
    }

    recording.finished = true;

    try {
        await cleanUpRecording(recording);

        if (recording.chunks.length === 0) {
            throw new Error("No audio was recorded.");
        }

        const wavData = encodeWav(recording.chunks, recording.context.sampleRate);
        latestWav = new Blob([wavData], { type: "audio/wav" });
        latestWavDownloaded = false;
        recording.resolveFinished(latestWav);
    } catch (error) {
        recording.rejectFinished(error);
    }

    recording.chunks = [];

    if (activeRecording === recording) {
        activeRecording = null;
    }
}

function requestRecordingStop(recording) {
    if (recording.stopping) {
        return;
    }

    recording.stopping = true;
    recording.node.port.postMessage("stop");
}

function stopWhenTrackEnds(recording, track) {
    track.addEventListener("ended", function () {
        if (activeRecording === recording) {
            requestRecordingStop(recording);
        }
    });
}

function connectAudioStream(recording, stream) {
    const audioTracks = stream.getAudioTracks();
    const audioStream = new MediaStream(audioTracks);
    const source = recording.context.createMediaStreamSource(audioStream);
    const gain = recording.context.createGain();

    // Each source uses half gain so their combined signal has headroom.
    gain.gain.value = 0.5;
    source.connect(gain);
    gain.connect(recording.node);
    recording.sources.push(source);
    recording.gains.push(gain);

    const tracks = stream.getTracks();
    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
        stopWhenTrackEnds(recording, tracks[trackIndex]);
    }
}

function checkBrowserSupport() {
    if (!navigator.mediaDevices) {
        throw new Error("This browser does not support audio recording.");
    }

    if (!navigator.mediaDevices.getDisplayMedia) {
        throw new Error("This browser does not support shared audio capture.");
    }

    if (!navigator.mediaDevices.getUserMedia) {
        throw new Error("This browser does not support microphone capture.");
    }

    if (!window.AudioWorkletNode) {
        throw new Error("This browser does not support AudioWorklet.");
    }
}

export async function startWavRecording() {
    if (activeRecording !== null) {
        throw new Error("A recording is already running.");
    }

    checkBrowserSupport();

    const recording = {
        chunks: [],
        context: null,
        finished: false,
        finishedPromise: null,
        gains: [],
        node: null,
        rejectFinished: null,
        resolveFinished: null,
        sources: [],
        stopping: false,
        streams: [],
    };

    activeRecording = recording;

    try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            systemAudio: "include",
            video: true,
        });
        recording.streams.push(displayStream);

        if (displayStream.getAudioTracks().length === 0) {
            throw new Error("The selected source did not provide shared audio.");
        }

        const microphoneStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
        });
        recording.streams.push(microphoneStream);

        if (anyTrackEnded(recording.streams)) {
            throw new Error("An audio source disconnected during setup.");
        }

        recording.context = new AudioContext();
        await recording.context.audioWorklet.addModule("/static/pcm-worklet.js");
        recording.node = new AudioWorkletNode(recording.context, "pcm-recorder", {
            channelCount: 1,
            channelCountMode: "explicit",
        });

        recording.finishedPromise = new Promise(function (resolve, reject) {
            recording.resolveFinished = resolve;
            recording.rejectFinished = reject;
        });

        recording.node.port.onmessage = function (event) {
            const data = event.data;

            if (data.chunk) {
                recording.chunks.push(data.chunk);
            }

            if (data.done) {
                completeRecording(recording);
            }
        };

        recording.node.onprocessorerror = function () {
            completeRecording(recording);
        };

        for (let streamIndex = 0; streamIndex < recording.streams.length; streamIndex++) {
            connectAudioStream(recording, recording.streams[streamIndex]);
        }

        recording.node.connect(recording.context.destination);
        await recording.context.resume();

        if (anyTrackEnded(recording.streams)) {
            throw new Error("An audio source disconnected during setup.");
        }
    } catch (error) {
        await cleanUpRecording(recording);
        activeRecording = null;
        throw error;
    }
}

export function stopWavRecording() {
    if (activeRecording === null) {
        return Promise.reject(new Error("No recording is running."));
    }

    const recording = activeRecording;
    requestRecordingStop(recording);
    return recording.finishedPromise;
}

export function getLatestWav() {
    return latestWav;
}

export function markLatestWavDownloaded() {
    latestWavDownloaded = true;
}

window.addEventListener("beforeunload", function (event) {
    const recordingIsRunning = activeRecording !== null;
    const wavNeedsDownload = latestWav !== null && !latestWavDownloaded;

    if (recordingIsRunning || wavNeedsDownload) {
        event.preventDefault();
        event.returnValue = "";
    }
});

window.addEventListener("pagehide", function () {
    if (activeRecording !== null) {
        cleanUpRecording(activeRecording);
    }
});
