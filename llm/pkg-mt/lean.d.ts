/* tslint:disable */
/* eslint-disable */

/**
 * Stops a running `generate`: keep one clone, pass another to the call,
 * and call [`AbortFlag::abort`] from anywhere (another thread, a signal
 * handler, a worker's message handler). Checked once per generated token.
 * JavaScript gets this same type as the `AbortFlag` class.
 */
export class AbortFlag {
    free(): void;
    [Symbol.dispose](): void;
    abort(): void;
    /**
     * A handle on the same flag. In JavaScript, pass `flag.cloneFlag()`
     * to `generate` rather than `flag` itself: wasm-bindgen consumes a
     * class passed by value, and the caller's `flag` must stay usable to
     * call `abort()` while the call runs.
     */
    cloneFlag(): AbortFlag;
    isAborted(): boolean;
    constructor();
}

/**
 * A model's chat template with its special tokens: the JS face of
 * [`crate::ChatTemplate`].
 */
export class ChatTemplate {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The template, `bos_token` and `eos_token` of a
     * `tokenizer_config.json`'s text.
     */
    static fromTokenizerConfig(json: string): ChatTemplate;
    /**
     * A template from its source alone, with no special tokens.
     */
    constructor(source: string);
}

/**
 * The engine: the JS face of [`crate::Lean`], same calls and same
 * behaviour.
 */
export class Lean {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * One inference turn over `text`, exactly as given. `params`:
     * `maxNewTokens`, `temperature` (0 = greedy), `topK`, `topP`,
     * `repetitionPenalty`, `seed`, optional `mask`. `onToken(text)` gets
     * each piece of the reply as it is decoded; it must not call this
     * engine, and a throw from it stops generation and is rethrown.
     * `abort`: `flag.cloneFlag()` of an `AbortFlag`, or nothing. Resolves
     * to the whole reply. Rejects with a `ContextOverflow` error (see
     * `lean_error_to_js`) when `text` plus `maxNewTokens` does not fit
     * `maxCtx`; the engine stays usable.
     */
    generate(text: string, params: any, on_token: any, abort?: AbortFlag | null): Promise<string>;
    /**
     * `opts`: `{ gguf, tokenizer, maxCtx, backend }`. `gguf` is the GGUF
     * file as a `Uint8Array` (read one tensor at a time, never copied
     * whole into wasm memory; drop your reference after the call so the
     * JS heap can reclaim it), `tokenizer` the text of `tokenizer.json`,
     * `maxCtx` the KV cache size in tokens, `backend` `"auto"` (default:
     * WebGPU, else the CPU forward pass), `"webgpu"` or `"cpu"`. The CPU
     * forward pass runs on a thread pool in the threads build after
     * `initThreadPool(n)`, and on one thread otherwise.
     */
    static load(opts: any): Promise<Lean>;
    /**
     * How many tokens `text` is. No forward pass.
     */
    tokenCount(text: string): number;
    /**
     * `"webgpu"`, `"threads"` or `"single"`.
     */
    readonly backend: string;
}

/**
 * `render` for JavaScript: `template` is a `ChatTemplate`, `messages` an
 * array of `{role, content, tool_calls?, name?, tool_call_id?}`, `tools`
 * an array of tool definitions or null/undefined.
 */
export function chatRender(template: ChatTemplate, messages: any, tools: any, add_generation_prompt: boolean): string;

/**
 * `trim_oldest_exchange` for JavaScript: returns a new array without the
 * oldest exchange (the same message objects otherwise), or `undefined`
 * when there is no older exchange to drop. `messages` is not modified.
 */
export function chatTrimOldestExchange(messages: Array<any>): any;

export function initThreadPool(num_threads: number): Promise<any>;

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
    readonly __wbg_chattemplate_free: (a: number, b: number) => void;
    readonly __wbg_lean_free: (a: number, b: number) => void;
    readonly __wbg_wbg_rayon_poolbuilder_free: (a: number, b: number) => void;
    readonly abortflag_abort: (a: number) => void;
    readonly abortflag_cloneFlag: (a: number) => number;
    readonly abortflag_isAborted: (a: number) => number;
    readonly abortflag_new: () => number;
    readonly chatRender: (a: number, b: any, c: any, d: number) => [number, number, number, number];
    readonly chatTrimOldestExchange: (a: any) => [number, number, number];
    readonly chattemplate_fromTokenizerConfig: (a: number, b: number) => [number, number, number];
    readonly chattemplate_new: (a: number, b: number) => number;
    readonly initThreadPool: (a: number) => any;
    readonly lean_backend: (a: number) => [number, number];
    readonly lean_generate: (a: number, b: number, c: number, d: any, e: any, f: number) => any;
    readonly lean_load: (a: any) => any;
    readonly lean_tokenCount: (a: number, b: number, c: number) => [number, number, number];
    readonly wbg_rayon_poolbuilder_build: (a: number) => void;
    readonly wbg_rayon_poolbuilder_numThreads: (a: number) => number;
    readonly wbg_rayon_poolbuilder_receiver: (a: number) => number;
    readonly wbg_rayon_start_worker: (a: number) => void;
    readonly wasm_bindgen_b77a37fac4d28a6___convert__closures_____invoke___js_sys_8e401467e1b17989___Function_fn_wasm_bindgen_b77a37fac4d28a6___JsValue_____wasm_bindgen_b77a37fac4d28a6___sys__Undefined___js_sys_8e401467e1b17989___Function_fn_wasm_bindgen_b77a37fac4d28a6___JsValue_____wasm_bindgen_b77a37fac4d28a6___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_b77a37fac4d28a6___convert__closures_____invoke___wasm_bindgen_b77a37fac4d28a6___JsValue__core_69630a7fb43a177___result__Result_____wasm_bindgen_b77a37fac4d28a6___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_b77a37fac4d28a6___convert__closures_____invoke___js_sys_8e401467e1b17989___futures__task__wait_async_polyfill__MessageEvent______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_b77a37fac4d28a6___convert__closures_____invoke___wasm_bindgen_b77a37fac4d28a6___JsValue______true_: (a: number, b: number, c: any) => void;
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
