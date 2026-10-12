/* tslint:disable */
/* eslint-disable */

export class LifeEngine {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Append one GGUF chunk (kept on the JS side, see `JsChunksReader`).
     */
    appendModelShard(shard: Uint8Array): void;
    /**
     * "webgpu" or "cpu".
     */
    backend(): string;
    cellTokens(): number;
    chunkCount(): number;
    /**
     * The CPU backend (WASM SIMD128; threaded in the `web-mt` build once
     * `initThreadPool` ran): no device to request.
     */
    static createCpu(width: number, height: number): LifeEngine;
    /**
     * Requests the WebGPU device and builds lean's pipelines.
     */
    static create(width: number, height: number): Promise<LifeEngine>;
    loadAdapter(bytes: Uint8Array, norules: boolean): Promise<void>;
    load(tokenizer_json: string, rulestring: string): Promise<void>;
    /**
     * The same cell with no prefix reuse (`LifeLean::logits_case_a_full`):
     * `[dead logit, alive logit, case index, tokens forwarded]`.
     */
    logitsCellAFull(cells: Uint8Array, index: number): Promise<Float32Array>;
    /**
     * One cell, one forward against the resident prefix, for the
     * cell-speed page: `[dead logit, alive logit, case index, prompt tokens]`.
     */
    logitsCellA(cells: Uint8Array, index: number): Promise<Float32Array>;
    packedTokens(): number;
    prefixTokensA(): number;
    setGrid(width: number, height: number): void;
    stepCellA(cells: Uint8Array, index: number): Promise<number>;
    stepChunkA(cells: Uint8Array, chunk: number): Promise<Float32Array>;
    /**
     * Whole grid, one forward: p(alive) per cell.
     */
    step(cells: Uint8Array): Promise<Float32Array>;
    tokensPerGenerationA(): number;
}

export function initThreadPool(num_threads: number): Promise<any>;

export function otsuThreshold(p_alive: Float32Array): number;

export class wbg_rayon_PoolBuilder {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    build(): void;
    numThreads(): number;
    receiver(): number;
}

export function wbg_rayon_start_worker(receiver: number): void;

export function zscoreThreshold(p_alive: Float32Array, k: number): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly __wbg_lifeengine_free: (a: number, b: number) => void;
    readonly __wbg_wbg_rayon_poolbuilder_free: (a: number, b: number) => void;
    readonly initThreadPool: (a: number) => any;
    readonly lifeengine_appendModelShard: (a: number, b: any) => void;
    readonly lifeengine_backend: (a: number) => [number, number];
    readonly lifeengine_cellTokens: (a: number) => [number, number, number];
    readonly lifeengine_chunkCount: (a: number) => [number, number, number];
    readonly lifeengine_create: (a: number, b: number) => any;
    readonly lifeengine_createCpu: (a: number, b: number) => number;
    readonly lifeengine_load: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly lifeengine_loadAdapter: (a: number, b: number, c: number, d: number) => any;
    readonly lifeengine_logitsCellA: (a: number, b: number, c: number, d: number) => any;
    readonly lifeengine_logitsCellAFull: (a: number, b: number, c: number, d: number) => any;
    readonly lifeengine_packedTokens: (a: number) => [number, number, number];
    readonly lifeengine_prefixTokensA: (a: number) => [number, number, number];
    readonly lifeengine_setGrid: (a: number, b: number, c: number) => void;
    readonly lifeengine_step: (a: number, b: number, c: number) => any;
    readonly lifeengine_stepCellA: (a: number, b: number, c: number, d: number) => any;
    readonly lifeengine_stepChunkA: (a: number, b: number, c: number, d: number) => any;
    readonly lifeengine_tokensPerGenerationA: (a: number) => [number, number, number];
    readonly otsuThreshold: (a: number, b: number) => number;
    readonly wbg_rayon_poolbuilder_build: (a: number) => void;
    readonly wbg_rayon_poolbuilder_numThreads: (a: number) => number;
    readonly wbg_rayon_poolbuilder_receiver: (a: number) => number;
    readonly wbg_rayon_start_worker: (a: number) => void;
    readonly zscoreThreshold: (a: number, b: number, c: number) => number;
    readonly wasm_bindgen_8ead21ee1a2568b1___convert__closures_____invoke___js_sys_b807a529fd4769a9___Function_fn_wasm_bindgen_8ead21ee1a2568b1___JsValue_____wasm_bindgen_8ead21ee1a2568b1___sys__Undefined___js_sys_b807a529fd4769a9___Function_fn_wasm_bindgen_8ead21ee1a2568b1___JsValue_____wasm_bindgen_8ead21ee1a2568b1___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_8ead21ee1a2568b1___convert__closures_____invoke___wasm_bindgen_8ead21ee1a2568b1___JsValue__core_47c40c249e36843c___result__Result_____wasm_bindgen_8ead21ee1a2568b1___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_8ead21ee1a2568b1___convert__closures_____invoke___js_sys_b807a529fd4769a9___futures__task__wait_async_polyfill__MessageEvent______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_8ead21ee1a2568b1___convert__closures_____invoke___wasm_bindgen_8ead21ee1a2568b1___JsValue______true_: (a: number, b: number, c: any) => void;
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
