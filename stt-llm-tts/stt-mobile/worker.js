/**
 * worker.js — Whisper WASM Web Worker (classic, not module)
 *
 * Runs inside a Web Worker (requires COOP/COEP headers for SharedArrayBuffer / pthreads).
 * Manages the whisper.cpp WASM module and the loaded model.
 *
 * Message protocol (postMessage):
 *
 *   Main → Worker:
 *     { type: 'load', modelUrl: string }
 *       → downloads model, initialises WASM, replies { type: 'ready' }
 *
 *     { type: 'transcribe', id: string|number, pcm: Float32Array,
 *       lang?: string, threads?: number }
 *       → runs Whisper, replies { type: 'result', id, text: string }
 *       → on error:     { type: 'error',  id, message: string }
 *
 *     { type: 'unload' }
 *       → frees the whisper context and removes model from FS
 *
 *   Worker → Main:
 *     { type: 'ready' }
 *     { type: 'progress', value: 0–1 }
 *     { type: 'result',   id, text }
 *     { type: 'error',    id?, message }
 */

/* global WhisperModule */

// Relative path to the built JS glue — resolved relative to the worker script URL.
const WASM_JS_URL = new URL('./pkg/libwhisper.js', self.location.href).href;

// Model file name inside the Emscripten virtual FS
const MODEL_FS_PATH = '/whisper.bin';
const MODEL_CACHE_NAME = 'whisper-model-v1';

// ── State ────────────────────────────────────────────────────────────────────

let wasmModule = null;    // initialised WhisperModule
let ctxHandle = 0;   // whisper context handle (>0 when loaded)
let modelLoaded = false;
let transcribing = false;

// ── Helpers ──────────────────────────────────────────────────────────────────

function post(msg, transfer) {
    if (transfer) {
        self.postMessage(msg, transfer);
    } else {
        self.postMessage(msg);
    }
}

async function fetchModel(url) {
    // Check Cache API first
    try {
        const cache = await caches.open(MODEL_CACHE_NAME);
        const cached = await cache.match(url);
        if (cached) {
            const buf = await cached.arrayBuffer();
            post({ type: 'progress', value: 1 });
            return new Uint8Array(buf);
        }
    } catch (_) {}

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch model: ${response.status} ${response.statusText}`);
    }

    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (total > 0) {
                post({ type: 'progress', value: received / total });
            }
        }
    } finally {
        reader.releaseLock();
    }

    const buffer = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
    }

    // Write to Cache API for next time
    try {
        const cache = await caches.open(MODEL_CACHE_NAME);
        await cache.put(url, new Response(buffer.buffer));
    } catch (_) {}

    return buffer;
}

// ── WASM module initialisation ───────────────────────────────────────────────

async function initModule() {
    if (wasmModule !== null) return;

    // importScripts runs in global scope — var WhisperModule becomes self.WhisperModule
    importScripts(WASM_JS_URL);

    wasmModule = await WhisperModule({
        print:    (t) => {},
        printErr: () => {},
        locateFile: (path) => new URL(`./pkg/${path}`, self.location.href).href,
        mainScriptUrlOrBlob: WASM_JS_URL,
    });
}

// ── Load model ───────────────────────────────────────────────────────────────

async function loadModel(modelUrl) {
    if (modelLoaded) {
        post({ type: 'ready' });
        return;
    }

    try {
        post({ type: 'progress', value: 0 });
        await initModule();

        const modelBytes = await fetchModel(modelUrl);

        try { wasmModule.FS.unlink(MODEL_FS_PATH); } catch (_) {}
        wasmModule.FS.writeFile(MODEL_FS_PATH, modelBytes);

        ctxHandle = wasmModule.whisper_init(MODEL_FS_PATH);
        if (ctxHandle === 0) {
            throw new Error('whisper_init() returned 0 — model file may be corrupt or wrong format');
        }

        modelLoaded = true;
        post({ type: 'ready' });
    } catch (err) {
        post({ type: 'error', message: `load failed: ${err.message}` });
    }
}

// ── Transcribe ───────────────────────────────────────────────────────────────

async function transcribe(id, pcm, lang = 'en', threads = 4) {
    if (!modelLoaded || ctxHandle === 0) {
        post({ type: 'error', id, message: 'Model not loaded. Send { type: "load", modelUrl } first.' });
        return;
    }

    if (transcribing) {
        post({ type: 'error', id, message: 'Busy: transcription already in progress.' });
        return;
    }

    transcribing = true;
    try {
        const text = wasmModule.whisper_transcribe(ctxHandle, pcm, lang, threads);
        post({ type: 'result', id, text: text.trim() });
    } catch (err) {
        post({ type: 'error', id, message: `transcribe failed: ${err.message}` });
    } finally {
        transcribing = false;
    }
}

// ── Message handler ───────────────────────────────────────────────────────────

self.onmessage = async (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
        case 'load':
            if (!msg.modelUrl) {
                post({ type: 'error', message: 'load: missing modelUrl' });
                return;
            }
            await loadModel(msg.modelUrl);
            break;

        case 'transcribe':
            if (!msg.pcm || !(msg.pcm instanceof Float32Array)) {
                post({ type: 'error', id: msg.id, message: 'transcribe: pcm must be a Float32Array' });
                return;
            }
            await transcribe(msg.id, msg.pcm, msg.lang || 'en', msg.threads || 4);
            break;

        case 'unload':
            if (ctxHandle !== 0 && wasmModule !== null) {
                wasmModule.whisper_free(ctxHandle);
                ctxHandle = 0;
                modelLoaded = false;
                try { wasmModule.FS.unlink(MODEL_FS_PATH); } catch (_) {}
            }
            break;

        default:
            console.warn('[whisper worker] unknown message type:', msg.type);
    }
};
