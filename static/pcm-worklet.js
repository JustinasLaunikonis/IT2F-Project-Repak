class PcmRecorder extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = new Float32Array(4096);
        this.length = 0;
        this.frames = 0;
        this.active = true;
        this.port.onmessage = ({ data }) => {
            if (data === "stop") this.finish();
        };
    }

    flush() {
        if (!this.length) return;
        const chunk = this.buffer.slice(0, this.length);
        this.port.postMessage({ chunk }, [chunk.buffer]);
        this.length = 0;
    }

    finish() {
        if (!this.active) return;
        this.active = false;
        this.flush();
        this.port.postMessage({ done: true });
    }

    process(inputs) {
        if (!this.active) return false;
        const input = inputs[0][0];
        if (input) {
            for (const sample of input) {
                this.buffer[this.length++] = sample;
                this.frames++;
                if (this.length === this.buffer.length) this.flush();
                if (this.frames >= sampleRate * 30 * 60) {
                    this.finish();
                    return false;
                }
            }
        }
        // Output remains silent: never play the microphone through the speakers.
        return true;
    }
}

registerProcessor("pcm-recorder", PcmRecorder);
