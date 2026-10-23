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
    await mod.default({ module_or_path: `./pkg-mt/fhp_bg.wasm?v=${ENGINE_BUILD}` });
    mod.fhpInit();
    await mod.initThreadPool(navigator.hardwareConcurrency);
    sim = mod.Sim.createCpu(MODEL, W, H, U, MODE, BLOCK, REFBLOCK);
    label = `wasm threads (${sim.threads})`;
  } else {
    const mod = await import(`./pkg/fhp.js?v=${ENGINE_BUILD}`);
    await mod.default({ module_or_path: `./pkg/fhp_bg.wasm?v=${ENGINE_BUILD}` });
    mod.fhpInit();
    sim = path === 'webgpu' ? await mod.Sim.createGpu(MODEL, W, H, U, MODE, BLOCK, REFBLOCK) : mod.Sim.createCpu(MODEL, W, H, U, MODE, BLOCK, REFBLOCK);
    label = path === 'webgpu' ? 'WebGPU' : 'wasm single';
  }
  return { sim, label, gpu: path === 'webgpu' };
}

// Running and drawing are separate. The simulation steps in batches and never
// waits on the display; the time average is folded on the device, so stepping
// reads nothing back. The page asks for a picture when it is ready to draw one
// ({ type: 'want' }) and gets the latest field.
//
// On WebGPU one read-back of the average is kept in flight, a new one queued
// as soon as the last lands. The GPU is kept busy (an idle GPU also clocks
// down): the worker stops queueing only when the work queued beyond the last
// landed read exceeds Q = one display frame plus the read latency, capped at
// MAX_QUEUE_MS. Work is counted in ms at the stepping rate, the highest rate
// measured over the recent reads (so waiting never lowers it), and the read
// latency is a read's delay minus the work queued ahead of it, the smallest
// recent one. A batch is 1/120 s at that rate (at least one sample, 5 steps).
// On the CPU paths the field is always current and the same batch rule keeps
// each batch near 8 ms of work.
const SAMPLE_EVERY = 5;
const MAX_BATCH = 4000;
const FRAME_MS = 1000 / 60;
const MAX_QUEUE_MS = 100;
let wanted = true;

// A yield to the event loop that is not clamped like setTimeout.
const channel = new MessageChannel();
let resume = null;
channel.port1.onmessage = () => resume && resume();
const yieldNow = () => new Promise((r) => { resume = r; channel.port2.postMessage(0); });

async function loop({ sim, label, gpu }) {
  let batch = SAMPLE_EVERY;
  let issued = 0;
  let done = 0; // steps known to be done (at the last landed read)
  let readAt = 0; // steps issued when the read in flight was queued
  let readT = 0; // and when
  let readAhead = 0; // steps queued ahead of it then
  let rate = 0; // steps per second
  const landed = []; // [steps, time] at the recent landed reads (GPU) or batches (CPU)
  const rates = []; // [time, rate] over windows of recent landings
  const latencies = []; // recent read latencies, ms
  while (true) {
    sim.advance(batch);
    issued += batch;
    if (!sim.reading) {
      sim.requestField();
      readT = performance.now();
      readAhead = issued - done;
      readAt = issued;
    }
    let wait = false;
    if (sim.reading) {
      if (rate > 0) {
        const q = Math.min(MAX_QUEUE_MS, FRAME_MS + Math.min(...latencies, Infinity));
        wait = ((issued - done) / rate) * 1000 > q;
      } else {
        wait = issued - done >= 4 * batch;
      }
    }
    await (wait ? sim.waitField() : yieldNow());
    if (!sim.fieldReady()) continue;
    // A newer field: from the read just landed (GPU) or current (CPU).
    const now = performance.now();
    done = gpu ? readAt : issued;
    landed.push([done, now]);
    if (landed.length > 12) landed.shift();
    const [s0, t1] = landed[0];
    if (landed.length >= 4 && now > t1) {
      rates.push([now, ((done - s0) / (now - t1)) * 1000]);
      while (rates.length && now - rates[0][0] > 5000) rates.shift();
      rate = Math.max(...rates.map((r) => r[1]));
    }
    if (gpu && rate > 0) {
      latencies.push(Math.max(0, now - readT - (readAhead / rate) * 1000));
      if (latencies.length > 30) latencies.shift();
    }
    if (rate > 0) {
      const target = rate / 120;
      batch = Math.min(MAX_BATCH, Math.max(SAMPLE_EVERY, Math.round((0.8 * batch + 0.2 * target) / SAMPLE_EVERY) * SAMPLE_EVERY));
    }
    if (wanted) {
      wanted = false;
      const field = sim.field();
      const obstacle = sim.obstacle();
      const shown = landed.length > 1 ? ((done - s0) / (now - t1)) * 1000 : 0;
      const status = `${label}, ${((shown * sim.sites) / 1e6).toFixed(0)} M site updates/s · Re ${sim.reynolds.toFixed(0)}`;
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
