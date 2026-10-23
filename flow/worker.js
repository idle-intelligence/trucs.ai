// Module worker: picks the path by capability (WebGPU if an adapter is
// granted and the engine starts on it, else wasm threads if the page is
// cross-origin isolated with more than one hardware thread, else wasm single
// thread), loads that build, and steps the simulation, posting the vorticity
// field and obstacle mask when the page asks for a picture.
//   in:  { type: 'init', layout: 'wide' | 'narrow' } | { type: 'want' }
//        | { type: 'pause' } | { type: 'run' }
//   out: { type: 'frame', field, obstacle, width, height, status, steps }
//        { type: 'status', status } | { type: 'error', status }
const ENGINE_BUILD = new URL(import.meta.url).searchParams.get('v');

const MODE = 'randomize';
// On WebGPU the wide layout runs the large street. The narrow (vertical)
// layout runs a smaller one that forms sooner on a phone, on the GPU and on
// the CPU alike; the wide layout on the CPU runs the smallest, where the
// street forms in about 8k steps.
const STREETS = {
  wide: { model: 'signed', w: 2048, h: 768, u: 0.2, block: 8, refblock: 8 },
  narrow: { model: 'signed', w: 1536, h: 512, u: 0.25, block: 8, refblock: 8 },
  cpu: { model: 'signed', w: 896, h: 336, u: 0.25, block: 8, refblock: 8 },
};

function post(msg, transfer) {
  self.postMessage(msg, transfer || []);
}

async function hasAdapter() {
  try {
    return !!(navigator.gpu && (await navigator.gpu.requestAdapter()));
  } catch {
    return false;
  }
}

const create = (mod, s, gpu) => (gpu ? mod.Sim.createGpu(s.model, s.w, s.h, s.u, MODE, s.block, s.refblock) : mod.Sim.createCpu(s.model, s.w, s.h, s.u, MODE, s.block, s.refblock));

// The GPU engine if an adapter is granted and the engine starts on it
// without an error; otherwise null.
async function initGpu(layout) {
  if (!(await hasAdapter())) return null;
  try {
    const mod = await import(`./pkg/fhp.js?v=${ENGINE_BUILD}`);
    await mod.default({ module_or_path: `./pkg/fhp_bg.wasm?v=${ENGINE_BUILD}` });
    mod.fhpInit();
    const sim = await create(mod, STREETS[layout === 'narrow' ? 'narrow' : 'wide'], true);
    if (sim.gpuError) return null;
    return { sim, label: 'WebGPU', gpu: true };
  } catch {
    return null;
  }
}

async function initCpu(layout) {
  const threads = self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined' && navigator.hardwareConcurrency > 1;
  const mod = await import(`./${threads ? 'pkg-mt' : 'pkg'}/fhp.js?v=${ENGINE_BUILD}`);
  await mod.default({ module_or_path: `./${threads ? 'pkg-mt' : 'pkg'}/fhp_bg.wasm?v=${ENGINE_BUILD}` });
  mod.fhpInit();
  if (threads) await mod.initThreadPool(navigator.hardwareConcurrency);
  const sim = create(mod, layout === 'narrow' ? STREETS.narrow : STREETS.cpu, false);
  return { sim, label: threads ? `wasm threads (${sim.threads})` : 'wasm single', gpu: false };
}

// Running and drawing are separate. The simulation steps in batches and never
// waits on the display; the time average is folded on the device, so stepping
// reads nothing back. The page asks for a picture when it is ready to draw one
// ({ type: 'want' }) and gets the latest field.
//
// On WebGPU one read-back of the average is in flight at a time, a new one
// queued as soon as the last lands. The worker keeps queueing batches until
// the work queued beyond the last landed read exceeds one display frame plus
// the read latency: the GPU keeps working while a read is pending however long
// reads take, and the queue stays one frame ahead of what a read needs. A probe
// at the start measures the read latency (a read with nothing queued) and the
// stepping rate (a read with steps queued, minus that latency); the rate is the
// highest measured since, and work is counted at that rate. A batch is 1/120 s
// of steps (at least one sample, 5 steps). On the CPU paths the field is always current and the same batch
// rule keeps each batch near 8 ms of work.
//
// A GPU error, a lost device, three failed reads in a row or no read landing
// for 20 s stop the GPU path: the status line says why and the simulation
// restarts on the CPU. A picture that is late shows in the status line.
// Stepping pauses while the page is hidden.
const SAMPLE_EVERY = 5;
const MAX_BATCH = 4000;
const FRAME_MS = 1000 / 60;
const STALL_MS = 20000;
let wanted = true;
let paused = false;
let unpause = null;

// A yield to the event loop that is not clamped like setTimeout.
const channel = new MessageChannel();
let resume = null;
channel.port1.onmessage = () => resume && resume();
const yieldNow = () => new Promise((r) => { resume = r; channel.port2.postMessage(0); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toBatch = (steps) => Math.min(MAX_BATCH, Math.max(SAMPLE_EVERY, Math.round(steps / SAMPLE_EVERY) * SAMPLE_EVERY));

// Wait until the read in flight (if any) and then a new read have landed;
// false if they did not within 10 s.
async function settle(sim) {
  const t = performance.now();
  for (let asked = false; performance.now() - t < 10000; ) {
    if (!sim.reading) {
      if (asked && sim.fieldReady()) return true;
      sim.requestField();
      asked = true;
    }
    await Promise.race([sim.waitField(), sleep(100)]);
    if (sim.fieldReady() && asked && !sim.reading) return true;
  }
  return false;
}

// Measured once at the start: the read latency (the round trip of a read with
// nothing queued, ms) and the GPU's stepping rate (steps per second, from the
// round trip of a read with n steps queued ahead of it minus that latency, so
// slow reads do not lower it).
async function probe(sim) {
  sim.advance(SAMPLE_EVERY);
  if (!(await settle(sim))) return { rate: 0, latency: 0 };
  let t0 = Infinity;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    if (!(await settle(sim))) return { rate: 0, latency: 0 };
    t0 = Math.min(t0, performance.now() - t);
  }
  for (let n = 20; ; n *= 2) {
    const t = performance.now();
    sim.advance(n);
    if (!(await settle(sim))) return { rate: 0, latency: t0 };
    const ms = performance.now() - t - t0;
    if (ms > 50 || n >= MAX_BATCH) return { rate: (n / Math.max(ms, 1)) * 1000, latency: t0 };
  }
}

// Steps until the path fails; returns the reason (GPU only).
async function loop({ sim, label, gpu }) {
  let batch = SAMPLE_EVERY;
  let issued = 0;
  let done = 0; // steps known to be done (at the last landed read)
  let readAt = 0; // steps issued when the read in flight was queued
  const p = gpu ? await probe(sim) : { rate: 0, latency: 0 };
  let rate = p.rate; // highest stepping rate measured, steps per second
  // The queue bound: one display frame plus the read latency, in ms of work.
  const q = FRAME_MS + p.latency;
  let failures = sim.readFailures;
  let lastLand = performance.now();
  let last = null; // [steps, time] at the previous landed read (GPU) or batch (CPU)
  const seen = []; // [steps, time] over the last 2 s, for the status line
  let shown = 0;
  let told = 0; // whole seconds without a picture already reported
  while (true) {
    if (paused) {
      while (paused) await new Promise((r) => (unpause = r));
      lastLand = performance.now();
    }
    sim.advance(batch);
    issued += batch;
    if (!sim.reading) {
      sim.requestField();
      readAt = issued;
    }
    let wait = false;
    if (sim.reading) wait = rate > 0 ? ((issued - done) / rate) * 1000 > q : issued - done >= 4 * batch;
    // A read that never lands must not stop the checks below: wait at most 1 s.
    await (wait ? Promise.race([sim.waitField(), sleep(1000)]) : yieldNow());
    const now = performance.now();
    if (gpu) {
      const err = sim.gpuError;
      if (err) return err;
      if (sim.readFailures >= failures + 3) return 'the read-back of the picture keeps failing';
      if (now - lastLand > STALL_MS) return `no new picture for ${STALL_MS / 1000} s`;
      const late = Math.floor((now - lastLand) / 1000);
      if (late >= 3 && late > told) {
        told = late;
        post({ type: 'status', status: `${label}: no new picture for ${late} s` });
      }
    }
    if (!sim.fieldReady()) continue;
    // A newer field: from the read just landed (GPU) or current (CPU).
    failures = sim.readFailures;
    lastLand = now;
    told = 0;
    done = gpu ? readAt : issued;
    if (last && now > last[1] && done > last[0]) rate = Math.max(rate, ((done - last[0]) / (now - last[1])) * 1000);
    last = [done, now];
    seen.push(last);
    while (seen.length > 2 && now - seen[1][1] > 2000) seen.shift();
    if (now > seen[0][1]) shown = ((done - seen[0][0]) / (now - seen[0][1])) * 1000;
    if (rate > 0) batch = toBatch(rate / 120);
    if (wanted) {
      wanted = false;
      const field = sim.field();
      const obstacle = sim.obstacle();
      const status = `${label}, ${((shown * sim.sites) / 1e6).toFixed(0)} M site updates/s · Re ${sim.reynolds.toFixed(0)}`;
      post({ type: 'frame', field, obstacle, width: sim.imageWidth, height: sim.imageHeight, status, steps: batch }, [field.buffer, obstacle.buffer]);
    }
  }
}

async function start(layout) {
  const g = await initGpu(layout);
  if (g) {
    const reason = await loop(g);
    g.sim.free();
    post({ type: 'status', status: `WebGPU stopped (${reason}); continuing on the CPU` });
  }
  await loop(await initCpu(layout));
}

self.addEventListener('unhandledrejection', (e) => post({ type: 'error', status: `stopped: ${e.reason && e.reason.message ? e.reason.message : e.reason}` }));

self.onmessage = async (e) => {
  const t = e.data.type;
  if (t === 'want') {
    wanted = true;
  } else if (t === 'pause') {
    paused = true;
  } else if (t === 'run') {
    paused = false;
    if (unpause) unpause();
  } else if (t === 'init') {
    try {
      await start(e.data.layout);
    } catch (err) {
      post({ type: 'error', status: `failed to start: ${err.message || err}` });
    }
  }
};
