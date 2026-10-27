import { encodeWav } from "./wav.js";

let activeRecording = null;

function stopTracks(streams) {
    for (const stream of streams) {
        for (const track of stream.getTracks()) {
            track.stop();
        }
    }
}

function stopLiveTimer(recording) {
    if (recording.live !== null && recording.live.timer !== null) {
        clearInterval(recording.live.timer);
        recording.live.timer = null;
    }
}

// Cut the samples recorded since the previous cut into one WAV chunk per source.
// The start time comes from counted samples, so it matches the full WAV files.
function emitLiveChunks(recording, isFinal) {
    if (recording.live === null) {
        return;
    }

    const sources = { harm: recording.harmChunks };
    if (recording.includeCaller) {
        sources.caller = recording.callerChunks;
    }

    for (const [speaker, chunks] of Object.entries(sources)) {
        const sent = recording.live.sent[speaker];
        const newChunks = chunks.slice(sent.chunkCount);
        let sampleCount = 0;
        for (const chunk of newChunks) {
            sampleCount += chunk.length;
        }
        if (sampleCount === 0) {
            continue;
        }

        const liveChunk = {
            speaker: speaker,
            startSeconds: sent.sampleCount / 16000,
            durationSeconds: sampleCount / 16000,
            wav: new Blob([encodeWav(newChunks, 16000)], { type: "audio/wav" }),
            isFinal: isFinal,
        };
        sent.chunkCount = chunks.length;
        sent.sampleCount += sampleCount;

        try {
            recording.live.onLiveChunk(liveChunk);
        } catch (error) {
            //a broken callback must not stop the recording itself
            console.error(error);
        }
    }
}

async function cleanUp(recording) {
    stopLiveTimer(recording);
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
        //send the audio recorded since the last live chunk
        emitLiveChunks(recording, true);
        if (recording.harmChunks.length === 0) {
            throw new Error(
                "The microphone recording contains no audio. Check the microphone and try again.",
            );
        }
        if (recording.includeCaller && recording.callerChunks.length === 0) {
            throw new Error(
                "The caller recording contains no audio. Check the shared audio and try again.",
            );
        }
        const harmData = encodeWav(recording.harmChunks, 16000);
        const files = {
            harm: new Blob([harmData], { type: "audio/wav" }),
        };
        if (recording.includeCaller) {
            const callerData = encodeWav(recording.callerChunks, 16000);
            files.caller = new Blob([callerData], { type: "audio/wav" });
        }
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
    //no new live chunks after stop, finish() sends the rest once
    stopLiveTimer(recording);
    for (const node of recording.nodes) {
        node.port.postMessage("stop");
    }
}

function reportUnexpectedStop(recording) {
    if (recording.stopping || recording.unexpectedStopReported) {
        return;
    }
    recording.unexpectedStopReported = true;
    recording.finishedPromise.then(
        function (files) {
            if (typeof recording.onUnexpectedStop === "function") {
                recording.onUnexpectedStop(null, files);
            }
        },
        function (error) {
            if (typeof recording.onUnexpectedStop === "function") {
                recording.onUnexpectedStop(error, null);
            }
        },
    );
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

function checkSupport(includeCaller) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("This browser does not support microphone capture.");
    }
    if (includeCaller && !navigator.mediaDevices.getDisplayMedia) {
        throw new Error("This browser does not support shared audio capture.");
    }
    if (!window.AudioWorkletNode) {
        throw new Error("This browser does not support AudioWorklet.");
    }
}

//turn getUserMedia/getDisplayMedia exceptions into messages the user can act on
function captureError(error, source) {
    if (source === "Microphone") {
        if (error.name === "NotAllowedError" || error.name === "SecurityError") {
            return new Error(
                "Microphone access was denied. Allow microphone access in the browser and press Start again.",
            );
        }
        if (error.name === "NotFoundError") {
            return new Error(
                "No microphone was found. Connect a microphone and press Start again.",
            );
        }
        if (error.name === "OverconstrainedError") {
            return new Error(
                "Selected microphone is no longer available. List the microphones and choose another one.",
            );
        }
        if (error.name === "NotReadableError" || error.name === "AbortError") {
            return new Error(
                "The microphone could not be started. Close other programs using it and press Start again.",
            );
        }
        return error;
    }

    if (error.name === "NotAllowedError") {
        return new Error(
            "Sharing the caller audio was denied or cancelled. Press Start again and choose a source to share.",
        );
    }
    if (error.name === "NotFoundError") {
        return new Error(
            "No caller audio source was found. Press Start again and choose a source to share.",
        );
    }
    if (error.name === "NotReadableError" || error.name === "AbortError") {
        return new Error(
            "The caller audio could not be captured. Press Start again and choose another source.",
        );
    }
    return error;
}

// liveOptions is optional: { onLiveChunk(chunk), chunkSeconds }. Every chunkSeconds the
// new audio of each source is passed to onLiveChunk, and the rest once after stopping.
export async function startWavRecording(
    onUnexpectedStop,
    includeCaller = false,
    microphoneDeviceId,
    liveOptions,
) {
    if (activeRecording !== null) {
        throw new Error("A recording is already running.");
    }

    if (!microphoneDeviceId) {
        throw new Error("Choose a microphone before recording.");
    }

    checkSupport(includeCaller);
    const recording = {
        callerChunks: [],
        context: null,
        doneCount: 0,
        error: null,
        finished: false,
        finishedPromise: null,
        harmChunks: [],
        includeCaller: includeCaller,
        live: null,
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
        let displayStream = null;
        if (includeCaller) {
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
                throw new Error(
                    "The selected source did not provide audio. In Chrome, choose Entire Screen and enable Share system audio, then try again.",
                );
            }
        }
        let microphoneStream;
        try {
            microphoneStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    //use the microphone selected by user
                    deviceId: {
                        exact: microphoneDeviceId,
                    },
                },
            });
        } catch (error) {
            throw captureError(error, "Microphone");
        }
        recording.streams.push(microphoneStream);
        if (microphoneStream.getAudioTracks().length === 0) {
            throw new Error("The selected microphone did not provide audio.");
        }
        recording.context = new AudioContext();
        if (recording.context.sampleRate < 16000) {
            throw new Error(
                "This audio device does not support 16 kHz recording.",
            );
        }
        await recording.context.audioWorklet.addModule(
            "/static/pcm-worklet.js",
        );
        recording.finishedPromise = new Promise(function (resolve, reject) {
            recording.resolveFinished = resolve;
            recording.rejectFinished = reject;
        });
        connectSource(recording, microphoneStream, "harm");
        watchTracks(recording, microphoneStream);
        if (includeCaller) {
            connectSource(recording, displayStream, "caller");
            watchTracks(recording, displayStream);
        }
        await recording.context.resume();
        for (const stream of recording.streams) {
            for (const track of stream.getTracks()) {
                if (track.readyState === "ended") {
                    throw new Error(
                        "An audio source disconnected during setup.",
                    );
                }
            }
        }
        if (liveOptions && typeof liveOptions.onLiveChunk === "function") {
            recording.live = {
                onLiveChunk: liveOptions.onLiveChunk,
                sent: {
                    harm: { chunkCount: 0, sampleCount: 0 },
                    caller: { chunkCount: 0, sampleCount: 0 },
                },
                timer: null,
            };
            const chunkSeconds = liveOptions.chunkSeconds || 5;
            recording.live.timer = setInterval(function () {
                if (!recording.stopping) {
                    emitLiveChunks(recording, false);
                }
            }, chunkSeconds * 1000);
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
