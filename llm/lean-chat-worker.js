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
// Multi-turn: the worker keeps the message list (a system message, then
// user and assistant turns) and renders all of it through the chat template
// on every turn. lean itself keeps no conversation of its own (see
// Lean.generate); it reuses the KV cache of the longest common prefix with
// the previous prompt. When a prompt does not fit, the oldest exchange is
// dropped and the turn retried. No top-level import/await: a module worker with a
// top-level await can drop messages posted before it resolves (2026-09-22
// llm-life incident). self.onmessage is wired synchronously first and
// buffers into EARLY until the real handlers are installed, then the
// buffer is replayed.
const EARLY = [];
self.onmessage = (e) => EARLY.push(e);

const ENGINE_BUILD = '2026-10-10-lean-1fce23d';

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

  await warmUp();

  self.postMessage({ type: 'ready', backend, label: backendLabel(backend, caps.hardwareConcurrency) });
}

const GEN_PARAMS = { maxNewTokens: 512, temperature: 0.7, topK: 40, topP: 0.9, repetitionPenalty: 1.0, seed: 0 };

const SYSTEM_PROMPT = 'You are a small language model running entirely in the user\'s browser on lean, an inference engine written in Rust and compiled to WebAssembly, with no server. Keep your answers brief.';
const SYSTEM = { role: 'system', content: SYSTEM_PROMPT };

// The whole conversation after the system message, as {role, content}.
let HISTORY = [];

// Runs one generation over the system message alone, so the KV cache
// already holds the system prompt when the first user turn arrives. The
// system-only text must be a byte prefix of every later prompt for lean's
// prefix reuse to apply; that is checked here against a sample turn.
async function warmUp() {
  try {
    const prefix = lean.chatRender(chatTemplate, [SYSTEM], null, false);
    const full = lean.chatRender(chatTemplate, [SYSTEM, { role: 'user', content: 'hi' }], null, true);
    console.log(`[lean] warm-up prefix check: system-only prompt is a prefix of the first full prompt: ${full.startsWith(prefix)} (${engine.tokenCount(prefix)} tokens)`);
    const t0 = performance.now();
    await engine.generate(prefix, { ...GEN_PARAMS, maxNewTokens: 1 }, () => {}, null);
    console.log(`[lean] warm-up done in ${((performance.now() - t0) / 1000).toFixed(2)}s`);
  } catch (e) {
    console.warn(`[lean] warm-up failed: ${e && e.message ? e.message : e}`);
  }
}

async function generateOnce(turn) {
  const prompt = lean.chatRender(chatTemplate, turn, null, true);
  return engine.generate(prompt, GEN_PARAMS, (piece) => self.postMessage({ type: 'token', text: piece }), abortFlag.cloneFlag());
}

// Retries a turn against a shrinking message list: `turn` is the system
// message, HISTORY and the pending user message (chatTrimOldestExchange
// keeps that latest user turn and drops the oldest exchange before it).
async function generateWithTrim(turn) {
  for (;;) {
    try {
      return { turn, reply: await generateOnce(turn) };
    } catch (e) {
      if (!(e && e.name === 'ContextOverflow')) throw e;
      const trimmed = lean.chatTrimOldestExchange(turn);
      if (!trimmed) throw e;
      console.log(`[lean] context overflow (needed=${e.needed} available=${e.available}); dropping the oldest turn`);
      turn = trimmed;
    }
  }
}

async function chat(text) {
  if (!engine) {
    self.postMessage({ type: 'error', phase: 'generate', message: 'engine not loaded' });
    return;
  }
  try {
    abortFlag = new lean.AbortFlag();
    const { turn, reply } = await generateWithTrim([SYSTEM, ...HISTORY, { role: 'user', content: text }]);
    HISTORY = [...turn.slice(1), { role: 'assistant', content: reply }];
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
