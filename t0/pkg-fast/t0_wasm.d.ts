/* tslint:disable */
/* eslint-disable */

export class T0Wasm {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `n_signals` independent forecasts, chunked at `chunk_size` (0 means
     * "no chunking") -- same contract as the Burn variant's
     * `forecastBatch`.
     */
    forecastBatch(context: Float32Array, n_signals: number, horizon: number, chunk_size: number): Promise<Float32Array>;
    /**
     * One forward pass, one signal (`v = 1`). Same contract as the Burn
     * variant's `forecast` (see `burn_impl.rs`): raw context in, `horizon
     * * n_quantiles` values out, time-major then quantile-minor.
     */
    forecast(context: Float32Array, horizon: number): Promise<Float32Array>;
    /**
     * Sum of every GPU buffer this instance holds: persistent weights
     * (`GpuModel::total_weight_bytes`) plus the per-forward `Pool`
     * working set (`Engine::pool::resident_bytes`, 0 before the first
     * `forecast`/`forecastBatch` call). For the browser GPU-memory report.
     */
    gpuBytes(): number;
    /**
     * Parses a GGUF byte buffer (as exported by `t0-cli export-gguf`) and
     * uploads every tensor straight to `wgpu::Buffer`s -- no Burn tensor
     * at any point, and no F32-expanded copy of the big per-layer matmuls
     * either: `load_model_from_gguf` keeps their Q8_0/Q4_0 block bytes
     * exactly as they arrive off the wire (the page already downloads a
     * quantized GGUF), reading straight into the packed-u32/scale buffers
     * the dequant kernels use. Only the small always-F16-on-disk tensors
     * (patch encoder, decoder, norms, type embeddings) get dequantized to
     * f32 here, same as the Burn path.
     */
    static load(gguf_bytes: Uint8Array): T0Wasm;
    nQuantiles(): number;
}

export function initBackend(): Promise<void>;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_t0wasm_free: (a: number, b: number) => void;
    readonly initBackend: () => any;
    readonly t0wasm_forecast: (a: number, b: number, c: number, d: number) => any;
    readonly t0wasm_forecastBatch: (a: number, b: number, c: number, d: number, e: number, f: number) => any;
    readonly t0wasm_gpuBytes: (a: number) => number;
    readonly t0wasm_load: (a: number, b: number) => [number, number, number];
    readonly t0wasm_nQuantiles: (a: number) => number;
    readonly wasm_bindgen__convert__closures_____invoke__h156bf3764d385c09: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__hb4bfe5504ef865b6: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h27d0c330b83a74d9: (a: number, b: number, c: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
