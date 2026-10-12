// pickLeanBackend: which lean backend runs the language model in this
// browser, picked by capability only (never by a benchmark): auto = WebGPU
// if an adapter is granted, else CPU threads if the page is cross-origin
// isolated with SharedArrayBuffer and more than one hardware thread, else
// single-thread CPU (WASM SIMD128). A forced backend (`?backend=webgpu`,
// `threads` or `single` on the page URL) that is unavailable is an error,
// not a silent fallback. Same model and answers on all three.
//
// capabilities() is llm-web's crates/lean/www/backends_common.js
// `capabilities()`; the module loading is that directory's
// backends_worker.js `createEngine()` (pkg-lean-mt + initThreadPool for
// threads, pkg-lean for WebGPU and single thread), adapted to this crate's
// LifeEngine. Runs inside a worker.

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

// How many wasm threads to start, by capability only (no runtime tuning,
// no benchmark): leave 2 of navigator.hardwareConcurrency's logical cores
// for the OS/UI thread and the browser's own compositor, so an 8-core
// phone starting 8 busy wasm worker threads doesn't starve Android's
// System UI, which would otherwise stop responding while the CPU-threads
// backend was running. Floor of 1: a 2-core device still gets one thread,
// there is nothing left to reserve on it.
export function threadCountFor(hardwareConcurrency) {
  return Math.max(1, hardwareConcurrency - 2);
}

// Loads the wasm module for `requested` ('auto', 'webgpu', 'threads' or
// 'single') and returns { mod, backend, caps, label }. `build` is the
// engine build tag put on every module URL.
export async function pickLeanBackend(requested, build) {
  const caps = await capabilities();
  const backend = requested && requested !== 'auto'
    ? requested
    : caps.hasAdapter ? 'webgpu' : caps.threadsCapable ? 'threads' : 'single';
  if (backend === 'webgpu' && !caps.hasAdapter) throw new Error(`no WebGPU adapter (${caps.adapter})`);
  if (backend === 'threads' && !caps.threadsCapable) {
    throw new Error(
      `threads need crossOriginIsolated, SharedArrayBuffer and >1 hardware thread ` +
        `(got ${caps.crossOriginIsolated}, ${caps.sharedArrayBuffer}, ${caps.hardwareConcurrency})`
    );
  }
  if (!['webgpu', 'threads', 'single'].includes(backend)) throw new Error(`unknown backend ${backend}`);
  const dir = backend === 'threads' ? 'pkg-lean-mt' : 'pkg-lean';
  const mod = await import(new URL(`./${dir}/llm_life_lean.js?v=${build}`, import.meta.url).href);
  await mod.default({ module_or_path: new URL(`./${dir}/llm_life_lean_bg.wasm?v=${build}`, import.meta.url) });
  const threadCount = threadCountFor(caps.hardwareConcurrency);
  if (backend === 'threads') await mod.initThreadPool(threadCount);
  const label = backend === 'webgpu' ? 'WebGPU'
    : backend === 'threads' ? `CPU, ${threadCount} threads` : 'CPU, 1 thread';
  return { mod, backend, caps, threadCount, label };
}

// A LifeEngine on the picked backend.
export async function createLifeEngine(picked, width, height) {
  return picked.backend === 'webgpu'
    ? await picked.mod.LifeEngine.create(width, height)
    : picked.mod.LifeEngine.createCpu(width, height);
}
