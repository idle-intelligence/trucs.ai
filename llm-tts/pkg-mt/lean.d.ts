/* tslint:disable */
/* eslint-disable */

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
    free(): void;
    [Symbol.dispose](): void;
    abort(): void;
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
     */
    cloneFlag(): AbortFlag;
    isAborted(): boolean;
    constructor();
}

export class LeanEngine {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Appends `token_ids` onto the *existing* KV cache (typically just
     * after `restoreKv` from a resident-prefix snapshot, or continuing a
     * live session) instead of starting a fresh one - the "prefill(suffix)"
     * half of KV snapshot/restore. Returns the last position's logits.
     */
    appendTokens(token_ids: Uint32Array, mask_bits: Uint32Array): Promise<Float32Array>;
    /**
     * Packs `allowed_ids` into this crate's mask-bitset format
     * (`model::build_mask_bitset`) for `mask_bits` arguments below - a
     * consumer's grammar/schema loop calls this once per step with that
     * step's allowed vocabulary, then passes the result straight through.
     */
    buildMaskBitset(allowed_ids: Uint32Array): Uint32Array;
    /**
     * Multi-turn chat: adds `prompt` as a user turn, streams the reply
     * through `on_token(id, text)` (see `TokenSink`) and returns it. The
     * reply joins the conversation for the next call. Same signature and,
     * greedy (`temperature == 0`), the same tokens on `LeanEngineCpu` -
     * `tests/chat_api.rs`.
     *
     * Each turn re-renders the whole conversation through the model's chat
     * template and runs only the ids past the longest prefix already in
     * the KV cache (`chat::ChatSession`), so the cache after N turns is
     * what one prefill of the rendered conversation would build - see
     * `tests/streaming_sampling.rs::multi_turn_append_matches_full_reprefill`.
     * Sampling, `mask_bits` and `abort` work as in `generateStream`.
     */
    chatGenerate(prompt: string, max_new_tokens: number, temperature: number, top_k: number, top_p: number, repetition_penalty: number, seed: number, mask_bits: Uint32Array, on_token: any, abort?: AbortFlag | null): Promise<string>;
    /**
     * Clears the multi-turn conversation and resets the KV cache to
     * position 0 - call before starting a new conversation. Same call on
     * `LeanEngineCpu`.
     */
    chatReset(): void;
    /**
     * Same as `create()`, but also requests WebGPU's `timestamp-query`
     * feature when the adapter has it (feature detection only), so the
     * diagnostics calls below can report GPU time. Nothing else differs.
     */
    static createDiag(): Promise<LeanEngine>;
    /**
     * Requests a WebGPU adapter/device (the adapter's own limits, not
     * `wgpu::Limits::default()` - see `engine.rs::Engine::new_async`'s doc
     * comment) and builds every compute pipeline. Must be awaited before
     * any other call.
     */
    static create(): Promise<LeanEngine>;
    /**
     * Debug only: the adapter/device features and limits this engine was
     * created with (JSON, see `Engine::adapter_report`).
     */
    debugAdapter(): string;
    /**
     * Debug only: a fresh prefill of `token_ids` (same as `prefillTokens`
     * with no mask) with op taps on, returning one checksum row per op
     * (JSON array, see `Engine::debug_collect`). The taps split compute
     * passes, so use it to compare runs with each other, not for timing.
     */
    debugPrefill(token_ids: Uint32Array): Promise<string>;
    /**
     * Debug only: record every weight upload from now on (call before
     * `load`), so `debugVerifyUploads` can check the device copies.
     */
    debugRecordUploads(on: boolean): void;
    /**
     * Debug only: reads back every recorded upload and reports the buffers
     * whose device bytes differ from what was uploaded (JSON).
     */
    debugVerifyUploads(): Promise<string>;
    /**
     * Greedy decode of `steps` forward steps from `token_id` (no EOS stop),
     * pipelined: each step is submitted before the previous step's id is
     * read back (see `model::decode_greedy_pipelined`). Returns the ids the
     * steps produced, the same as `steps` calls of `decodeStepArgmax`
     * chained on their own outputs.
     */
    decodeGreedy(token_id: number, steps: number): Promise<Uint32Array>;
    /**
     * Decodes `token_ids` back into text - the inverse of `tokenize`/
     * `encodeRaw`, exposed so a harness can print what a masked or restored
     * generation actually produced.
     */
    decodeIds(token_ids: Uint32Array): string;
    /**
     * Decodes one token against the existing KV cache and returns the
     * argmax id, same fast path `generate()` uses internally, exposed for a
     * consumer driving its own step loop (e.g. after `restoreKv`, or with a
     * per-step mask that changes every call - a fixed mask across an entire
     * `generate()` call would not let a grammar narrow the allowed set as
     * it consumes each token). `mask_bits` is applied before argmax, in the
     * same GPU submission as the rest of the step - no extra readback.
     */
    decodeStepArgmax(token_id: number, mask_bits: Uint32Array): Promise<number>;
    /**
     * JSON: device request ms, pipeline creation calls ms (all of them, in
     * total), whether pass timestamps are available, and the last `load()`'s
     * split.
     */
    diagInfo(): string;
    /**
     * JSON for the last `prefillTokens`/`decodeStepArgmax` call:
     * `encodeMs` (recording + submit, CPU), `waitMs` (submit to result in
     * hand), and `gpu` (`null` unless timestamps were on: `spanMs`,
     * `passSumMs`, `segments` as `[label, ms, passes]`, `unwritten`; a
     * span or segment with no written timestamp is `null`).
     */
    diagLast(): string;
    /**
     * Milliseconds for one 4-byte copy + `mapAsync` round trip with no
     * other work: the per-readback floor, and (right after `create`/`load`)
     * the time for the GPU process to drain what was queued before it.
     */
    diagRoundTrip(): Promise<number>;
    /**
     * Diagnostics switches, both off by default - see `Engine::set_diag`.
     */
    diagSet(timestamps: boolean, split: boolean): void;
    /**
     * Tokenizes raw `text` with no chat-template rendering (unlike
     * `tokenize()`) - for building a target/mask continuation from
     * arbitrary text (e.g. a fixed string a constrained-decoding test wants
     * to force), not a user chat turn.
     */
    encodeRaw(text: string): Uint32Array;
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
     * exactly as `generate()`'s is - `on_token(id, text)` - once per
     * token, as soon as it's chosen, before that token's own forward step
     * runs.
     */
    generateStream(prompt: string, max_new_tokens: number, temperature: number, top_k: number, top_p: number, repetition_penalty: number, seed: number, mask_bits: Uint32Array, on_token: any, abort?: AbortFlag | null): Promise<string>;
    /**
     * Renders `prompt` through the model's own chat template (single user
     * turn, `add_generation_prompt = true` - same shape as `lean-cli`'s
     * `--prompt` path), tokenizes it, prefills, then greedily decodes up to
     * `max_new_tokens` tokens (stopping early on any of the model's
     * `eos_token_ids`). Each token goes to `on_token(id, text)` as soon as
     * it's produced (see `TokenSink`; a no-op if `on_token` isn't a JS
     * function). Returns the decoded continuation text.
     */
    generate(prompt: string, max_new_tokens: number, on_token: any): Promise<string>;
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
     */
    gpuMemoryInfo(): string;
    /**
     * JSON string with basic model/device info, for a status line.
     */
    info(): string;
    /**
     * The number of positions currently populated in the KV cache (0 right
     * after `load()` or a fresh `prefillTokens`, grows with `appendTokens`/
     * `decodeStepArgmax`, or is set directly by `restoreKv`).
     */
    kvLen(): number;
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
     */
    load(gguf_bytes: Uint8Array, tokenizer_json: string, tokenizer_config_json: string, max_ctx: number): void;
    /**
     * Low-level prefill over raw token ids (no chat-template rendering -
     * use `tokenize()` first if needed): resets the pool and starts a fresh
     * KV cache at position 0, runs prefill, and returns the last position's
     * logits (`vocab_size` long). `mask_bits`, if non-empty, constrains the
     * *first* generated token the same way `decodeStepArgmax`'s mask
     * constrains later ones (see `mask_buf`'s doc comment on the empty-vec
     * convention).
     */
    prefillTokens(token_ids: Uint32Array, mask_bits: Uint32Array): Promise<Float32Array>;
    /**
     * Restores a snapshot produced by `snapshotKv` (this session's own, or
     * one a consumer stored earlier and is handing back) into the current
     * KV cache, and sets `kvLen()` to the snapshot's length. Queued
     * `queue.write_buffer` calls only - no readback, safe to call
     * synchronously. Follow with `appendTokens` for the resumed suffix, or
     * `decodeStepArgmax` to continue decoding directly from the restored
     * prefix's last position.
     */
    restoreKv(bytes: Uint8Array): void;
    /**
     * Reads back the KV cache's `[0, kvLen())` prefix and returns it as
     * `KvSnapshot::to_bytes()` - a resident-prefix image a consumer can
     * store keyed by its own prompt/tool-schema hash (see this crate's
     * consumer survey, gap #1) and later hand back to `restoreKv`. Async
     * (`Engine::read_buffer`'s `into_data_async` path) - never blocks the
     * browser's main/worker thread.
     */
    snapshotKv(): Promise<Uint8Array>;
    /**
     * Renders + tokenizes `prompt` the same way `generate()` does and
     * returns the resulting token count, with no GPU work - lets a harness
     * log a synthetic timing-only prompt's actual length (e.g. the
     * ~1000-token prefill case in `www/main.js`) without duplicating the
     * chat-template/tokenizer path in JS.
     */
    tokenCount(prompt: string): number;
    /**
     * Renders + tokenizes `prompt` through the model's chat template, same
     * as `generate()`, but returns the raw token ids instead of running
     * generation - the low-level entry point a consumer's own prefix/suffix
     * split (e.g. a resident tool-schema prefix) is built on top of, rather
     * than `generate()`'s all-in-one path.
     */
    tokenize(prompt: string): Uint32Array;
}

/**
 * The CPU backend's wasm-bindgen surface (`cpu.rs`, one thread or a
 * rayon pool in the `wasm-mt` build): same method names and argument
 * shapes as `LeanEngine` wherever a CPU equivalent exists, so a page holds
 * either behind the same call sites (`create`/`load`/`generate`/
 * `chatGenerate`/`chatReset`/`tokenize`/`decodeIds`/`prefillTokens`/
 * `decodeStepArgmax`). `chatGenerate` is async like the GPU one and yields
 * to the event loop between tokens so an `AbortFlag` can be flipped; the
 * other methods are synchronous and block the calling thread for the
 * forward pass (run them in a Web Worker). No LoRA or KV-snapshot surface
 * yet.
 */
export class LeanEngineCpu {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Same signature and behavior as `LeanEngine::chatGenerate`, on the
     * CPU KV cache (`chat::cpu_chat_turn`); greedy replies are the GPU's
     * tokens (`tests/chat_api.rs`). `mask_bits` is applied to the logits on
     * the CPU exactly as `mask_logits.wgsl` does on the GPU.
     */
    chatGenerate(prompt: string, max_new_tokens: number, temperature: number, top_k: number, top_p: number, repetition_penalty: number, seed: number, mask_bits: Uint32Array, on_token: any, abort?: AbortFlag | null): Promise<string>;
    /**
     * Same as `LeanEngine::chatReset`.
     */
    chatReset(): void;
    /**
     * No adapter/device to request (unlike `LeanEngine::create`) - kept as
     * a function (not a plain struct literal) for API-shape symmetry with
     * the GPU surface's `create()`.
     */
    static create(): LeanEngineCpu;
    decodeIds(token_ids: Uint32Array): string;
    decodeStepArgmax(token_id: number): number;
    encodeRaw(text: string): Uint32Array;
    /**
     * Same contract as `LeanEngine::generate` (render -> tokenize ->
     * prefill -> greedy decode, `on_token(id, text)` per token), no mask
     * support, synchronous (no `.await` inside the loop).
     */
    generate(prompt: string, max_new_tokens: number, on_token: any): string;
    info(): string;
    kvLen(): number;
    /**
     * Parses `gguf_bytes` (a `Uint8Array` view, same reasoning as
     * `LeanEngine::load`) into a CPU-resident model (Q4_0/Q8_0/Q6_K tensor
     * bytes held as-is - see `cpu.rs`'s doc comment, this is the one rung
     * that legitimately needs its own resident copy of the quantized
     * bytes, since it computes directly off them) and allocates a
     * `CpuKvCache` sized to `max_ctx`. Same signature as `LeanEngine::load`
     * minus the `Result` needing to report GPU-adapter failures.
     */
    load(gguf_bytes: Uint8Array, tokenizer_json: string, tokenizer_config_json: string, max_ctx: number): void;
    /**
     * Low-level prefill over raw token ids - resets the KV cache to
     * position 0, runs prefill, returns the last position's logits. No
     * mask argument (unlike `LeanEngine::prefillTokens`) - `cpu.rs` has no
     * mask support yet.
     */
    prefillTokens(token_ids: Uint32Array): Float32Array;
    tokenCount(prompt: string): number;
    tokenize(prompt: string): Uint32Array;
}

export function initThreadPool(num_threads: number): Promise<any>;

/**
 * Initializes the panic hook for readable browser-console error messages.
 * Optional but recommended: call once before `LeanEngine::create()`.
 */
export function leanInit(): void;

export class wbg_rayon_PoolBuilder {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    build(): void;
    numThreads(): number;
    receiver(): number;
}

export function wbg_rayon_start_worker(receiver: number): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly __wbg_abortflag_free: (a: number, b: number) => void;
    readonly __wbg_leanengine_free: (a: number, b: number) => void;
    readonly __wbg_leanenginecpu_free: (a: number, b: number) => void;
    readonly __wbg_wbg_rayon_poolbuilder_free: (a: number, b: number) => void;
    readonly abortflag_abort: (a: number) => void;
    readonly abortflag_cloneFlag: (a: number) => number;
    readonly abortflag_isAborted: (a: number) => number;
    readonly abortflag_new: () => number;
    readonly initThreadPool: (a: number) => any;
    readonly leanInit: () => void;
    readonly leanengine_appendTokens: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly leanengine_buildMaskBitset: (a: number, b: number, c: number) => [number, number, number, number];
    readonly leanengine_chatGenerate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: any, m: number) => any;
    readonly leanengine_chatReset: (a: number) => [number, number];
    readonly leanengine_create: () => any;
    readonly leanengine_createDiag: () => any;
    readonly leanengine_debugAdapter: (a: number) => [number, number];
    readonly leanengine_debugPrefill: (a: number, b: number, c: number) => any;
    readonly leanengine_debugRecordUploads: (a: number, b: number) => void;
    readonly leanengine_debugVerifyUploads: (a: number) => any;
    readonly leanengine_decodeGreedy: (a: number, b: number, c: number) => any;
    readonly leanengine_decodeIds: (a: number, b: number, c: number) => [number, number, number, number];
    readonly leanengine_decodeStepArgmax: (a: number, b: number, c: number, d: number) => any;
    readonly leanengine_diagInfo: (a: number) => [number, number];
    readonly leanengine_diagLast: (a: number) => [number, number];
    readonly leanengine_diagRoundTrip: (a: number) => any;
    readonly leanengine_diagSet: (a: number, b: number, c: number) => void;
    readonly leanengine_encodeRaw: (a: number, b: number, c: number) => [number, number, number, number];
    readonly leanengine_generate: (a: number, b: number, c: number, d: number, e: any) => any;
    readonly leanengine_generateStream: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: any, m: number) => any;
    readonly leanengine_gpuMemoryInfo: (a: number) => [number, number, number, number];
    readonly leanengine_info: (a: number) => [number, number];
    readonly leanengine_kvLen: (a: number) => [number, number, number];
    readonly leanengine_load: (a: number, b: any, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly leanengine_prefillTokens: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly leanengine_restoreKv: (a: number, b: number, c: number) => [number, number];
    readonly leanengine_snapshotKv: (a: number) => any;
    readonly leanengine_tokenCount: (a: number, b: number, c: number) => [number, number, number];
    readonly leanengine_tokenize: (a: number, b: number, c: number) => [number, number, number, number];
    readonly leanenginecpu_chatGenerate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: any, m: number) => any;
    readonly leanenginecpu_chatReset: (a: number) => [number, number];
    readonly leanenginecpu_create: () => number;
    readonly leanenginecpu_decodeIds: (a: number, b: number, c: number) => [number, number, number, number];
    readonly leanenginecpu_decodeStepArgmax: (a: number, b: number) => [number, number, number];
    readonly leanenginecpu_encodeRaw: (a: number, b: number, c: number) => [number, number, number, number];
    readonly leanenginecpu_generate: (a: number, b: number, c: number, d: number, e: any) => [number, number, number, number];
    readonly leanenginecpu_info: (a: number) => [number, number];
    readonly leanenginecpu_kvLen: (a: number) => [number, number, number];
    readonly leanenginecpu_load: (a: number, b: any, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly leanenginecpu_prefillTokens: (a: number, b: number, c: number) => [number, number, number, number];
    readonly leanenginecpu_tokenCount: (a: number, b: number, c: number) => [number, number, number];
    readonly leanenginecpu_tokenize: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wbg_rayon_poolbuilder_build: (a: number) => void;
    readonly wbg_rayon_poolbuilder_numThreads: (a: number) => number;
    readonly wbg_rayon_poolbuilder_receiver: (a: number) => number;
    readonly wbg_rayon_start_worker: (a: number) => void;
    readonly wasm_bindgen_5eadc5baeccbd563___convert__closures_____invoke___js_sys_4d3c6b4f7172722e___Function_fn_wasm_bindgen_5eadc5baeccbd563___JsValue_____wasm_bindgen_5eadc5baeccbd563___sys__Undefined___js_sys_4d3c6b4f7172722e___Function_fn_wasm_bindgen_5eadc5baeccbd563___JsValue_____wasm_bindgen_5eadc5baeccbd563___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_5eadc5baeccbd563___convert__closures_____invoke___wasm_bindgen_5eadc5baeccbd563___JsValue__core_47c40c249e36843c___result__Result_____wasm_bindgen_5eadc5baeccbd563___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_5eadc5baeccbd563___convert__closures_____invoke___js_sys_4d3c6b4f7172722e___futures__task__wait_async_polyfill__MessageEvent______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_5eadc5baeccbd563___convert__closures_____invoke___wasm_bindgen_5eadc5baeccbd563___JsValue______true_: (a: number, b: number, c: any) => void;
    readonly memory: WebAssembly.Memory;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_thread_destroy: (a?: number, b?: number, c?: number) => void;
    readonly __wbindgen_start: (a: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number }} module - Passing `SyncInitInput` directly is deprecated.
 * @param {WebAssembly.Memory} memory - Deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number } | SyncInitInput, memory?: WebAssembly.Memory): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number }} module_or_path - Passing `InitInput` directly is deprecated.
 * @param {WebAssembly.Memory} memory - Deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number } | InitInput | Promise<InitInput>, memory?: WebAssembly.Memory): Promise<InitOutput>;
