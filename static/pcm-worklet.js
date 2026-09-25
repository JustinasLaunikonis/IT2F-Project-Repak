class PcmRecorder extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = new Int16Array(4096);
        this.length = 0;
        this.frames = 0;
        this.active = true;
        this.sampleWeight = 0;
        this.sampleTotal = 0;
        this.sourceFramesPerOutput = sampleRate / 16000;

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

    addSample(sample) {
        let inputRemaining = 1;
        while (inputRemaining > 0) {
            const outputRemaining = this.sourceFramesPerOutput - this.sampleWeight;
            let weight = inputRemaining;
            if (weight > outputRemaining) {
                weight = outputRemaining;
            }
            this.sampleTotal += sample * weight;
            this.sampleWeight += weight;
            inputRemaining -= weight;
            if (this.sampleWeight >= this.sourceFramesPerOutput - 0.000001) {
                const average = this.sampleTotal / this.sampleWeight;
                this.buffer[this.length] = this.convertSample(average);
                this.length++;
                this.sampleTotal = 0;
                this.sampleWeight = 0;
                if (this.length === this.buffer.length) {
                    this.flush();
                }
            }
        }
    }

    finish() {
        if (!this.active) {
            return;
        }

        this.active = false;
        if (this.sampleWeight > 0) {
            const average = this.sampleTotal / this.sampleWeight;
            this.buffer[this.length] = this.convertSample(average);
            this.length++;
        }
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
                this.addSample(input[sampleIndex]);
                this.frames++;

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
