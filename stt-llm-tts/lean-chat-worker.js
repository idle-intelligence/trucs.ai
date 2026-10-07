// Module Worker behind this page's LLM panel. Multi-turn variant of
// llm/lean-chat-worker.js (idle-intelligence/trucs.ai, branch llm-lean):
// same backend selection (./backends_common.js's capabilities(), copied from
// idle-intelligence/llm-web branch lean-release crates/lean/www/
// backends_common.js, commit b7e51a2) and the same load/model-download
// wiring, but this page keeps a real conversation across turns instead of
// resetting every send: chatReset() is only called when the page asks for
// it (the "reset" button, or starting over after a demo/abort), never
// before a 'chat' message. The engine's own ChatSession
// (crates/lean/src/chat.rs) holds the turn history and reuses the KV
// cache's longest common prefix between turns.
//
// page -> worker:  {type:'load', model} | {type:'chat', text} | {type:'stop'} | {type:'reset'}
// worker -> page:  {type:'status', text} | {type:'ready', backend, label}
//                   {type:'token', text} | {type:'done', tokens}
//                   {type:'error', message}
//
// No top-level import/await: a module worker with a top-level await can
// drop messages posted before it resolves (2026-09-22 llm-life incident).
// self.onmessage is wired synchronously first and buffers into EARLY until
// the real handlers are installed, then the buffer is replayed.
const EARLY = [];
self.onmessage = (e) => EARLY.push(e);

const ENGINE_BUILD = '2026-10-06-lean-878b1a1';

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
      mod.leanInit();
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
      mod.leanInit();
      return mod;
    })();
  }
  return threadsPromise;
}

async function createEngine(which) {
  if (which === 'webgpu') {
    const mod = await loadSingle();
    return { engine: await mod.LeanEngine.create(), AbortFlag: mod.AbortFlag };
  }
  if (which === 'threads') {
    const mod = await loadThreads();
    return { engine: mod.LeanEngineCpu.create(), AbortFlag: mod.AbortFlag };
  }
  const mod = await loadSingle();
  return { engine: mod.LeanEngineCpu.create(), AbortFlag: mod.AbortFlag };
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

  const { getModel } = await import('../lib/model-cache.js?v=2026-10-06-lean-878b1a1');
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
      const r = await createEngine(c);
      r.engine.load(ggufBytes, tokenizerJson, tokenizerCfgJson, model.maxCtx);
      engine = r.engine;
      AbortFlagCtor = r.AbortFlag;
      backend = c;
      break;
    } catch (e) {
      const reason = e && e.message ? e.message : e;
      console.warn(`[lean] ${c} backend failed, falling back: ${reason}`);
      skipped.push(`${c}: ${reason}`);
      engine = null;
    }
  }
  if (!engine) throw new Error(`no backend available (${skipped.join('; ')})`);

  self.postMessage({ type: 'ready', backend, label: backendLabel(backend, caps.hardwareConcurrency) });
}

// Answers are read aloud: keep them short. lean's chat API has no system
// prompt yet, so the instruction the WebLLM version used as its system
// prompt is put in front of the first user turn of each conversation.
const INSTRUCTION = 'You are a helpful, concise voice assistant. Your text is read aloud. Keep answers to one to three sentences.';
const MAX_NEW_TOKENS = 120;
let freshConversation = true;

async function generate(text) {
  let tokens = 0;
  abortFlag = new AbortFlagCtor();
  const prompt = freshConversation ? `${INSTRUCTION}\n\n${text}` : text;
  await engine.chatGenerate(
    prompt,
    MAX_NEW_TOKENS,
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
  freshConversation = false;
  return tokens;
}

async function chat(text) {
  if (!engine) {
    self.postMessage({ type: 'error', phase: 'generate', message: 'engine not loaded' });
    return;
  }
  try {
    let tokens;
    try {
      tokens = await generate(text);
    } catch (e) {
      // The conversation no longer fits the context window: lean refuses the
      // turn before generating anything. Start a fresh conversation and
      // answer this turn instead of failing every turn from now on.
      if (!String(e && e.message ? e.message : e).includes('exceeds max_ctx')) throw e;
      console.log('[lean] conversation full, starting a new one');
      engine.chatReset();
      freshConversation = true;
      tokens = await generate(text);
    }
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

function reset() {
  if (engine) engine.chatReset();
  freshConversation = true;
}

const handlers = {
  load: (msg) => load(msg.model).catch((e) => self.postMessage({ type: 'error', phase: 'load', message: e && e.message ? e.message : String(e) })),
  chat: (msg) => chat(msg.text),
  stop: () => stop(),
  reset: () => reset(),
};

self.onmessage = (e) => handlers[e.data.type]?.(e.data);
for (const e of EARLY) handlers[e.data.type]?.(e.data);
