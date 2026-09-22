class PcmRecorder extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = new Int16Array(4096);
        this.length = 0;
        this.frames = 0;
        this.active = true;

        const recorder = this;
        this.port.onmessage = function (event) {
            if (event.data === "stop") {
                recorder.finish();
            }
        };
    }

    convertSample(sample) {
        let safeSample = sample;

        if (safeSample < -1) {
            safeSample = -1;
        } else if (safeSample > 1) {
            safeSample = 1;
        }

        if (safeSample < 0) {
            return Math.round(safeSample * 32768);
        }

        return Math.round(safeSample * 32767);
    }

    flush() {
        if (this.length === 0) {
            return;
        }

        const chunk = this.buffer.slice(0, this.length);
        this.port.postMessage({ chunk: chunk }, [chunk.buffer]);
        this.length = 0;
    }

    finish() {
        if (!this.active) {
            return;
        }

        this.active = false;
        this.flush();
        this.port.postMessage({ done: true });
    }

    process(inputs) {
        if (!this.active) {
            return false;
        }

        const inputGroup = inputs[0];

        if (inputGroup && inputGroup.length > 0) {
            const input = inputGroup[0];

            for (let sampleIndex = 0; sampleIndex < input.length; sampleIndex++) {
                this.buffer[this.length] = this.convertSample(input[sampleIndex]);
                this.length++;
                this.frames++;

                if (this.length === this.buffer.length) {
                    this.flush();
                }

                if (this.frames >= sampleRate * 30 * 60) {
                    this.finish();
                    return false;
                }
            }
        }

        // No samples are written to the output, so the microphone is not played back.
        return true;
    }
}

registerProcessor("pcm-recorder", PcmRecorder);
