// Module Worker behind this page's chat UI. Copied and adapted from
// idle-intelligence/llm-web:
//  - backend selection + capability checks: crates/lean/www/backends_common.js
//    `capabilities()` (branch lean-release, commit b7e51a2) - vendored here
//    as ./backends_common.js.
//  - engine API (Lean.load/generate/tokenCount, ChatTemplate, chatRender):
//    web/lean-chat-worker.js (branch lean-one-turn, commit 1fce23d).
// Model download goes through trucs.ai's own lib/model-cache.js (getModel),
// not backends_common.js's fetchBytes, since this page already has that
// shared cache helper (branch llm-life-demo, commit 920fbd9+).
//
// page -> worker:  {type:'load'} | {type:'chat', text} | {type:'stop'}
// worker -> page:  {type:'status', text} | {type:'ready', backend, label}
//                   {type:'token', text} | {type:'done', tokens}
//                   {type:'error', message}
//
// Single-turn: every chat renders just the one user message through the
// chat template, matching this page's "single-turn chat" copy. lean itself
// keeps no conversation of its own (see Lean.generate); there is nothing to
// reset between turns. No top-level import/await: a module worker with a
// top-level await can drop messages posted before it resolves (2026-09-22
// llm-life incident). self.onmessage is wired synchronously first and
// buffers into EARLY until the real handlers are installed, then the
// buffer is replayed.
const EARLY = [];
self.onmessage = (e) => EARLY.push(e);

const ENGINE_BUILD = '2026-10-18-lean-6a4bb25';

let engine = null;
let lean = null; // the loaded wasm module (AbortFlag, ChatTemplate, chatRender)
let chatTemplate = null;
let abortFlag = null;

function status(text) {
  self.postMessage({ type: 'status', text });
}

async function capabilities() {
  const { capabilities: caps } = await import(`./backends_common.js?v=${ENGINE_BUILD}`);
  return caps();
}

// Each wasm build is initialised once per worker and reused: the CPU
// threads build's thread pool can only be built once, so a load retry
// after a failure (the page's "download failed, try again" path) must not
// initialise it again.
let singlePromise = null;
let threadsPromise = null;
function loadSingle() {
  if (!singlePromise) {
    singlePromise = (async () => {
      const mod = await import(`./pkg/lean.js?v=${ENGINE_BUILD}`);
      await mod.default({ module_or_path: `./pkg/lean_bg.wasm?v=${ENGINE_BUILD}` });
      return mod;
    })();
  }
  return singlePromise;
}
function loadThreads() {
  if (!threadsPromise) {
    threadsPromise = (async () => {
      const mod = await import(`./pkg-mt/lean.js?v=${ENGINE_BUILD}`);
      await mod.default({ module_or_path: `./pkg-mt/lean_bg.wasm?v=${ENGINE_BUILD}` });
      await mod.initThreadPool(navigator.hardwareConcurrency);
      return mod;
    })();
  }
  return threadsPromise;
}

function loadModule(which) {
  return which === 'threads' ? loadThreads() : loadSingle();
}

function backendLabel(backend, threads) {
  if (backend === 'webgpu') return 'on the GPU';
  if (backend === 'threads') return `on the CPU, ${threads} threads`;
  return 'on the CPU, 1 thread';
}

async function load(model) {
  const caps = await capabilities();
  const candidates = [caps.hasAdapter && 'webgpu', caps.threadsCapable && 'threads', 'single'].filter(Boolean);
  console.log(`[lean] capabilities: crossOriginIsolated=${caps.crossOriginIsolated} sharedArrayBuffer=${caps.sharedArrayBuffer} hardwareConcurrency=${caps.hardwareConcurrency} hasAdapter=${caps.hasAdapter} -> candidates: ${candidates.join(', ')}`);

  const { getModel } = await import(`../lib/model-cache.js?v=${ENGINE_BUILD}`);
  const [ggufBytes, tokenizerBytes, tokenizerCfgBytes] = await getModel(
    [model.gguf, model.tokenizer, model.tokenizerCfg],
    {
      cache: model.cache,
      onProgress: (loaded, total) => {
        if (total > 0) {
          const mb = (loaded / 1024 / 1024).toFixed(0);
          const pct = ((loaded / total) * 100).toFixed(0);
          status(`downloading model: ${mb}MB, ${pct}%`);
        }
      },
    }
  );
  const tokenizerJson = new TextDecoder().decode(tokenizerBytes);
  const tokenizerCfgJson = new TextDecoder().decode(tokenizerCfgBytes);

  status('loading...');
  const skipped = [];
  let backend = null;
  for (const c of candidates) {
    try {
      const mod = await loadModule(c);
      const e = await mod.Lean.load({ gguf: ggufBytes, tokenizer: tokenizerJson, maxCtx: model.maxCtx, backend: c === 'webgpu' ? 'webgpu' : 'cpu' });
      chatTemplate = mod.ChatTemplate.fromTokenizerConfig(tokenizerCfgJson);
      engine = e;
      lean = mod;
      backend = c;
      break;
    } catch (err) {
      const reason = err && err.message ? err.message : err;
      console.warn(`[lean] ${c} backend failed, falling back: ${reason}`);
      skipped.push(`${c}: ${reason}`);
      engine = null;
    }
  }
  if (!engine) throw new Error(`no backend available (${skipped.join('; ')})`);

  self.postMessage({ type: 'ready', backend, label: backendLabel(backend, caps.hardwareConcurrency) });
}

const GEN_PARAMS = { maxNewTokens: 512, temperature: 0.7, topK: 40, topP: 0.9, repetitionPenalty: 1.1, seed: 0 };

async function chat(text) {
  if (!engine) {
    self.postMessage({ type: 'error', phase: 'generate', message: 'engine not loaded' });
    return;
  }
  try {
    const prompt = lean.chatRender(chatTemplate, [{ role: 'user', content: text }], null, true);
    abortFlag = new lean.AbortFlag();
    const reply = await engine.generate(prompt, GEN_PARAMS, (piece) => self.postMessage({ type: 'token', text: piece }), abortFlag.cloneFlag());
    let tokens = 0;
    try { tokens = engine.tokenCount(reply); } catch (_) {}
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
  load: (msg) => load(msg.model).catch((e) => self.postMessage({ type: 'error', phase: 'load', message: e && e.message ? e.message : String(e) })),
  chat: (msg) => chat(msg.text),
  stop: () => stop(),
};

self.onmessage = (e) => handlers[e.data.type]?.(e.data);
for (const e of EARLY) handlers[e.data.type]?.(e.data);
