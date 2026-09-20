/* tslint:disable */
/* eslint-disable */

export class T0Wasm {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * One forward pass, one signal (`v = 1`). `context` is the raw
     * (unscaled) time series; `horizon` is the number of future steps
     * requested. Returns `horizon * n_quantiles` values, time-major then
     * quantile-minor. No autoregressive rollout — same
     * `context.len() + horizon <= 1024` (padded to patch size) ceiling as
     * the native CLI (`t0_core::model::forecast_series`). Returns a
     * `Promise` (JS: `await model.forecast(...)`) on every backend, since
     * this always goes through `t0_core::forecast_async` — see this
     * module's doc comment.
     */
    forecast(context: Float32Array, horizon: number): Promise<Float32Array>;
    /**
     * Parses a GGUF byte buffer (as exported by `t0-cli export-gguf`) and
     * builds the model. Two-phase in spirit: `Weights::load_gguf_bytes`
     * dequantizes into a plain `HashMap<String, Vec<f32>>` first, then
     * `T0Model::load` copies each tensor onto the backend device and the
     * intermediate `Weights` is dropped when this function returns.
     */
    static load(gguf_bytes: Uint8Array): T0Wasm;
    /**
     * Number of trained quantile levels (5 for t0-alpha/t0-beta) — the
     * caller uses this to interpret `forecast`'s flat output as
     * `[horizon, n_quantiles]`, quantile-minor (matches `t0-cli`'s own
     * output layout, see `forecast_series` in `t0-core/src/model.rs`).
     */
    nQuantiles(): number;
}

/**
 * Must be awaited once, before `T0Wasm::load`, on every backend. On
 * `wgpu` this does the real work: `cubecl_wgpu`'s device/adapter/queue
 * setup (`requestAdapter`/`requestDevice`) is only available as an async
 * API in the browser (no blocking executor exists in WASM), so it has to
 * be driven from JS's event loop via `init_setup_async` *before* any
 * tensor touches `WgpuDevice::default()` — otherwise the first tensor op
 * falls back to a synchronous lazy-init path
 * (`cubecl_common::reader::try_read_sync`) and panics with "Failed to
 * read tensor data synchronously... this can happen on platforms that
 * don't support blocking futures like WASM" (confirmed by hitting exactly
 * that panic before this function existed). On `ndarray` this is a no-op
 * (`NdArray` has no async device setup) but is still safe/cheap to await
 * so JS doesn't need to branch on backend.
 */
export function initBackend(): Promise<void>;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_t0wasm_free: (a: number, b: number) => void;
    readonly initBackend: () => any;
    readonly t0wasm_forecast: (a: number, b: number, c: number, d: number) => any;
    readonly t0wasm_load: (a: number, b: number) => [number, number, number];
    readonly t0wasm_nQuantiles: (a: number) => number;
    readonly wasm_bindgen__convert__closures_____invoke__h156bf3764d385c09: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__hb4bfe5504ef865b6: (a: number, b: number, c: any, d: any) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
