// Module Worker behind this page's chat UI. Copied and adapted from
// idle-intelligence/llm-web:
//  - backend selection + capability checks: crates/lean/www/backends_common.js
//    `capabilities()` (branch lean-release, commit b7e51a2) - vendored here
//    as ./backends_common.js.
//  - worker structure (load/chat/stop/reset protocol, chatGenerate/chatReset
//    call shape, early-message buffering): crates/lean/www/chat_worker.js
//    (same branch/commit) and web/lean-chat-worker.js (branch pages-on-lean,
//    commit 08722b2).
// Model download goes through trucs.ai's own lib/model-cache.js (getModel),
// not backends_common.js's fetchBytes, since this page already has that
// shared cache helper (branch llm-life-demo, commit 920fbd9+).
//
// page -> worker:  {type:'load'} | {type:'chat', text} | {type:'stop'} | {type:'reset'}
// worker -> page:  {type:'status', text} | {type:'ready', backend, label}
//                   {type:'token', text} | {type:'done', tokens}
//                   {type:'error', message}
//
// Single-turn: the page calls chatReset() before every chatGenerate so each
// send starts a fresh conversation, matching this page's "single-turn chat"
// copy. No top-level import/await: a module worker with a top-level await
// can drop messages posted before it resolves (2026-09-22 llm-life
// incident). self.onmessage is wired synchronously first and buffers into
// EARLY until the real handlers are installed, then the buffer is replayed.
const EARLY = [];
self.onmessage = (e) => EARLY.push(e);

const ENGINE_BUILD = '2026-10-04-release-01';

let engine = null;
let AbortFlagCtor = null;
let abortFlag = null;

function status(text) {
  self.postMessage({ type: 'status', text });
}

async function capabilities() {
  const { capabilities: caps } = await import(`./backends_common.js?v=${ENGINE_BUILD}`);
  return caps();
}

async function createEngine(which) {
  if (which === 'webgpu') {
    const mod = await import(`./pkg/lean.js?v=${ENGINE_BUILD}`);
    await mod.default({ module_or_path: `./pkg/lean_bg.wasm?v=${ENGINE_BUILD}` });
    mod.leanInit();
    return { engine: await mod.LeanEngine.create(), AbortFlag: mod.AbortFlag };
  }
  if (which === 'threads') {
    const mod = await import(`./pkg-mt/lean.js?v=${ENGINE_BUILD}`);
    await mod.default({ module_or_path: `./pkg-mt/lean_bg.wasm?v=${ENGINE_BUILD}` });
    await mod.initThreadPool(navigator.hardwareConcurrency);
    mod.leanInit();
    return { engine: mod.LeanEngineCpu.create(), AbortFlag: mod.AbortFlag };
  }
  const mod = await import(`./pkg/lean.js?v=${ENGINE_BUILD}`);
  await mod.default({ module_or_path: `./pkg/lean_bg.wasm?v=${ENGINE_BUILD}` });
  mod.leanInit();
  return { engine: mod.LeanEngineCpu.create(), AbortFlag: mod.AbortFlag };
}

function backendLabel(backend, threads) {
  if (backend === 'webgpu') return 'on the GPU';
  if (backend === 'threads') return `on the CPU, ${threads} threads`;
  return 'on the CPU, 1 thread';
}

// `models` is `{ webgpu, cpu }`: two model configs, picked per candidate
// backend, not once up front. SmolLM2-1.7B Q4_0 traps (out of memory) on
// the CPU-threads build - lean's CPU engines only have pkg-mt's capped
// wasm memory, not a GPU's address space - so a CPU candidate (threads or
// single) always loads the smaller `models.cpu`, even when the first
// candidate was WebGPU and failed partway through: each candidate fetches
// and loads its own model, so fallback never retries the 1.7B model on CPU.
async function load(models) {
  const caps = await capabilities();
  const candidates = [caps.hasAdapter && 'webgpu', caps.threadsCapable && 'threads', 'single'].filter(Boolean);
  console.log(`[lean] capabilities: crossOriginIsolated=${caps.crossOriginIsolated} sharedArrayBuffer=${caps.sharedArrayBuffer} hardwareConcurrency=${caps.hardwareConcurrency} hasAdapter=${caps.hasAdapter} -> candidates: ${candidates.join(', ')}`);

  const { getModel } = await import('../lib/model-cache.js');
  const skipped = [];
  let backend = null;
  let loadedModel = null;
  for (const c of candidates) {
    const model = c === 'webgpu' ? models.webgpu : models.cpu;
    try {
      status(`fetching ${model.name}...`);
      const [ggufBytes, tokenizerBytes, tokenizerCfgBytes] = await getModel(
        [model.gguf, model.tokenizer, model.tokenizerCfg],
        {
          cache: model.cache,
          onProgress: (loaded, total) => {
            if (total > 0) {
              const mb = (loaded / 1024 / 1024).toFixed(0);
              const pct = ((loaded / total) * 100).toFixed(0);
              status(`downloading ${model.name}: ${mb}MB, ${pct}%`);
            }
          },
        }
      );
      const tokenizerJson = new TextDecoder().decode(tokenizerBytes);
      const tokenizerCfgJson = new TextDecoder().decode(tokenizerCfgBytes);

      status(`loading on ${c}...`);
      const r = await createEngine(c);
      r.engine.load(ggufBytes, tokenizerJson, tokenizerCfgJson, model.maxCtx);
      engine = r.engine;
      AbortFlagCtor = r.AbortFlag;
      backend = c;
      loadedModel = model;
      break;
    } catch (e) {
      const reason = e && e.message ? e.message : e;
      console.warn(`[lean] ${c} backend failed, falling back: ${reason}`);
      skipped.push(`${c}: ${reason}`);
      engine = null;
    }
  }
  if (!engine) throw new Error(`no backend available (${skipped.join('; ')})`);

  self.postMessage({ type: 'ready', backend, label: backendLabel(backend, caps.hardwareConcurrency), modelName: loadedModel.name });
}

async function chat(text) {
  if (!engine) {
    self.postMessage({ type: 'error', phase: 'generate', message: 'engine not loaded' });
    return;
  }
  engine.chatReset();
  let tokens = 0;
  try {
    abortFlag = new AbortFlagCtor();
    await engine.chatGenerate(
      text,
      512,
      0.7,
      40,
      0.9,
      1.1,
      0,
      new Uint32Array(0),
      (id, piece) => {
        if (id >= 0) tokens += 1;
        if (piece) self.postMessage({ type: 'token', text: piece });
      },
      abortFlag.cloneFlag()
    );
    self.postMessage({ type: 'done', tokens });
  } catch (e) {
    self.postMessage({ type: 'error', phase: 'generate', message: e && e.message ? e.message : String(e) });
  } finally {
    abortFlag = null;
  }
}

function stop() {
  if (abortFlag) abortFlag.abort();
}

const handlers = {
  load: (msg) => load(msg.models).catch((e) => self.postMessage({ type: 'error', phase: 'load', message: e && e.message ? e.message : String(e) })),
  chat: (msg) => chat(msg.text),
  stop: () => stop(),
};

self.onmessage = (e) => handlers[e.data.type]?.(e.data);
for (const e of EARLY) handlers[e.data.type]?.(e.data);
