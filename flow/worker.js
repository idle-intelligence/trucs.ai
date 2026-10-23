// Module worker: picks the path by capability (WebGPU if an adapter is
// granted, else wasm threads if the page is cross-origin isolated with more
// than one hardware thread, else wasm single thread), loads that build, and
// steps the simulation, posting the vorticity field and obstacle mask when
// the page asks for a picture.
//   in:  { type: 'init' } | { type: 'want' }
//   out: { type: 'frame', field, obstacle, width, height, status, steps }
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
  return { sim, label, gpu: path === 'webgpu' };
}

// Running and drawing are separate. The simulation steps in batches as
// fast as it can and never waits on the display; the time average is folded
// on the device, so stepping reads nothing back. The page asks for a picture
// when it is ready to draw one ({ type: 'want' }) and gets the latest field.
//
// On WebGPU one read-back of the average is kept in flight: a new one is
// queued as soon as the last has landed. The worker stops queueing steps
// only when more than Q ms of work is queued beyond the last landed read,
// with Q the shortest recent read delay and at least one display frame: the
// GPU stays busy even where a read takes long to land, and the queue stays
// short enough for a read to land about every frame. A batch is 1/120 s of the measured stepping rate (at least one
// sample, 5 steps). On the CPU paths the field is always current and the
// same batch rule keeps each batch near 8 ms of work.
const SAMPLE_EVERY = 5;
const MAX_BATCH = 4000;
const FRAME_MS = 1000 / 60;
let wanted = true;

// A yield to the event loop that is not clamped like setTimeout.
const channel = new MessageChannel();
let resume = null;
channel.port1.onmessage = () => resume && resume();
const yieldNow = () => new Promise((r) => { resume = r; channel.port2.postMessage(0); });

async function loop({ sim, label, gpu }) {
  let batch = SAMPLE_EVERY;
  let issued = 0;
  let readAt = 0; // steps issued when the read in flight was queued
  let readT = 0; // and when
  let done = 0; // steps known to be done (at the last landed read)
  let rate = 0; // steps per second
  const landed = []; // [steps, time] at the recent landed reads (GPU) or batches (CPU)
  const delays = []; // recent read delays, ms
  while (true) {
    sim.advance(batch);
    issued += batch;
    if (!sim.reading) {
      sim.requestField();
      readAt = issued;
      readT = performance.now();
    }
    const q = Math.max(FRAME_MS, Math.min(...delays, Infinity));
    const queued = rate > 0 ? ((issued - done) / rate) * 1000 : issued - readAt >= 2 * batch ? Infinity : 0;
    if (sim.reading && queued > q) await sim.waitField();
    else await yieldNow();
    if (!sim.fieldReady()) continue;
    // A newer field: from the read just landed (GPU) or current (CPU).
    const now = performance.now();
    done = gpu ? readAt : issued;
    if (gpu) {
      delays.push(now - readT);
      if (delays.length > 30) delays.shift();
    }
    landed.push([done, now]);
    if (landed.length > 30) landed.shift();
    const [s0, t1] = landed[0];
    if (now > t1 && done > s0) rate = ((done - s0) / (now - t1)) * 1000;
    if (rate > 0) {
      const target = rate / 120;
      batch = Math.min(MAX_BATCH, Math.max(SAMPLE_EVERY, Math.round((0.8 * batch + 0.2 * target) / SAMPLE_EVERY) * SAMPLE_EVERY));
    }
    if (wanted) {
      wanted = false;
      const field = sim.field();
      const obstacle = sim.obstacle();
      const status = `${label}, ${((rate * sim.sites) / 1e6).toFixed(0)} M site updates/s · Re ${sim.reynolds.toFixed(0)}`;
      post({ type: 'frame', field, obstacle, width: sim.imageWidth, height: sim.imageHeight, status, steps: batch }, [field.buffer, obstacle.buffer]);
    }
  }
}

self.onmessage = async (e) => {
  if (e.data.type === 'want') {
    wanted = true;
    return;
  }
  try {
    await loop(await init());
  } catch (err) {
    post({ type: 'error', status: `failed to start: ${err.message || err}` });
  }
};
