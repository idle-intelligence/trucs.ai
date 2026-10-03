/* @ts-self-types="./lean.d.ts" */

/**
 * A JS-shareable abort switch for `generateStream`/`chatGenerate`: JS holds
 * the same `AbortFlag` it passed into the call (e.g. from a "stop" button's
 * click handler) and calls `.abort()` on it whenever it likes; the decode
 * loop checks `is_aborted()` once per generated token, between GPU
 * dispatches - see `generate::decode_loop`'s `should_stop` parameter. This
 * works because every `.await` inside the decode loop actually yields to
 * the browser's event loop (real GPU-readback awaits, not a synchronous
 * spin), so a click handler queued while a `generateStream` promise is
 * pending still gets to run and flip the flag before the next token.
 */
export class AbortFlag {
    static __wrap(ptr) {
        const obj = Object.create(AbortFlag.prototype);
        obj.__wbg_ptr = ptr;
        AbortFlagFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AbortFlagFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_abortflag_free(ptr, 0);
    }
    abort() {
        wasm.abortflag_abort(this.__wbg_ptr);
    }
    /**
     * A cheap `Rc` clone sharing the same underlying flag - **the value to
     * pass into `generateStream`/`chatGenerate`, not the original**.
     * wasm-bindgen destroys a by-value class argument's JS-side handle the
     * instant it crosses into wasm (`__destroy_into_raw()` in the generated
     * glue), so passing the caller's own `AbortFlag` directly would leave
     * that JS object unusable (a later `flag.abort()` call would hit a
     * freed pointer) even though the call is still in flight. Passing
     * `flag.cloneFlag()` instead keeps the caller's original object alive
     * and callable for the whole (possibly multi-second) generation, since
     * both point at the same `Rc<Cell<bool>>`.
     * @returns {AbortFlag}
     */
    cloneFlag() {
        const ret = wasm.abortflag_cloneFlag(this.__wbg_ptr);
        return AbortFlag.__wrap(ret);
    }
    /**
     * @returns {boolean}
     */
    isAborted() {
        const ret = wasm.abortflag_isAborted(this.__wbg_ptr);
        return ret !== 0;
    }
    constructor() {
        const ret = wasm.abortflag_new();
        this.__wbg_ptr = ret;
        AbortFlagFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) AbortFlag.prototype[Symbol.dispose] = AbortFlag.prototype.free;

export class LeanEngine {
    static __wrap(ptr) {
        const obj = Object.create(LeanEngine.prototype);
        obj.__wbg_ptr = ptr;
        LeanEngineFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        LeanEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_leanengine_free(ptr, 0);
    }
    /**
     * Appends `token_ids` onto the *existing* KV cache (typically just
     * after `restoreKv` from a resident-prefix snapshot, or continuing a
     * live session) instead of starting a fresh one - the "prefill(suffix)"
     * half of KV snapshot/restore. Returns the last position's logits.
     * @param {Uint32Array} token_ids
     * @param {Uint32Array} mask_bits
     * @returns {Promise<Float32Array>}
     */
    appendTokens(token_ids, mask_bits) {
        const ptr0 = passArray32ToWasm0(token_ids, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(mask_bits, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.leanengine_appendTokens(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret;
    }
    /**
     * Packs `allowed_ids` into this crate's mask-bitset format
     * (`model::build_mask_bitset`) for `mask_bits` arguments below - a
     * consumer's grammar/schema loop calls this once per step with that
     * step's allowed vocabulary, then passes the result straight through.
     * @param {Uint32Array} allowed_ids
     * @returns {Uint32Array}
     */
    buildMaskBitset(allowed_ids) {
        const ptr0 = passArray32ToWasm0(allowed_ids, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.leanengine_buildMaskBitset(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Multi-turn chat: appends `prompt` as a user turn onto the existing
     * conversation and KV cache, streams the generated reply through
     * `on_token`, then appends the assistant turn's own closing template
     * text back onto the KV cache so the next call's turn starts from an
     * exact match to what a full re-render of the conversation would
     * tokenize to.
     *
     * How the "append, don't re-prefill" part works: `chat_history` plus
     * the new user `prompt` is rendered through the *full* chat template
     * (`chat_template::render_conversation`, `add_generation_prompt =
     * true`) - this is cheap, pure-CPU jinja+tokenizer work, not a GPU
     * forward pass. That full rendering is tokenized once, and only the
     * suffix past `cache.kv_len` (i.e. the tokens this exact turn's
     * template text adds - previous turns' tokens are already resident in
     * the cache, byte-for-byte, because this same process built them) is
     * run through the model (`forward_prefill_suffix`, or `forward_prefill`
     * on the very first turn when `cache.kv_len == 0`). This is what makes
     * `chatGenerate`'s KV state, after N turns, identical to what a single
     * from-scratch `forward_prefill` over the entire rendered conversation
     * would have produced - see
     * `tests/streaming_sampling.rs::multi_turn_append_matches_full_reprefill`.
     * After the reply is generated, the same full-render-and-diff step
     * happens again (`add_generation_prompt = false` this time) to append
     * the assistant turn's closing template text (e.g. `<|im_end|>\n`) that
     * wasn't part of the generated token stream itself (generation stops
     * the moment an eos token is *predicted*, before it's ever fed back
     * into the cache).
     * @param {string} prompt
     * @param {number} max_new_tokens
     * @param {number} temperature
     * @param {number} top_k
     * @param {number} top_p
     * @param {number} repetition_penalty
     * @param {number} seed
     * @param {Uint32Array} mask_bits
     * @param {any} on_token
     * @param {AbortFlag | null} [abort]
     * @returns {Promise<string>}
     */
    chatGenerate(prompt, max_new_tokens, temperature, top_k, top_p, repetition_penalty, seed, mask_bits, on_token, abort) {
        const ptr0 = passStringToWasm0(prompt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(mask_bits, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        let ptr2 = 0;
        if (!isLikeNone(abort)) {
            _assertClass(abort, AbortFlag);
            ptr2 = abort.__destroy_into_raw();
        }
        const ret = wasm.leanengine_chatGenerate(this.__wbg_ptr, ptr0, len0, max_new_tokens, temperature, top_k, top_p, repetition_penalty, seed, ptr1, len1, on_token, ptr2);
        return ret;
    }
    /**
     * Clears the multi-turn chat history and resets the KV cache to
     * position 0 - call before starting a new conversation. `generate()`/
     * `generateStream()` never touch `chat_history` (they reset the cache
     * themselves every call), so this only needs to be called around
     * `chatGenerate` use.
     */
    chatReset() {
        const ret = wasm.leanengine_chatReset(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Same as `create()`, but also requests WebGPU's `timestamp-query`
     * feature when the adapter has it (feature detection only), so the
     * diagnostics calls below can report GPU time. Nothing else differs.
     * @returns {Promise<LeanEngine>}
     */
    static createDiag() {
        const ret = wasm.leanengine_createDiag();
        return ret;
    }
    /**
     * Requests a WebGPU adapter/device (the adapter's own limits, not
     * `wgpu::Limits::default()` - see `engine.rs::Engine::new_async`'s doc
     * comment) and builds every compute pipeline. Must be awaited before
     * any other call.
     * @returns {Promise<LeanEngine>}
     */
    static create() {
        const ret = wasm.leanengine_create();
        return ret;
    }
    /**
     * Debug only: the adapter/device features and limits this engine was
     * created with (JSON, see `Engine::adapter_report`).
     * @returns {string}
     */
    debugAdapter() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.leanengine_debugAdapter(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Debug only: a fresh prefill of `token_ids` (same as `prefillTokens`
     * with no mask) with op taps on, returning one checksum row per op
     * (JSON array, see `Engine::debug_collect`). The taps split compute
     * passes, so use it to compare runs with each other, not for timing.
     * @param {Uint32Array} token_ids
     * @returns {Promise<string>}
     */
    debugPrefill(token_ids) {
        const ptr0 = passArray32ToWasm0(token_ids, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.leanengine_debugPrefill(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Debug only: record every weight upload from now on (call before
     * `load`), so `debugVerifyUploads` can check the device copies.
     * @param {boolean} on
     */
    debugRecordUploads(on) {
        wasm.leanengine_debugRecordUploads(this.__wbg_ptr, on);
    }
    /**
     * Debug only: reads back every recorded upload and reports the buffers
     * whose device bytes differ from what was uploaded (JSON).
     * @returns {Promise<string>}
     */
    debugVerifyUploads() {
        const ret = wasm.leanengine_debugVerifyUploads(this.__wbg_ptr);
        return ret;
    }
    /**
     * Decodes `token_ids` back into text - the inverse of `tokenize`/
     * `encodeRaw`, exposed so a harness can print what a masked or restored
     * generation actually produced.
     * @param {Uint32Array} token_ids
     * @returns {string}
     */
    decodeIds(token_ids) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray32ToWasm0(token_ids, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.leanengine_decodeIds(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Decodes one token against the existing KV cache and returns the
     * argmax id, same fast path `generate()` uses internally, exposed for a
     * consumer driving its own step loop (e.g. after `restoreKv`, or with a
     * per-step mask that changes every call - a fixed mask across an entire
     * `generate()` call would not let a grammar narrow the allowed set as
     * it consumes each token). `mask_bits` is applied before argmax, in the
     * same GPU submission as the rest of the step - no extra readback.
     * @param {number} token_id
     * @param {Uint32Array} mask_bits
     * @returns {Promise<number>}
     */
    decodeStepArgmax(token_id, mask_bits) {
        const ptr0 = passArray32ToWasm0(mask_bits, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.leanengine_decodeStepArgmax(this.__wbg_ptr, token_id, ptr0, len0);
        return ret;
    }
    /**
     * JSON: device request ms, pipeline creation calls ms (all of them, in
     * total), whether pass timestamps are available, and the last `load()`'s
     * split.
     * @returns {string}
     */
    diagInfo() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.leanengine_diagInfo(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * JSON for the last `prefillTokens`/`decodeStepArgmax` call:
     * `encodeMs` (recording + submit, CPU), `waitMs` (submit to result in
     * hand), and `gpu` (`null` unless timestamps were on: `spanMs`,
     * `passSumMs`, `segments` as `[label, ms, passes]`, `unwritten`; a
     * span or segment with no written timestamp is `null`).
     * @returns {string}
     */
    diagLast() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.leanengine_diagLast(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Milliseconds for one 4-byte copy + `mapAsync` round trip with no
     * other work: the per-readback floor, and (right after `create`/`load`)
     * the time for the GPU process to drain what was queued before it.
     * @returns {Promise<number>}
     */
    diagRoundTrip() {
        const ret = wasm.leanengine_diagRoundTrip(this.__wbg_ptr);
        return ret;
    }
    /**
     * Diagnostics switches, both off by default - see `Engine::set_diag`.
     * @param {boolean} timestamps
     * @param {boolean} split
     */
    diagSet(timestamps, split) {
        wasm.leanengine_diagSet(this.__wbg_ptr, timestamps, split);
    }
    /**
     * Tokenizes raw `text` with no chat-template rendering (unlike
     * `tokenize()`) - for building a target/mask continuation from
     * arbitrary text (e.g. a fixed string a constrained-decoding test wants
     * to force), not a user chat turn.
     * @param {string} text
     * @returns {Uint32Array}
     */
    encodeRaw(text) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.leanengine_encodeRaw(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Single-turn generation like `generate()` (same chat-template
     * rendering, same fresh-KV-cache-every-call reset), but with
     * (a) sampling beyond greedy - `temperature == 0.0` takes the exact
     * same GPU-argmax path `generate()` uses, so greedy output is
     * bit-identical between the two entry points (see
     * `tests/streaming_sampling.rs::greedy_streaming_matches_whole_reply`);
     * any `temperature > 0.0` reads back full logits each step and draws
     * from `sampling::sample` (temperature/top-k/top-p/repetition-penalty,
     * seeded by `seed` for reproducibility - see `sampling.rs`); (b) an
     * `abort` flag (`AbortFlag`, optional - pass `undefined`/omit for no
     * abort support) checked once per generated token; (c) an optional
     * per-step `mask_bits` (this crate's mask-bitset format, same
     * convention as `decodeStepArgmax` - empty vec means unmasked),
     * applied identically whether sampling or greedy. `on_token` is called
     * exactly as `generate()`'s is - `on_token(id: number)` - once per
     * token, as soon as it's chosen, before that token's own forward step
     * runs.
     * @param {string} prompt
     * @param {number} max_new_tokens
     * @param {number} temperature
     * @param {number} top_k
     * @param {number} top_p
     * @param {number} repetition_penalty
     * @param {number} seed
     * @param {Uint32Array} mask_bits
     * @param {any} on_token
     * @param {AbortFlag | null} [abort]
     * @returns {Promise<string>}
     */
    generateStream(prompt, max_new_tokens, temperature, top_k, top_p, repetition_penalty, seed, mask_bits, on_token, abort) {
        const ptr0 = passStringToWasm0(prompt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(mask_bits, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        let ptr2 = 0;
        if (!isLikeNone(abort)) {
            _assertClass(abort, AbortFlag);
            ptr2 = abort.__destroy_into_raw();
        }
        const ret = wasm.leanengine_generateStream(this.__wbg_ptr, ptr0, len0, max_new_tokens, temperature, top_k, top_p, repetition_penalty, seed, ptr1, len1, on_token, ptr2);
        return ret;
    }
    /**
     * Renders `prompt` through the model's own chat template (single user
     * turn, `add_generation_prompt = true` - same shape as `lean-cli`'s
     * `--prompt` path), tokenizes it, prefills, then greedily decodes up to
     * `max_new_tokens` tokens (stopping early on any of the model's
     * `eos_token_ids`). Every decoded token id is passed to `on_token`
     * (called as `on_token(id: number)`) as soon as it's produced - a
     * no-op if `on_token` isn't a JS function. Returns the decoded
     * continuation text and prefill/decode timing.
     * @param {string} prompt
     * @param {number} max_new_tokens
     * @param {any} on_token
     * @returns {Promise<string>}
     */
    generate(prompt, max_new_tokens, on_token) {
        const ptr0 = passStringToWasm0(prompt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.leanengine_generate(this.__wbg_ptr, ptr0, len0, max_new_tokens, on_token);
        return ret;
    }
    /**
     * GPU-resident byte counts, broken down by category (see
     * `GpuModel::weight_gpu_bytes`/`KvCache::gpu_bytes`/
     * `Pool::resident_bytes`'s doc comments): `weightBytes` (fixed at
     * load, independent of context), `kvCacheBytes` (fixed at `max_ctx`,
     * independent of `kv_len`), `poolBytes` (per-forward scratch -
     * activations, RoPE tables, uniforms; settles to a fixed shape once a
     * given `(rows, kv_len-bucket)` combination has been seen once). Does
     * NOT include the wasm linear memory (`memory.buffer.byteLength`,
     * read directly from JS) or the JS-side GGUF `Uint8Array`/`Vec<u8>`
     * copies, which this method has no visibility into - a caller
     * combines this with `performance.memory`/`wasm.memory` for the full
     * picture. Added for this session's browser memory investigation
     * (docs/runs/2026-09-28-lean-decode-breakdown.md).
     * @returns {string}
     */
    gpuMemoryInfo() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.leanengine_gpuMemoryInfo(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * JSON string with basic model/device info, for a status line.
     * @returns {string}
     */
    info() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.leanengine_info(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The number of positions currently populated in the KV cache (0 right
     * after `load()` or a fresh `prefillTokens`, grows with `appendTokens`/
     * `decodeStepArgmax`, or is set directly by `restoreKv`).
     * @returns {number}
     */
    kvLen() {
        const ret = wasm.leanengine_kvLen(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Parses `gguf_bytes` (the whole GGUF file, fetched by JS, passed as a
     * `Uint8Array` view rather than a `Vec<u8>` so wasm-bindgen never has to
     * copy it into wasm linear memory up front - see `JsBytesReader`'s doc
     * comment) and uploads every weight to the GPU (two-phase loading: only
     * one tensor's raw bytes are ever resident in wasm memory at a time,
     * dropped right after that tensor's GPU upload inside
     * `GpuModel::load_from_reader`, well before `max_ctx`'s KV cache is
     * allocated). `tokenizer_json`/`tokenizer_config_json` are the two
     * files' contents as strings. `max_ctx` bounds the KV cache (prompt +
     * max_new_tokens must fit). The caller should drop its own reference to
     * `gguf_bytes`'s backing `ArrayBuffer` right after this call returns so
     * the JS heap can reclaim it too (see `www/main.js`'s call site).
     * @param {Uint8Array} gguf_bytes
     * @param {string} tokenizer_json
     * @param {string} tokenizer_config_json
     * @param {number} max_ctx
     */
    load(gguf_bytes, tokenizer_json, tokenizer_config_json, max_ctx) {
        const ptr0 = passStringToWasm0(tokenizer_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(tokenizer_config_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.leanengine_load(this.__wbg_ptr, gguf_bytes, ptr0, len0, ptr1, len1, max_ctx);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Low-level prefill over raw token ids (no chat-template rendering -
     * use `tokenize()` first if needed): resets the pool and starts a fresh
     * KV cache at position 0, runs prefill, and returns the last position's
     * logits (`vocab_size` long). `mask_bits`, if non-empty, constrains the
     * *first* generated token the same way `decodeStepArgmax`'s mask
     * constrains later ones (see `mask_buf`'s doc comment on the empty-vec
     * convention).
     * @param {Uint32Array} token_ids
     * @param {Uint32Array} mask_bits
     * @returns {Promise<Float32Array>}
     */
    prefillTokens(token_ids, mask_bits) {
        const ptr0 = passArray32ToWasm0(token_ids, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(mask_bits, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.leanengine_prefillTokens(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret;
    }
    /**
     * Restores a snapshot produced by `snapshotKv` (this session's own, or
     * one a consumer stored earlier and is handing back) into the current
     * KV cache, and sets `kvLen()` to the snapshot's length. Queued
     * `queue.write_buffer` calls only - no readback, safe to call
     * synchronously. Follow with `appendTokens` for the resumed suffix, or
     * `decodeStepArgmax` to continue decoding directly from the restored
     * prefix's last position.
     * @param {Uint8Array} bytes
     */
    restoreKv(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.leanengine_restoreKv(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Reads back the KV cache's `[0, kvLen())` prefix and returns it as
     * `KvSnapshot::to_bytes()` - a resident-prefix image a consumer can
     * store keyed by its own prompt/tool-schema hash (see this crate's
     * consumer survey, gap #1) and later hand back to `restoreKv`. Async
     * (`Engine::read_buffer`'s `into_data_async` path) - never blocks the
     * browser's main/worker thread.
     * @returns {Promise<Uint8Array>}
     */
    snapshotKv() {
        const ret = wasm.leanengine_snapshotKv(this.__wbg_ptr);
        return ret;
    }
    /**
     * Renders + tokenizes `prompt` the same way `generate()` does and
     * returns the resulting token count, with no GPU work - lets a harness
     * log a synthetic timing-only prompt's actual length (e.g. the
     * ~1000-token prefill case in `www/main.js`) without duplicating the
     * chat-template/tokenizer path in JS.
     * @param {string} prompt
     * @returns {number}
     */
    tokenCount(prompt) {
        const ptr0 = passStringToWasm0(prompt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.leanengine_tokenCount(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Renders + tokenizes `prompt` through the model's chat template, same
     * as `generate()`, but returns the raw token ids instead of running
     * generation - the low-level entry point a consumer's own prefix/suffix
     * split (e.g. a resident tool-schema prefix) is built on top of, rather
     * than `generate()`'s all-in-one path.
     * @param {string} prompt
     * @returns {Uint32Array}
     */
    tokenize(prompt) {
        const ptr0 = passStringToWasm0(prompt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.leanengine_tokenize(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
}
if (Symbol.dispose) LeanEngine.prototype[Symbol.dispose] = LeanEngine.prototype.free;

/**
 * The CPU rung's wasm-bindgen surface (`cpu.rs`): same method names/
 * argument shapes as `LeanEngine` wherever a CPU equivalent exists, so a
 * harness or a rung-selection loader can hold either behind the same call
 * sites (`create`/`load`/`generate`/`tokenize`/`prefillTokens`/
 * `decodeStepArgmax`) - see this crate's CPU-fallback plan, "same public
 * API shape so a caller can pick the rung at run time". No mask/LoRA/KV-
 * snapshot surface yet (`cpu.rs` doesn't implement those - out of scope
 * for the first CPU-rung pass). Every method here is synchronous: there is
 * no GPU readback to await, so unlike `LeanEngine` these block the calling
 * thread for the duration of the forward pass (acceptable inside a Web
 * Worker, which owns no UI work of its own).
 */
export class LeanEngineCpu {
    static __wrap(ptr) {
        const obj = Object.create(LeanEngineCpu.prototype);
        obj.__wbg_ptr = ptr;
        LeanEngineCpuFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        LeanEngineCpuFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_leanenginecpu_free(ptr, 0);
    }
    /**
     * No adapter/device to request (unlike `LeanEngine::create`) - kept as
     * a function (not a plain struct literal) for API-shape symmetry with
     * the GPU surface's `create()`.
     * @returns {LeanEngineCpu}
     */
    static create() {
        const ret = wasm.leanenginecpu_create();
        return LeanEngineCpu.__wrap(ret);
    }
    /**
     * @param {Uint32Array} token_ids
     * @returns {string}
     */
    decodeIds(token_ids) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray32ToWasm0(token_ids, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.leanenginecpu_decodeIds(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * @param {number} token_id
     * @returns {number}
     */
    decodeStepArgmax(token_id) {
        const ret = wasm.leanenginecpu_decodeStepArgmax(this.__wbg_ptr, token_id);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @param {string} text
     * @returns {Uint32Array}
     */
    encodeRaw(text) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.leanenginecpu_encodeRaw(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Same contract as `LeanEngine::generate` (render -> tokenize ->
     * prefill -> greedy decode, one `on_token` callback per token), no
     * mask support, synchronous (no `.await` inside the loop).
     * @param {string} prompt
     * @param {number} max_new_tokens
     * @param {any} on_token
     * @returns {string}
     */
    generate(prompt, max_new_tokens, on_token) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(prompt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.leanenginecpu_generate(this.__wbg_ptr, ptr0, len0, max_new_tokens, on_token);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    info() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.leanenginecpu_info(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    kvLen() {
        const ret = wasm.leanenginecpu_kvLen(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Parses `gguf_bytes` (a `Uint8Array` view, same reasoning as
     * `LeanEngine::load`) into a CPU-resident model (Q4_0/Q8_0/Q6_K tensor
     * bytes held as-is - see `cpu.rs`'s doc comment, this is the one rung
     * that legitimately needs its own resident copy of the quantized
     * bytes, since it computes directly off them) and allocates a
     * `CpuKvCache` sized to `max_ctx`. Same signature as `LeanEngine::load`
     * minus the `Result` needing to report GPU-adapter failures.
     * @param {Uint8Array} gguf_bytes
     * @param {string} tokenizer_json
     * @param {string} tokenizer_config_json
     * @param {number} max_ctx
     */
    load(gguf_bytes, tokenizer_json, tokenizer_config_json, max_ctx) {
        const ptr0 = passStringToWasm0(tokenizer_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(tokenizer_config_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.leanenginecpu_load(this.__wbg_ptr, gguf_bytes, ptr0, len0, ptr1, len1, max_ctx);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Low-level prefill over raw token ids - resets the KV cache to
     * position 0, runs prefill, returns the last position's logits. No
     * mask argument (unlike `LeanEngine::prefillTokens`) - `cpu.rs` has no
     * mask support yet.
     * @param {Uint32Array} token_ids
     * @returns {Float32Array}
     */
    prefillTokens(token_ids) {
        const ptr0 = passArray32ToWasm0(token_ids, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.leanenginecpu_prefillTokens(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * @param {string} prompt
     * @returns {number}
     */
    tokenCount(prompt) {
        const ptr0 = passStringToWasm0(prompt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.leanenginecpu_tokenCount(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @param {string} prompt
     * @returns {Uint32Array}
     */
    tokenize(prompt) {
        const ptr0 = passStringToWasm0(prompt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.leanenginecpu_tokenize(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
}
if (Symbol.dispose) LeanEngineCpu.prototype[Symbol.dispose] = LeanEngineCpu.prototype.free;

/**
 * Initializes the panic hook for readable browser-console error messages.
 * Optional but recommended: call once before `LeanEngine::create()`.
 */
export function leanInit() {
    wasm.leanInit();
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_67e7344beaa85059: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_Window_defb2c76b3875a73: function(arg0) {
            const ret = arg0.Window;
            return ret;
        },
        __wbg_WorkerGlobalScope_184e45d6565eb3f0: function(arg0) {
            const ret = arg0.WorkerGlobalScope;
            return ret;
        },
        __wbg___wbindgen_debug_string_0e68cf47c9cbd9b0: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_function_fcda5e3902d732fe: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_5160b3e381865372: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_undefined_8c687d0b90d5b524: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_string_get_92ab86bb19cbc12f: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_5d9e815e6fdf150f: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_997e73d32238e655: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_beginComputePass_1fc169dd9fc89475: function(arg0, arg1) {
            const ret = arg0.beginComputePass(arg1);
            return ret;
        },
        __wbg_buffer_4a989bded7035f57: function(arg0) {
            const ret = arg0.buffer;
            return ret;
        },
        __wbg_call_6bcf8d3e20937e46: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_copyBufferToBuffer_55e9540007aef863: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.copyBufferToBuffer(arg1, arg2, arg3, arg4);
        }, arguments); },
        __wbg_copyBufferToBuffer_7adcb79ef87447dc: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.copyBufferToBuffer(arg1, arg2, arg3, arg4, arg5);
        }, arguments); },
        __wbg_createBindGroup_0ee0646375643dfb: function(arg0, arg1) {
            const ret = arg0.createBindGroup(arg1);
            return ret;
        },
        __wbg_createBuffer_474baee88e74f68a: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.createBuffer(arg1);
            return ret;
        }, arguments); },
        __wbg_createCommandEncoder_5229e112300218b4: function(arg0, arg1) {
            const ret = arg0.createCommandEncoder(arg1);
            return ret;
        },
        __wbg_createComputePipeline_1cd8bf7e02a1a06d: function(arg0, arg1) {
            const ret = arg0.createComputePipeline(arg1);
            return ret;
        },
        __wbg_createQuerySet_595e31c333f5e833: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.createQuerySet(arg1);
            return ret;
        }, arguments); },
        __wbg_createShaderModule_744311a1dd685c14: function(arg0, arg1) {
            const ret = arg0.createShaderModule(arg1);
            return ret;
        },
        __wbg_dispatchWorkgroups_727fa35f9c69d73c: function(arg0, arg1, arg2, arg3) {
            arg0.dispatchWorkgroups(arg1 >>> 0, arg2 >>> 0, arg3 >>> 0);
        },
        __wbg_end_2398df10208cf1ee: function(arg0) {
            arg0.end();
        },
        __wbg_error_757e9472f8410341: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_features_139b41635cafee99: function(arg0) {
            const ret = arg0.features;
            return ret;
        },
        __wbg_features_3fa0fe4fc37163a7: function(arg0) {
            const ret = arg0.features;
            return ret;
        },
        __wbg_finish_7370ad1c0e62b448: function(arg0) {
            const ret = arg0.finish();
            return ret;
        },
        __wbg_finish_797b32d15bab2338: function(arg0, arg1) {
            const ret = arg0.finish(arg1);
            return ret;
        },
        __wbg_getBindGroupLayout_9fc232d022bf8cca: function(arg0, arg1) {
            const ret = arg0.getBindGroupLayout(arg1 >>> 0);
            return ret;
        },
        __wbg_getMappedRange_9f13d158ba3946fd: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.getMappedRange(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_getRandomValues_a608c4436c19407a: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_gpu_ac6dc8fb638a26c3: function(arg0) {
            const ret = arg0.gpu;
            return ret;
        },
        __wbg_has_ffcf0ac839d1b8fb: function(arg0, arg1, arg2) {
            const ret = arg0.has(getStringFromWasm0(arg1, arg2));
            return ret;
        },
        __wbg_instanceof_GpuAdapter_fb230cdccb184887: function(arg0) {
            let result;
            try {
                result = arg0 instanceof GPUAdapter;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_label_84abde6506fa15b7: function(arg0, arg1) {
            const ret = arg1.label;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_leanengine_new: function(arg0) {
            const ret = LeanEngine.__wrap(arg0);
            return ret;
        },
        __wbg_length_31bdaf014f5fbde2: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_limits_a80585efb442d985: function(arg0) {
            const ret = arg0.limits;
            return ret;
        },
        __wbg_limits_d4ef440224084d65: function(arg0) {
            const ret = arg0.limits;
            return ret;
        },
        __wbg_log_363d83b9114c8831: function(arg0) {
            console.log(arg0);
        },
        __wbg_mapAsync_3546b4b874e14738: function(arg0, arg1, arg2, arg3) {
            const ret = arg0.mapAsync(arg1 >>> 0, arg2, arg3);
            return ret;
        },
        __wbg_maxBindGroups_2fac2855adae76bb: function(arg0) {
            const ret = arg0.maxBindGroups;
            return ret;
        },
        __wbg_maxBindingsPerBindGroup_7b8b526a1900701d: function(arg0) {
            const ret = arg0.maxBindingsPerBindGroup;
            return ret;
        },
        __wbg_maxBufferSize_475dcdac4810587e: function(arg0) {
            const ret = arg0.maxBufferSize;
            return ret;
        },
        __wbg_maxColorAttachmentBytesPerSample_5a04a2d5a9e122bb: function(arg0) {
            const ret = arg0.maxColorAttachmentBytesPerSample;
            return ret;
        },
        __wbg_maxColorAttachments_2a487bb283cf8f08: function(arg0) {
            const ret = arg0.maxColorAttachments;
            return ret;
        },
        __wbg_maxComputeInvocationsPerWorkgroup_72908780df74614a: function(arg0) {
            const ret = arg0.maxComputeInvocationsPerWorkgroup;
            return ret;
        },
        __wbg_maxComputeWorkgroupSizeX_92eeefd082aefd07: function(arg0) {
            const ret = arg0.maxComputeWorkgroupSizeX;
            return ret;
        },
        __wbg_maxComputeWorkgroupSizeY_54fecee60bfa33ae: function(arg0) {
            const ret = arg0.maxComputeWorkgroupSizeY;
            return ret;
        },
        __wbg_maxComputeWorkgroupSizeZ_868f559f4eebf95f: function(arg0) {
            const ret = arg0.maxComputeWorkgroupSizeZ;
            return ret;
        },
        __wbg_maxComputeWorkgroupStorageSize_b4fd07bd827bde34: function(arg0) {
            const ret = arg0.maxComputeWorkgroupStorageSize;
            return ret;
        },
        __wbg_maxComputeWorkgroupsPerDimension_2d88e3f8e1f984fc: function(arg0) {
            const ret = arg0.maxComputeWorkgroupsPerDimension;
            return ret;
        },
        __wbg_maxDynamicStorageBuffersPerPipelineLayout_d6f0075161a2ec8e: function(arg0) {
            const ret = arg0.maxDynamicStorageBuffersPerPipelineLayout;
            return ret;
        },
        __wbg_maxDynamicUniformBuffersPerPipelineLayout_4fc01fff17019d2b: function(arg0) {
            const ret = arg0.maxDynamicUniformBuffersPerPipelineLayout;
            return ret;
        },
        __wbg_maxSampledTexturesPerShaderStage_224452301226d09a: function(arg0) {
            const ret = arg0.maxSampledTexturesPerShaderStage;
            return ret;
        },
        __wbg_maxSamplersPerShaderStage_34936f99dde7ae66: function(arg0) {
            const ret = arg0.maxSamplersPerShaderStage;
            return ret;
        },
        __wbg_maxStorageBufferBindingSize_9582c7cfe68faac0: function(arg0) {
            const ret = arg0.maxStorageBufferBindingSize;
            return ret;
        },
        __wbg_maxStorageBuffersPerShaderStage_6403069e851040db: function(arg0) {
            const ret = arg0.maxStorageBuffersPerShaderStage;
            return ret;
        },
        __wbg_maxStorageTexturesPerShaderStage_e44d7d6ed85de663: function(arg0) {
            const ret = arg0.maxStorageTexturesPerShaderStage;
            return ret;
        },
        __wbg_maxTextureArrayLayers_0f2fe636cc0fa44f: function(arg0) {
            const ret = arg0.maxTextureArrayLayers;
            return ret;
        },
        __wbg_maxTextureDimension1D_501e1e21119c564f: function(arg0) {
            const ret = arg0.maxTextureDimension1D;
            return ret;
        },
        __wbg_maxTextureDimension2D_ac594a0008180ab6: function(arg0) {
            const ret = arg0.maxTextureDimension2D;
            return ret;
        },
        __wbg_maxTextureDimension3D_8e5638a46d5786b0: function(arg0) {
            const ret = arg0.maxTextureDimension3D;
            return ret;
        },
        __wbg_maxUniformBufferBindingSize_a4c4feca62b81571: function(arg0) {
            const ret = arg0.maxUniformBufferBindingSize;
            return ret;
        },
        __wbg_maxUniformBuffersPerShaderStage_505f14dd3f814492: function(arg0) {
            const ret = arg0.maxUniformBuffersPerShaderStage;
            return ret;
        },
        __wbg_maxVertexAttributes_c4f4881b2d20616b: function(arg0) {
            const ret = arg0.maxVertexAttributes;
            return ret;
        },
        __wbg_maxVertexBufferArrayStride_da0782b779fc1a38: function(arg0) {
            const ret = arg0.maxVertexBufferArrayStride;
            return ret;
        },
        __wbg_maxVertexBuffers_90e848bae7f01af3: function(arg0) {
            const ret = arg0.maxVertexBuffers;
            return ret;
        },
        __wbg_minStorageBufferOffsetAlignment_58fcc139ce14bbb9: function(arg0) {
            const ret = arg0.minStorageBufferOffsetAlignment;
            return ret;
        },
        __wbg_minUniformBufferOffsetAlignment_33ca7570ff80f825: function(arg0) {
            const ret = arg0.minUniformBufferOffsetAlignment;
            return ret;
        },
        __wbg_navigator_d217ca64c4bbff48: function(arg0) {
            const ret = arg0.navigator;
            return ret;
        },
        __wbg_navigator_d25c0f071226f233: function(arg0) {
            const ret = arg0.navigator;
            return ret;
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_new_bebc3f4757acf305: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_ffa92086ea89f79c: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_from_slice_4ee02165f9de919e: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_typed_6f8b0d724fe26c07: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen__convert__closures_____invoke__h5e04af5e06f34f8a(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_with_byte_offset_and_length_492c969e8b5da8a4: function(arg0, arg1, arg2) {
            const ret = new Uint8Array(arg0, arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_now_b515ed7d0710d903: function() {
            const ret = performance.now();
            return ret;
        },
        __wbg_prototypesetcall_ae9f5e7459250748: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_push_bfdf956ba476f65b: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_queueMicrotask_85c90f6987555d65: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_queueMicrotask_f6a1fa10b81d1fc0: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_queue_8cb065d04b06cb13: function(arg0) {
            const ret = arg0.queue;
            return ret;
        },
        __wbg_requestAdapter_4814cb479d2dcf15: function(arg0, arg1) {
            const ret = arg0.requestAdapter(arg1);
            return ret;
        },
        __wbg_requestDevice_1b8f321791aa8b00: function(arg0, arg1) {
            const ret = arg0.requestDevice(arg1);
            return ret;
        },
        __wbg_resolveQuerySet_7dcffc077c3c8cf7: function(arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.resolveQuerySet(arg1, arg2 >>> 0, arg3 >>> 0, arg4, arg5 >>> 0);
        },
        __wbg_resolve_35ec7e0c6af4c82c: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_setBindGroup_67bd9a0c57486387: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
            arg0.setBindGroup(arg1 >>> 0, arg2, getArrayU32FromWasm0(arg3, arg4), arg5, arg6 >>> 0);
        }, arguments); },
        __wbg_setBindGroup_a2a4442ac2a0be99: function(arg0, arg1, arg2) {
            arg0.setBindGroup(arg1 >>> 0, arg2);
        },
        __wbg_setPipeline_50cfc53a5d0eb1d7: function(arg0, arg1) {
            arg0.setPipeline(arg1);
        },
        __wbg_set_9cfc0f17d60ff0af: function(arg0, arg1, arg2) {
            arg0.set(arg1, arg2 >>> 0);
        },
        __wbg_set_a377297433dfea63: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_beginning_of_pass_write_index_ddfc55f615254cc1: function(arg0, arg1) {
            arg0.beginningOfPassWriteIndex = arg1 >>> 0;
        },
        __wbg_set_binding_b575483e08d5ba4a: function(arg0, arg1) {
            arg0.binding = arg1 >>> 0;
        },
        __wbg_set_buffer_6c45652fb024e808: function(arg0, arg1) {
            arg0.buffer = arg1;
        },
        __wbg_set_code_0a82fa86cf58ca3b: function(arg0, arg1, arg2) {
            arg0.code = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_compute_dc74d722ba27aa5b: function(arg0, arg1) {
            arg0.compute = arg1;
        },
        __wbg_set_count_39e1b3c03c19b528: function(arg0, arg1) {
            arg0.count = arg1 >>> 0;
        },
        __wbg_set_end_of_pass_write_index_786588764311c9aa: function(arg0, arg1) {
            arg0.endOfPassWriteIndex = arg1 >>> 0;
        },
        __wbg_set_entries_bfbb6a7f04b96709: function(arg0, arg1) {
            arg0.entries = arg1;
        },
        __wbg_set_entry_point_3b13db51cfe0c5d6: function(arg0, arg1, arg2) {
            arg0.entryPoint = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_01228663ea03b92f: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_3341f59be0eb3205: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_382417d222111912: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_66fc1d23dd10d4f5: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_806446f85d68e201: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_8354c6463558484f: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_b3da7636c69f1a4c: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_b7f797c13bc822c4: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_e6bc3b86ef6deeb8: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_layout_44943c4c7d78f826: function(arg0, arg1) {
            arg0.layout = arg1;
        },
        __wbg_set_layout_726c6ae6f5919730: function(arg0, arg1) {
            arg0.layout = arg1;
        },
        __wbg_set_mapped_at_creation_12773dff1bb6ea0f: function(arg0, arg1) {
            arg0.mappedAtCreation = arg1 !== 0;
        },
        __wbg_set_module_af2f871a0bed003c: function(arg0, arg1) {
            arg0.module = arg1;
        },
        __wbg_set_offset_f07a73165707eb4c: function(arg0, arg1) {
            arg0.offset = arg1;
        },
        __wbg_set_power_preference_0721cf46746c0c7d: function(arg0, arg1) {
            arg0.powerPreference = __wbindgen_enum_GpuPowerPreference[arg1];
        },
        __wbg_set_query_set_aadbb433c8390a5c: function(arg0, arg1) {
            arg0.querySet = arg1;
        },
        __wbg_set_required_features_5202fa8cd082e531: function(arg0, arg1) {
            arg0.requiredFeatures = arg1;
        },
        __wbg_set_resource_c73d0c2d815f7211: function(arg0, arg1) {
            arg0.resource = arg1;
        },
        __wbg_set_size_c2a556d5571231f5: function(arg0, arg1) {
            arg0.size = arg1;
        },
        __wbg_set_size_f7b29f6cb1669c4d: function(arg0, arg1) {
            arg0.size = arg1;
        },
        __wbg_set_timestamp_writes_7fa18118aa24ddc1: function(arg0, arg1) {
            arg0.timestampWrites = arg1;
        },
        __wbg_set_type_9b9ab9961bd236f7: function(arg0, arg1) {
            arg0.type = __wbindgen_enum_GpuQueryType[arg1];
        },
        __wbg_set_usage_cc34543608cf3335: function(arg0, arg1) {
            arg0.usage = arg1 >>> 0;
        },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_static_accessor_GLOBAL_8eb4cd83130a11a0: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_1e7044f654e934db: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_d8b50611246a6d92: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_fd0bc376bf0f8b42: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_subarray_1daff70dde20c145: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_submit_fc5b9a1154201a58: function(arg0, arg1) {
            arg0.submit(arg1);
        },
        __wbg_then_114b14e3854c2390: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_7a850dae4493f353: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_b830475380919203: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbg_unmap_50b3be4aaf23fa39: function(arg0) {
            arg0.unmap();
        },
        __wbg_writeBuffer_7d54524c36f1c7e2: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.writeBuffer(arg1, arg2, arg3, arg4, arg5);
        }, arguments); },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 1609, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h12a810cacdbc5648);
            return ret;
        },
        __wbindgen_generic_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 1638, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hd28a537dae1e99b1);
            return ret;
        },
        __wbindgen_generic_0000000000000003: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_generic_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_generic_0000000000000005: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_generic_0000000000000006: function(arg0, arg1) {
            var v0 = getArrayF32FromWasm0(arg0, arg1).slice();
            wasm.__wbindgen_free(arg0, arg1 * 4, 4);
            // Cast intrinsic for `Vector(F32) -> Externref`.
            const ret = v0;
            return ret;
        },
        __wbindgen_generic_0000000000000007: function(arg0, arg1) {
            var v0 = getArrayU8FromWasm0(arg0, arg1).slice();
            wasm.__wbindgen_free(arg0, arg1 * 1, 1);
            // Cast intrinsic for `Vector(U8) -> Externref`.
            const ret = v0;
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./lean_bg.js": import0,
    };
}

function wasm_bindgen__convert__closures_____invoke__h12a810cacdbc5648(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__h12a810cacdbc5648(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__hd28a537dae1e99b1(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__hd28a537dae1e99b1(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen__convert__closures_____invoke__h5e04af5e06f34f8a(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen__convert__closures_____invoke__h5e04af5e06f34f8a(arg0, arg1, arg2, arg3);
}


const __wbindgen_enum_GpuPowerPreference = ["low-power", "high-performance"];


const __wbindgen_enum_GpuQueryType = ["occlusion", "timestamp"];
const AbortFlagFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_abortflag_free(ptr, 1));
const LeanEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_leanengine_free(ptr, 1));
const LeanEngineCpuFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_leanenginecpu_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('lean_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
