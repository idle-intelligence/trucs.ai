// lean-chat-client.js — embedding API for lean engine single-turn chat on
// this page. Backend selection (webgpu / threads / single, by capability
// only, never a benchmark) copies llm-web's crates/lean/www/backends_worker.js
// `createEngine()` + backends_common.js `capabilities()`
// (idle-intelligence/llm-web, branch lean-main, commit 0ab85d7). The
// `LeanEngine.create()` / `load()` calls copy crates/lean/www/main_chat.js
// from the same branch. `generate()` (crates/lean/src/web.rs) is used
// instead of that file's `chatGenerate()` because this page is single-turn
// with no sampling controls, and `generate()` is the only one of the two
// also implemented on the CPU engine.
//
// pkg-lean/ and pkg-lean-mt/ in this directory are that branch's
// crates/lean/pkg and crates/lean/pkg-mt, vendored as of the same commit.
// Bump ENGINE_BUILD below whenever those files are re-vendored.
const ENGINE_BUILD = '2026-10-03-lean-0ab85d7';

export async function capabilities() {
  const caps = {
    hardwareConcurrency: navigator.hardwareConcurrency || 1,
    crossOriginIsolated: self.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    adapter: 'none',
    hasAdapter: false,
  };
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        caps.hasAdapter = true;
        const i = adapter.info || {};
        caps.adapter = [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(' / ') || 'WebGPU adapter';
      } else {
        caps.adapter = 'navigator.gpu present, no adapter';
      }
    } catch (e) {
      caps.adapter = `requestAdapter failed: ${e && e.message ? e.message : e}`;
    }
  } else {
    caps.adapter = 'no navigator.gpu';
  }
  caps.threadsCapable = caps.crossOriginIsolated && caps.sharedArrayBuffer && caps.hardwareConcurrency > 1;
  return caps;
}

// Loads the lean wasm module for the best backend this browser can run
// (webgpu > threads > single), unless `forced` names one. Returns
// { engine, backend, label, caps }. `engine` is a LeanEngine, not yet
// loaded with a model (call .load(...) next).
export async function createLeanEngine(forced) {
  const caps = await capabilities();
  const order = forced ? [forced] : [caps.hasAdapter && 'webgpu', caps.threadsCapable && 'threads', 'single'].filter(Boolean);
  let lastErr = null;
  for (const backend of order) {
    try {
      if (backend === 'webgpu' && !caps.hasAdapter) throw new Error(`no WebGPU adapter (${caps.adapter})`);
      if (backend === 'threads' && !caps.threadsCapable) {
        throw new Error(
          `threads need crossOriginIsolated, SharedArrayBuffer and >1 hardware thread (got ${caps.crossOriginIsolated}, ${caps.sharedArrayBuffer}, ${caps.hardwareConcurrency})`
        );
      }
      const dir = backend === 'threads' ? './pkg-lean-mt' : './pkg-lean';
      const mod = await import(new URL(`${dir}/lean.js?v=${ENGINE_BUILD}`, import.meta.url).href);
      await mod.default(new URL(`${dir}/lean_bg.wasm?v=${ENGINE_BUILD}`, import.meta.url).href);
      mod.leanInit();
      if (backend === 'threads') await mod.initThreadPool(caps.hardwareConcurrency);
      const engine = backend === 'webgpu' ? await mod.LeanEngine.create() : mod.LeanEngineCpu.create();
      const label = backend === 'webgpu' ? 'on the GPU' : `on the CPU, ${backend === 'threads' ? caps.hardwareConcurrency : 1} thread${backend === 'threads' && caps.hardwareConcurrency !== 1 ? 's' : ''}`;
      return { engine, backend, label, caps };
    } catch (e) {
      lastErr = e;
      if (forced) throw e;
    }
  }
  throw lastErr || new Error('no backend available');
}

// One single-turn exchange: `generate()` (same on both LeanEngine and
// LeanEngineCpu - crates/lean/src/web.rs) renders the model's own chat
// template, resets the KV cache itself every call (no history across
// turns, matching this page's "single-turn chat" copy), decodes greedily,
// and calls onPiece(text) once per token as it's produced. Returns the
// full reply text.
export async function chatOnce(engine, prompt, { onPiece, maxTokens = 512 } = {}) {
  let tokens = 0;
  const text = await engine.generate(prompt, maxTokens, (id) => {
    tokens++;
    onPiece(engine.decodeIds(Uint32Array.from([id])));
  });
  return { text, tokens };
}
