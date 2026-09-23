import { encodeWav } from "./wav.js";

let activeRecording = null;

function stopTracks(streams) {
    for (const stream of streams) {
        for (const track of stream.getTracks()) {
            track.stop();
        }
    }
}

async function cleanUp(recording) {
    stopTracks(recording.streams);
    for (const node of recording.nodes) {
        node.disconnect();
    }
    if (recording.context !== null && recording.context.state !== "closed") {
        await recording.context.close();
    }
}

async function finish(recording) {
    if (recording.finished) {
        return;
    }
    recording.finished = true;
    try {
        await cleanUp(recording);
        if (recording.error !== null) {
            throw recording.error;
        }
        if (recording.harmChunks.length === 0 || recording.callerChunks.length === 0) {
            throw new Error("Both audio sources must contain audio. Check the microphone and shared audio.");
        }
        const harmData = encodeWav(recording.harmChunks, 16000);
        const callerData = encodeWav(recording.callerChunks, 16000);
        const files = {
            harm: new Blob([harmData], { type: "audio/wav" }),
            caller: new Blob([callerData], { type: "audio/wav" }),
        };
        recording.resolveFinished(files);
    } catch (error) {
        recording.rejectFinished(error);
    }
    recording.harmChunks = [];
    recording.callerChunks = [];
    if (activeRecording === recording) {
        activeRecording = null;
    }
}

function requestStop(recording) {
    if (recording.stopping) {
        return;
    }
    recording.stopping = true;
    for (const node of recording.nodes) {
        node.port.postMessage("stop");
    }
}

function reportUnexpectedStop(recording) {
    if (recording.stopping || recording.unexpectedStopReported) {
        return;
    }
    recording.unexpectedStopReported = true;
    recording.finishedPromise.then(function (files) {
        if (typeof recording.onUnexpectedStop === "function") {
            recording.onUnexpectedStop(null, files);
        }
    }, function (error) {
        if (typeof recording.onUnexpectedStop === "function") {
            recording.onUnexpectedStop(error, null);
        }
    });
}

function connectSource(recording, stream, speaker) {
    const audioStream = new MediaStream(stream.getAudioTracks());
    const source = recording.context.createMediaStreamSource(audioStream);
    const node = new AudioWorkletNode(recording.context, "pcm-recorder", {
        channelCount: 1,
        channelCountMode: "explicit",
    });
    node.port.onmessage = function (event) {
        const data = event.data;
        if (data.chunk) {
            if (speaker === "harm") {
                recording.harmChunks.push(data.chunk);
            } else {
                recording.callerChunks.push(data.chunk);
            }
        }
        if (data.done) {
            if (!recording.stopping) {
                reportUnexpectedStop(recording);
                requestStop(recording);
            }
            recording.doneCount++;
            if (recording.doneCount === recording.nodes.length) {
                finish(recording);
            }
        }
    };
    node.onprocessorerror = function () {
        recording.error = new Error("Audio capture stopped unexpectedly.");
        reportUnexpectedStop(recording);
        finish(recording);
    };
    source.connect(node);
    node.connect(recording.context.destination);
    recording.nodes.push(node);
}

function watchTracks(recording, stream) {
    for (const track of stream.getTracks()) {
        track.addEventListener("ended", function () {
            if (activeRecording === recording) {
                reportUnexpectedStop(recording);
                requestStop(recording);
            }
        });
    }
}

function checkSupport() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error("This browser does not support shared audio capture.");
    }
    if (!navigator.mediaDevices.getUserMedia) {
        throw new Error("This browser does not support microphone capture.");
    }
    if (!window.AudioWorkletNode) {
        throw new Error("This browser does not support AudioWorklet.");
    }
}

function captureError(error, source) {
    if (error.name === "NotAllowedError") {
        return new Error(source + " permission was denied or sharing was cancelled.");
    }
    if (error.name === "NotFoundError") {
        return new Error("No " + source.toLowerCase() + " source was found.");
    }
    return error;
}

export async function startWavRecording(onUnexpectedStop) {
    if (activeRecording !== null) {
        throw new Error("A recording is already running.");
    }
    checkSupport();
    const recording = {
        callerChunks: [],
        context: null,
        doneCount: 0,
        error: null,
        finished: false,
        finishedPromise: null,
        harmChunks: [],
        nodes: [],
        onUnexpectedStop: onUnexpectedStop,
        rejectFinished: null,
        resolveFinished: null,
        stopping: false,
        streams: [],
        unexpectedStopReported: false,
    };
    activeRecording = recording;
    try {
        let displayStream;
        try {
            displayStream = await navigator.mediaDevices.getDisplayMedia({
                audio: true,
                systemAudio: "include",
                video: true,
            });
        } catch (error) {
            throw captureError(error, "Shared audio");
        }
        recording.streams.push(displayStream);
        if (displayStream.getAudioTracks().length === 0) {
            throw new Error("The selected screen or tab did not share audio. Enable audio sharing and choose the softphone output.");
        }
        let microphoneStream;
        try {
            microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (error) {
            throw captureError(error, "Microphone");
        }
        recording.streams.push(microphoneStream);
        if (microphoneStream.getAudioTracks().length === 0) {
            throw new Error("The selected microphone did not provide audio.");
        }
        recording.context = new AudioContext();
        if (recording.context.sampleRate < 16000) {
            throw new Error("This audio device does not support 16 kHz recording.");
        }
        await recording.context.audioWorklet.addModule("/static/pcm-worklet.js");
        recording.finishedPromise = new Promise(function (resolve, reject) {
            recording.resolveFinished = resolve;
            recording.rejectFinished = reject;
        });
        connectSource(recording, microphoneStream, "harm");
        connectSource(recording, displayStream, "caller");
        watchTracks(recording, microphoneStream);
        watchTracks(recording, displayStream);
        await recording.context.resume();
        for (const stream of recording.streams) {
            for (const track of stream.getTracks()) {
                if (track.readyState === "ended") {
                    throw new Error("An audio source disconnected during setup.");
                }
            }
        }
    } catch (error) {
        await cleanUp(recording);
        activeRecording = null;
        throw error;
    }
}

export function stopWavRecording() {
    if (activeRecording === null || activeRecording.finishedPromise === null) {
        return Promise.reject(new Error("No recording is running."));
    }
    const recording = activeRecording;
    requestStop(recording);
    return recording.finishedPromise;
}

window.addEventListener("beforeunload", function (event) {
    if (activeRecording !== null) {
        event.preventDefault();
        event.returnValue = "";
    }
});

window.addEventListener("pagehide", function () {
    if (activeRecording !== null) {
        cleanUp(activeRecording);
    }
});
