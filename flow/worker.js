// Module worker: picks the path by capability (WebGPU if an adapter is
// granted, else wasm threads if the page is cross-origin isolated with more
// than one hardware thread, else wasm single thread), loads that build, and
// steps the simulation, posting the vorticity field and obstacle mask after
// every batch of steps.
//   in:  { type: 'init' }
//   out: { type: 'frame', field, obstacle, width, height, status }
//        { type: 'error', status }
const ENGINE_BUILD = new URL(import.meta.url).searchParams.get('v');

const MODE = 'randomize';
// The street the page was tuned on, run on WebGPU, and a smaller one for the
// CPU paths (a third of the sites, Re about 78), where the street forms in
// about 8k steps.
const FULL = { model: 'signed', w: 1536, h: 512, u: 0.25, block: 16, refblock: 8 };
const SMALL = { model: 'signed', w: 896, h: 336, u: 0.25, block: 8, refblock: 8 };

let stepsPerFrame = 10;

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

// Fixed cost of one frame without steps (readback and field), best of 3.
// Pacing aims each frame at max(40 ms, twice that cost), so a slow readback
// lowers the picture rate instead of the step count.
async function frameCost(sim) {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    sim.advance(0);
    await sim.sample();
    sim.field();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

async function loop({ sim, label }) {
  const target = Math.max(40, 2 * (await frameCost(sim)));
  const recent = [];
  while (true) {
    const n = stepsPerFrame;
    const t0 = performance.now();
    sim.advance(n);
    await sim.sample();
    const field = sim.field();
    const obstacle = sim.obstacle();
    const dt = performance.now() - t0;
    recent.push([n, dt]);
    if (recent.length > 20) recent.shift();
    const steps = recent.reduce((a, r) => a + r[0], 0);
    const ms = recent.reduce((a, r) => a + r[1], 0);
    const rate = (steps * sim.sites) / (ms / 1000);
    const status = `${label}, ${(rate / 1e6).toFixed(0)} M site updates/s · Re ${sim.reynolds.toFixed(0)}`;
    post({ type: 'frame', field, obstacle, width: sim.imageWidth, height: sim.imageHeight, status }, [field.buffer, obstacle.buffer]);
    if (dt < 0.8 * target && stepsPerFrame < 4000) stepsPerFrame *= 2;
    else if (dt > 2 * target && stepsPerFrame > 1) stepsPerFrame = Math.max(1, stepsPerFrame >> 1);
    await new Promise((r) => setTimeout(r, 0));
  }
}

self.onmessage = async (e) => {
  try {
    await loop(await init());
  } catch (err) {
    post({ type: 'error', status: `failed to start: ${err.message || err}` });
  }
};
