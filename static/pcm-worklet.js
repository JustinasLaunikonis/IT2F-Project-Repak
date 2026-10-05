class PcmRecorder extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.harmBuffer = new Int16Array(4096);
        this.callerBuffer = new Int16Array(4096);
        this.includeCaller = false;
        if (options && options.processorOptions) {
            this.includeCaller = options.processorOptions.includeCaller;
        }
        this.length = 0;
        this.frames = 0;
        this.active = true;
        this.sampleWeight = 0;
        this.harmTotal = 0;
        this.callerTotal = 0;
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

        const harmChunk = this.harmBuffer.slice(0, this.length);
        if (this.includeCaller) {
            const callerChunk = this.callerBuffer.slice(0, this.length);
            this.port.postMessage(
                { harmChunk: harmChunk, callerChunk: callerChunk },
                [harmChunk.buffer, callerChunk.buffer],
            );
        } else {
            this.port.postMessage({ harmChunk: harmChunk }, [harmChunk.buffer]);
        }
        this.length = 0;
    }

    addSamples(harmSample, callerSample) {
        let inputRemaining = 1;
        while (inputRemaining > 0) {
            const outputRemaining = this.sourceFramesPerOutput - this.sampleWeight;
            let weight = inputRemaining;
            if (weight > outputRemaining) {
                weight = outputRemaining;
            }
            this.harmTotal += harmSample * weight;
            this.callerTotal += callerSample * weight;
            this.sampleWeight += weight;
            inputRemaining -= weight;
            if (this.sampleWeight >= this.sourceFramesPerOutput - 0.000001) {
                const harmAverage = this.harmTotal / this.sampleWeight;
                const callerAverage = this.callerTotal / this.sampleWeight;
                this.harmBuffer[this.length] = this.convertSample(harmAverage);
                this.callerBuffer[this.length] = this.convertSample(callerAverage);
                this.length++;
                this.harmTotal = 0;
                this.callerTotal = 0;
                this.sampleWeight = 0;
                if (this.length === this.harmBuffer.length) {
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
            const harmAverage = this.harmTotal / this.sampleWeight;
            const callerAverage = this.callerTotal / this.sampleWeight;
            this.harmBuffer[this.length] = this.convertSample(harmAverage);
            this.callerBuffer[this.length] = this.convertSample(callerAverage);
            this.length++;
        }
        this.flush();
        this.port.postMessage({ done: true });
    }

    process(inputs, outputs) {
        if (!this.active) {
            return false;
        }

        let harmInput = null;
        let callerInput = null;
        if (inputs[0] && inputs[0].length > 0) {
            harmInput = inputs[0][0];
        }
        if (inputs[1] && inputs[1].length > 0) {
            callerInput = inputs[1][0];
        }
        // The output defines elapsed time even when either input is missing.
        const blockLength = outputs[0][0].length;
        for (let sampleIndex = 0; sampleIndex < blockLength; sampleIndex++) {
            let harmSample = 0;
            let callerSample = 0;
            if (harmInput !== null && sampleIndex < harmInput.length) {
                harmSample = harmInput[sampleIndex];
            }
            if (callerInput !== null && sampleIndex < callerInput.length) {
                callerSample = callerInput[sampleIndex];
            }
            this.addSamples(harmSample, callerSample);
            this.frames++;
            if (this.frames >= sampleRate * 120 * 60) {
                this.finish();
                return false;
            }
        }

        // No samples are written to the output, so the microphone is not played back.
        return true;
    }
}

registerProcessor("pcm-recorder", PcmRecorder);
