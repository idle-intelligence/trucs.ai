// Module worker: picks the path by capability (WebGPU if an adapter is
// granted, else wasm threads if the page is cross-origin isolated with more
// than one hardware thread, else wasm single thread), loads that build, and
// steps the simulation, posting the vorticity field and obstacle mask after
// every batch of steps.
//   in:  { type: 'init' } | { type: 'painted' }
//   out: { type: 'frame', field, obstacle, width, height, status, steps, fixed, perStep }
//        { type: 'error', status }
const ENGINE_BUILD = new URL(import.meta.url).searchParams.get('v');

const MODE = 'randomize';
// The street the page was tuned on, run on WebGPU, and a smaller one for the
// CPU paths (a third of the sites, Re about 78), where the street forms in
// about 8k steps.
const FULL = { model: 'signed', w: 1536, h: 512, u: 0.25, block: 16, refblock: 8 };
const SMALL = { model: 'signed', w: 896, h: 336, u: 0.25, block: 8, refblock: 8 };

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

async function init() {
  const threadsOk = self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined' && navigator.hardwareConcurrency > 1;
  const path = (await hasAdapter()) ? 'webgpu' : threadsOk ? 'threads' : 'single';
  const { model: MODEL, w: W, h: H, u: U, block: BLOCK, refblock: REFBLOCK } = path === 'webgpu' ? FULL : SMALL;
  let sim, label;
  if (path === 'threads') {
    const mod = await import(`./pkg-mt/fhp.js?v=${ENGINE_BUILD}`);
    await mod.default(`./pkg-mt/fhp_bg.wasm?v=${ENGINE_BUILD}`);
    mod.fhpInit();
    await mod.initThreadPool(navigator.hardwareConcurrency);
    sim = mod.Sim.createCpu(MODEL, W, H, U, MODE, BLOCK, REFBLOCK);
    label = `wasm threads (${sim.threads})`;
  } else {
    const mod = await import(`./pkg/fhp.js?v=${ENGINE_BUILD}`);
    await mod.default(`./pkg/fhp_bg.wasm?v=${ENGINE_BUILD}`);
    mod.fhpInit();
    sim = path === 'webgpu' ? await mod.Sim.createGpu(MODEL, W, H, U, MODE, BLOCK, REFBLOCK) : mod.Sim.createCpu(MODEL, W, H, U, MODE, BLOCK, REFBLOCK);
    label = path === 'webgpu' ? 'WebGPU' : 'wasm single';
  }
  return { sim, label };
}

// One frame is a batch of steps, the readback and the field. Time one frame
// at two step counts (best of five after a warm-up) and fit
// ms = fixed + perStep * steps.
async function calibrate(sim) {
  const frame = async (n) => {
    const t = performance.now();
    sim.advance(n);
    await sim.sample();
    sim.field();
    sim.obstacle();
    return performance.now() - t;
  };
  const best = async (n) => {
    const v = [];
    for (let i = 0; i < 5; i++) v.push(await frame(n));
    return Math.min(...v);
  };
  await frame(1);
  const lo = await best(1);
  const hi = await best(9);
  const perStep = Math.max((hi - lo) / 8, 0.01);
  return { fixed: Math.max(lo - perStep, 0), perStep };
}

// Pacing. The page paints one frame per 1/60 s (every second refresh on a
// 120 Hz display) and answers each paint with { type: 'painted' }. The loop
// keeps at most two frames unpainted, so frames are made at the pace they are
// shown. Every frame runs the same whole number of steps, fixed once from the
// calibration so that the steps, the readback and the field take 85% of 1/60 s:
// the motion advances by equal amounts at an even pace.
const FRAME_MS = 1000 / 60;
let unpainted = 0;
let wake = null;

async function loop({ sim, label }) {
  const { fixed, perStep } = await calibrate(sim);
  const n = Math.min(4000, Math.max(1, Math.floor((0.85 * FRAME_MS - fixed) / perStep)));
  const recent = [];
  while (true) {
    while (unpainted >= 2) await new Promise((r) => (wake = r));
    sim.advance(n);
    await sim.sample();
    const field = sim.field();
    const obstacle = sim.obstacle();
    const now = performance.now();
    recent.push([n, now]);
    if (recent.length > 21) recent.shift();
    const steps = recent.reduce((a, r) => a + r[0], 0) - recent[0][0];
    const ms = now - recent[0][1];
    const rate = ms > 0 ? (steps * sim.sites) / (ms / 1000) : 0;
    const status = `${label}, ${(rate / 1e6).toFixed(0)} M site updates/s · Re ${sim.reynolds.toFixed(0)}`;
    unpainted++;
    post({ type: 'frame', field, obstacle, width: sim.imageWidth, height: sim.imageHeight, status, steps: n, fixed, perStep }, [field.buffer, obstacle.buffer]);
    await new Promise((r) => setTimeout(r, 0));
  }
}

self.onmessage = async (e) => {
  if (e.data.type === 'painted') {
    unpainted = Math.max(0, unpainted - 1);
    if (wake) wake();
    return;
  }
  try {
    await loop(await init());
  } catch (err) {
    post({ type: 'error', status: `failed to start: ${err.message || err}` });
  }
};
