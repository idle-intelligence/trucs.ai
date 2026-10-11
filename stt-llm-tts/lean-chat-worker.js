// Module Worker behind this page's LLM panel. Multi-turn variant of
// llm/lean-chat-worker.js: same backend selection (./backends_common.js's
// capabilities()) and the same load/model-download wiring, but this page
// keeps a real conversation across turns instead of resetting every send.
// The worker holds the conversation (HISTORY) and renders it through the
// model's chat template on every call (chatRender, from web/lean-chat-worker.js,
// branch lean-one-turn, commit 1fce23d); lean itself keeps no history of
// its own and reuses the KV cache's common prefix between calls.
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

const ENGINE_BUILD = '2026-10-10-lean-1fce23d';

let engine = null;
let lean = null; // the loaded wasm module (AbortFlag, ChatTemplate, chatRender, chatTrimOldestExchange)
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

// Answers are read aloud: keep them short. lean's chat API has no system
// role of its own yet, so the instruction the WebLLM version used as its
// system prompt is put in front of the first user turn of each
// conversation (HISTORY starts empty; freshConversation is true until the
// first turn is answered).
const INSTRUCTION = 'You are a helpful, concise voice assistant. Your text is read aloud. Keep answers to one to three sentences.';
const MAX_NEW_TOKENS = 120;
let HISTORY = [];
let freshConversation = true;

// Stop after this many sentences: SmolLM2 does not reliably follow the
// "one to three sentences" instruction, and every word is read aloud.
const MAX_SENTENCES = 3;

async function generateOnce(turn) {
  let reply = '';
  let sentences = 0;
  const flag = abortFlag;
  const prompt = lean.chatRender(chatTemplate, turn, null, true);
  reply = await engine.generate(
    prompt,
    { maxNewTokens: MAX_NEW_TOKENS, temperature: 0.7, topK: 40, topP: 0.9, repetitionPenalty: 1.0, seed: 0 },
    (piece) => {
      self.postMessage({ type: 'token', text: piece });
      sentences += (piece.match(/[.!?](\s|$)/g) || []).length;
      if (sentences >= MAX_SENTENCES) flag.abort();
    },
    flag.cloneFlag()
  );
  return reply;
}

// Retries a turn against a shrinking message list: `turn` is HISTORY plus
// the pending user message (chatTrimOldestExchange keeps that latest user
// turn and drops the oldest exchange before it). Once there is nothing
// left to drop and it still does not fit, falls back to a fresh
// conversation for this turn - the same recovery the page had before the
// client-side trim existed. `triedFresh` guards against retrying the fresh
// restart more than once.
async function generateWithTrim(turn, text, triedFresh) {
  for (;;) {
    try {
      return { turn, reply: await generateOnce(turn) };
    } catch (e) {
      if (!(e && e.name === 'ContextOverflow')) throw e;
      const trimmed = lean.chatTrimOldestExchange(turn);
      if (trimmed) {
        console.log(`[lean] context overflow (needed=${e.needed} available=${e.available}); dropping the oldest turn`);
        turn = trimmed;
        continue;
      }
      if (!triedFresh) {
        console.log(`[lean] context overflow with nothing left to trim (needed=${e.needed} available=${e.available}); starting a new conversation`);
        return generateWithTrim([{ role: 'user', content: `${INSTRUCTION}\n\n${text}` }], text, true);
      }
      throw e;
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
    const userContent = freshConversation ? `${INSTRUCTION}\n\n${text}` : text;
    const startTurn = [...HISTORY, { role: 'user', content: userContent }];
    const { turn, reply } = await generateWithTrim(startTurn, text, freshConversation);
    HISTORY = [...turn, { role: 'assistant', content: reply }];
    freshConversation = false;
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

function reset() {
  HISTORY = [];
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
