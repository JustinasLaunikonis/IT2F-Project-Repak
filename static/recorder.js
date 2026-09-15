import { encodeWav } from "./wav.js";

const start = document.querySelector("#start");
const stop = document.querySelector("#stop");
const status = document.querySelector("#status");
const timer = document.querySelector("#timer");
const preview = document.querySelector("#preview");
const download = document.querySelector("#download");
const result = document.querySelector("#result");
let session = null;
let recordingUrl = null;

function message(text, error = false) {
    status.textContent = text;
    status.dataset.error = String(error);
}

async function cleanup(current) {
    clearInterval(current.timer);
    for (const stream of current.streams) stream.getTracks().forEach(track => track.stop());
    if (current.node) current.node.disconnect();
    if (current.context && current.context.state !== "closed") await current.context.close();
}

async function finish(current, reason = "Recording saved. Preview or download your WAV file.") {
    if (current.finishing || session !== current) return;
    current.finishing = true;
    stop.disabled = true;
    message("Preparing WAV file…");
    try {
        await cleanup(current);
        if (!current.chunks.length) throw new Error("No audio was recorded. Please try again.");
        const blob = new Blob([encodeWav(current.chunks, current.context.sampleRate)], { type: "audio/wav" });
        preview.pause();
        if (recordingUrl) URL.revokeObjectURL(recordingUrl);
        recordingUrl = URL.createObjectURL(blob);
        preview.src = recordingUrl;
        download.href = recordingUrl;
        download.download = `repak-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`;
        result.hidden = false;
        message(reason);
    } catch (error) {
        message(error.message, true);
    } finally {
        current.chunks = [];
        session = null;
        start.disabled = false;
    }
}

function requestStop(reason) {
    const current = session;
    if (!current?.recording || current.stopping) return;
    current.stopping = true;
    current.reason = reason;
    stop.disabled = true;
    message("Stopping recording…");
    // The worklet flushes its last partial buffer before acknowledging stop.
    current.node.port.postMessage("stop");
}

start.addEventListener("click", async () => {
    if (session) return;
    if (!navigator.mediaDevices?.getDisplayMedia || !navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
        message("Recording is unavailable. Open this app on localhost or HTTPS in a browser with screen audio and AudioWorklet support.", true);
        return;
    }
    const current = { streams: [], chunks: [], frames: 0 };
    session = current;
    start.disabled = true;
    preview.pause();
    timer.textContent = "00:00";
    message("Choose a tab or screen and enable Share audio, then allow microphone access.");
    try {
        const display = await navigator.mediaDevices.getDisplayMedia({
            video: true, audio: true, systemAudio: "include",
        });
        current.streams.push(display);
        if (!display.getAudioTracks().length) {
            throw new Error("No shared audio was provided. Start again, choose a source that supports audio, and enable Share audio.");
        }
        const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
        current.streams.push(microphone);
        if (current.streams.some(stream => stream.getTracks().some(track => track.readyState === "ended"))) {
            throw new Error("An audio source disconnected during setup. Please start again.");
        }
        current.context = new AudioContext();
        await current.context.audioWorklet.addModule("/static/pcm-worklet.js");
        current.node = new AudioWorkletNode(current.context, "pcm-recorder", {
            channelCount: 1, channelCountMode: "explicit",
        });
        current.node.port.onmessage = ({ data }) => {
            if (data.chunk) {
                current.chunks.push(data.chunk);
                current.frames += data.chunk.length;
            }
            if (data.done) void finish(current, current.reason ?? "Recording reached the 30-minute limit. Your WAV is ready.");
        };
        current.node.onprocessorerror = () => {
            void finish(current, "Audio processing stopped unexpectedly. The captured audio is available below.");
        };
        for (const stream of current.streams) {
            const source = current.context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
            const gain = current.context.createGain();
            gain.gain.value = 0.5; // Leave headroom when summing both inputs.
            source.connect(gain).connect(current.node);
            stream.getTracks().forEach(track => track.addEventListener("ended", () => {
                requestStop("A source disconnected or sharing ended. Your captured audio is ready.");
            }));
        }
        current.node.connect(current.context.destination);
        await current.context.resume();
        if (current.streams.some(stream => stream.getTracks().some(track => track.readyState === "ended"))) {
            throw new Error("An audio source disconnected during setup. Please start again.");
        }
        current.recording = true;
        stop.disabled = false;
        message("Recording microphone + shared audio…");
        current.timer = setInterval(() => {
            const seconds = Math.floor(current.frames / current.context.sampleRate);
            timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
        }, 250);
    } catch (error) {
        await cleanup(current);
        session = null;
        start.disabled = false;
        const text = error.name === "NotAllowedError"
            ? "Recording cancelled or permission denied. Allow screen audio and microphone access to try again."
            : error.name === "NotFoundError"
                ? "No microphone was found. Connect one and try again."
                : error.message;
        message(text, true);
    }
});

stop.addEventListener("click", () => requestStop("Recording saved. Preview or download your WAV file."));
window.addEventListener("beforeunload", event => {
    if (session) {
        event.preventDefault();
        event.returnValue = "";
    }
});
window.addEventListener("pagehide", () => {
    if (session) void cleanup(session);
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
});
