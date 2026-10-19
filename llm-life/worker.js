// Loads Qwen2.5-0.5B-Instruct q4_0 (lean) and the a-norules-300 per-cell
// LoRA adapter, then plays Conway's Game of Life on a 16x16 board one cell
// at a time: engine.logitsCellA(cells, index) returns [dead logit, alive
// logit, case index, prompt tokens] for one cell against the model's
// resident per-cell prefix (crates/llm-life-lean/src/web.rs in llm-life).
// Backend (WebGPU, CPU threads or one CPU thread) is picked by capability
// only, never a benchmark: lean-backend.js, copied from llm-life's
// web/lean-backend.js (pickLeanBackend), which is itself adapted from
// llm-web's crates/lean/www backend picker.
// Messages posted before this module finishes its top-level await would be
// dropped, not queued, so buffer into `pending` first and replay it once the
// real handler is installed (idle-intelligence/llm-life, web/cellspeed/worker.js).
// Model download + Cache API storage is lib/model-cache.js (getModel),
// shared with any other trucs.ai demo: one cache entry per file URL, a
// versioned cache name, navigator.storage.persist() before downloading
// anything uncached, and a storage failure that never breaks the page (it
// falls back to the network bytes and reports one onStatus sentence, shown
// in the page's status line, instead of failing silently). Replaces the
// single-giant-Response caching this worker used before, which could fail
// silently on a Firefox quota/storage limit, causing a redownload on every
// visit even to the same link.
import { pickLeanBackend, createLifeEngine } from './lean-backend.js?v=2026-10-05-mem-01';
import { getModel } from '../lib/model-cache.js?v=2026-10-04-cache-01';

const ENGINE_BUILD = '2026-10-19-lean-6a4bb25';
const pending = [];
self.onmessage = (e) => pending.push(e);

const WIDTH = 16;
const HEIGHT = 16;
const CELLS = WIDTH * HEIGHT;

// Cache names are versioned ('-v1'); bump when the files at these URLs
// change. The adapter gets its own cache name since it iterates faster
// than the base model.
const QWEN_CACHE = 'qwen2.5-0.5b-instruct-gguf-q4_0-v1';
const ADAPTER_CACHE = 'llm-of-life-lora-a-norules-300-v1';

const GGUF_URL = 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_0.gguf';
const TOKENIZER_URL = 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/resolve/main/tokenizer.json';
const ADAPTER_URL = 'https://huggingface.co/idle-intelligence/llm-of-life-lora/resolve/main/lora-a-norules-300.bin';

const LOCAL = new URLSearchParams(location.search).get('local') === '1';
const urls = LOCAL ? {
  gguf: './models/qwen2.5-0.5b-instruct-q4_0.gguf',
  tokenizer: './models/tokenizer.json',
  adapter: './models/lora-a-norules-300.bin',
} : { gguf: GGUF_URL, tokenizer: TOKENIZER_URL, adapter: ADAPTER_URL };

// 64 MB pieces fed to the engine one at a time (crates/llm-life-lean/src/
// web.rs's JsChunksReader): a caching concern only in that getModel hands
// back one whole file's bytes, which still has to be sliced before
// appendModelShard. Splitting a file into cache entries is not
// model-cache.js's job (see its own header comment).
const CHUNK = 64 * 1024 * 1024;

function splitIntoChunks(buf) {
  const chunks = [];
  for (let off = 0; off < buf.length; off += CHUNK) chunks.push(buf.subarray(off, off + CHUNK));
  return chunks;
}

// The exact resident prefix the a-norules adapter is prefilled with
// (idle-intelligence/llm-life, crates/llm-life/src/variant_a.rs::norules_prefix,
// used via load_adapter(bytes, norules=true) -> set_prefix_a). Copied
// verbatim, not retyped from memory, so the display can't drift from what
// the engine actually sends.
const PREFIX_TEXT = 'For each cell, answer with one digit: its next state.\n';

// Same neighbor order as crates/life/src/grid.rs::neighbor_indices (toroidal
// Moore neighborhood, NW N NE W E SW S SE). The per-cell part matches
// crates/llm-life/src/variant_a.rs::cell_prompt exactly (trailing space
// before the answer digit is deliberate, see that function's doc comment).
// The engine tokenizes each cell prompt as `"\n" + cell_prompt(...)`
// (crates/llm-life-lean/src/lib.rs::load), so the exact text the model
// reads for one cell is PREFIX_TEXT + "\n" + this.
function cellPromptText(cells, i) {
  const x = i % WIDTH, y = Math.floor(i / WIDTH);
  const xm = (x + WIDTH - 1) % WIDTH, xp = (x + 1) % WIDTH;
  const ym = (y + HEIGHT - 1) % HEIGHT, yp = (y + 1) % HEIGHT;
  const nb = [
    cells[ym * WIDTH + xm], cells[ym * WIDTH + x], cells[ym * WIDTH + xp],
    cells[y * WIDTH + xm], cells[y * WIDTH + xp],
    cells[yp * WIDTH + xm], cells[yp * WIDTH + x], cells[yp * WIDTH + xp],
  ];
  return `Neighbors: ${nb.join(' ')} / Self: ${cells[i]} / Next: `;
}

function fullPromptText(cells, i) {
  return PREFIX_TEXT + '\n' + cellPromptText(cells, i);
}

let engine = null;
let board = new Uint8Array(CELLS);
let resetBoard = null; // set by a 'reset' message; applied at the next safe point
let playing = false;
let resumeWaiters = [];

// A real macrotask yield (setTimeout), not Promise.resolve(): a chain of
// microtask-only awaits (one `logitsCellA` resolution feeding straight into
// the next) never lets the event loop drain its macrotask queue, so an
// already-posted 'pause' message sits unprocessed and the sweep never
// notices it was asked to stop, which showed up on Firefox Android's slow
// CPU backend as pause doing nothing. Yielding for real between every
// cell, playing or not, guarantees the pause/play message is handled
// before the next cell starts.
function waitForPlay() {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (playing) { resolve(); return; }
      resumeWaiters.push(resolve);
    }, 0);
  });
}

function setPlaying(v) {
  playing = v;
  if (v) {
    const waiters = resumeWaiters;
    resumeWaiters = [];
    waiters.forEach((r) => r());
  }
}

let backendPhrase = '';

function phraseFor(picked) {
  if (picked.backend === 'webgpu') return 'the GPU';
  if (picked.backend === 'threads') return `the CPU, ${picked.threadCount} threads`;
  return 'the CPU';
}

// The base model (gguf + tokenizer) and the adapter are two getModel calls
// (two cache names), combined into one progress bar by weight: the GGUF
// dominates, the tokenizer and adapter are small.
const BASE_WEIGHT = 0.95;
const ADAPTER_WEIGHT = 0.05;

async function load(initialBoard) {
  board = initialBoard;
  const picked = await pickLeanBackend('auto', ENGINE_BUILD);
  // caps.adapter carries the auto-pick's WebGPU diagnosis (no adapter, a
  // requestAdapter rejection, or "no navigator.gpu") even when the backend
  // auto-picked something else; pickLeanBackend never surfaces it anywhere,
  // so a silent CPU fallback on a WebGPU-capable phone was previously
  // undiagnosable from the console alone. Console only, never the status
  // line (that copy is unchanged).
  if (picked.backend !== 'webgpu') console.log(`[llm-life] backend ${picked.backend} (webgpu: ${picked.caps.adapter})`);
  backendPhrase = phraseFor(picked);
  engine = await createLifeEngine(picked, WIDTH, HEIGHT);

  const onStatus = (message) => self.postMessage({ type: 'status', message });

  let [ggufBytes, tokenizerBytes] = await getModel([urls.gguf, urls.tokenizer], {
    cache: QWEN_CACHE,
    onProgress: (loaded, total) => self.postMessage({ type: 'progress', fraction: total ? (loaded / total) * BASE_WEIGHT : 0 }),
    onStatus,
  });
  for (const shard of splitIntoChunks(ggufBytes)) engine.appendModelShard(shard);
  // Drop the JS-side copy of the ~430 MB GGUF now that every shard is copied
  // into the wasm engine's own memory: it would otherwise stay referenced
  // (this closure's local) through engine.load() and the adapter download
  // right below, doubling peak memory at exactly the point an Android
  // phone's progress bar hung (95-97%, right as the model finishes
  // loading).
  ggufBytes = null;
  await engine.load(new TextDecoder().decode(tokenizerBytes), 'B3/S23');

  const [adapterBytes] = await getModel([urls.adapter], {
    cache: ADAPTER_CACHE,
    onProgress: (loaded, total) => self.postMessage({ type: 'progress', fraction: BASE_WEIGHT + (total ? (loaded / total) * ADAPTER_WEIGHT : 0) }),
    onStatus,
  });
  await engine.loadAdapter(adapterBytes, true);

  self.postMessage({ type: 'ready', backendPhrase });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tokens/second of prompt processing, timed around the engine call only,
// averaged over the last 16 cells. r[3] is the per-cell prompt's token count
// (logitsCellA reuses the resident prefix and only forwards this part),
// ~28 tokens for this crate's prompt shape.
const TOK_WINDOW = 16;
const tokSamples = [];
function recordTokSec(promptTokens, elapsedMs) {
  tokSamples.push(promptTokens / (elapsedMs / 1000));
  if (tokSamples.length > TOK_WINDOW) tokSamples.shift();
  return Math.round(tokSamples.reduce((a, b) => a + b, 0) / tokSamples.length);
}

// Sweeps the board forever, cell by cell, back to back, with no per-cell
// hold, so the real per-cell speed is visible. The CURRENT generation
// stays on screen unchanged while a sweep runs, so a visitor can still
// tell which cells are alive and which are dead. Only the decided cell's
// change (if any) is reported, so the page can mark it instead of
// overwriting it. The next generation is applied all at once when the
// sweep finishes, then the board holds for ~1.5s before the next sweep
// starts, giving a visible pause between full board generations. A
// 'reset' message (new starting pattern) interrupts the current sweep or
// hold and restarts fresh.
async function sweep() {
  for (;;) {
    if (resetBoard) { board = resetBoard; resetBoard = null; }
    const next = new Uint8Array(CELLS);
    let interrupted = false;
    // Cells/second of the sweep itself, running estimate from the first
    // answered cell: cells answered so far over activeMs, the sum of each
    // cell's own compute time only. Never wall-clock time since the sweep
    // started, which would count time spent paused mid-sweep and inflate
    // the per-generation rate. Also excludes the pause between
    // generations, since activeMs starts fresh every
    // sweep.
    let activeMs = 0;
    for (let i = 0; i < CELLS; i++) {
      await waitForPlay();
      if (resetBoard) { interrupted = true; break; }
      const x = i % WIDTH, y = Math.floor(i / WIDTH);
      self.postMessage({ type: 'select', index: i, prompt: fullPromptText(board, i) });
      const t0 = performance.now();
      const r = await engine.logitsCellA(board, i);
      const dt = performance.now() - t0;
      activeMs += dt;
      const tokSec = recordTokSec(r[3], dt);
      const alive = r[1] > r[0] ? 1 : 0;
      next[i] = alive;
      const cellsPerSec = (i + 1) / (activeMs / 1000);
      self.postMessage({ type: 'cell', index: i, x, y, state: alive, dead: r[0], alive: r[1], tokSec, cellsPerSec });
    }
    if (interrupted) continue;
    self.postMessage({ type: 'generation', cells: Array.from(next) });
    await sleep(1500);
    if (resetBoard) continue;
    board = next;
  }
}

async function handle(msg) {
  try {
    if (msg.type === 'load') {
      await load(Uint8Array.from(msg.board));
      sweep().catch((err) => self.postMessage({ type: 'error', message: String(err && err.message || err) }));
    } else if (msg.type === 'play') {
      setPlaying(true);
    } else if (msg.type === 'pause') {
      setPlaying(false);
    } else if (msg.type === 'reset') {
      resetBoard = Uint8Array.from(msg.board);
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
}

self.onmessage = (e) => handle(e.data);
for (const e of pending) handle(e.data);
pending.length = 0;
