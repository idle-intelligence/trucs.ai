/**
 * AudioWorklet processor for mobile STT: captures mic input, resamples to 16kHz
 * mono, computes RMS energy for silence detection, and sends PCM chunks to the
 * main thread.
 *
 * Registered as 'mobile-audio'. Resampling uses linear interpolation, same
 * approach as the existing stt/audio-processor.js (which targets 24kHz).
 *
 * Output is buffered into 1024-sample chunks (~64ms at 16kHz) for a good
 * balance between message overhead and silence-detection responsiveness.
 */

class MobileAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._targetRate = 16000;
        this._buffer = new Float32Array(1024);
        this._writePos = 0;
        this._resamplePos = 0;
        this._active = true;

        this.port.onmessage = (e) => {
            if (e.data?.type === 'stop') this._active = false;
        };
    }

    process(inputs) {
        if (!this._active) {
            this._flush();
            return false;
        }

        const input = inputs[0];
        if (!input || !input.length) return true;
        const channel = input[0];
        if (!channel || !channel.length) return true;

        const step = sampleRate / this._targetRate;
        let srcPos = this._resamplePos;

        while (srcPos < channel.length) {
            const idx = Math.floor(srcPos);
            const frac = srcPos - idx;
            const s0 = channel[idx];
            const s1 = idx + 1 < channel.length ? channel[idx + 1] : s0;
            this._buffer[this._writePos++] = s0 + frac * (s1 - s0);

            if (this._writePos >= this._buffer.length) {
                this._flush();
            }
            srcPos += step;
        }
        this._resamplePos = srcPos - channel.length;
        return true;
    }

    _flush() {
        if (this._writePos === 0) return;
        const samples = this._buffer.slice(0, this._writePos);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        const rms = Math.sqrt(sum / samples.length);
        this.port.postMessage({ samples, rms }, [samples.buffer]);
        this._writePos = 0;
    }
}

registerProcessor('mobile-audio', MobileAudioProcessor);
