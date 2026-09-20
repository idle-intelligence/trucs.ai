/**
 * Web Worker: loads the t0-wasm module + model once, then loads whichever
 * series the page picks (bundled file or a live HTTP fetch) and runs
 * forecasts against it. Nothing live is fetched until a live series is
 * actually clicked -- the model download runs first and alone. A live
 * fetch's result is cached in memory for the session, so a second click on
 * the same series is instant.
 *
 * Protocol:
 *   Main -> Worker:
 *     { type: 'loadIndex' }                              -- fetch data/index.json alone, no WASM/model
 *     { type: 'load' }                                  -- fetch WASM + model, init
 *     { type: 'loadSeries', index }                      -- fetch/parse the series at data/index.json[index]
 *     { type: 'forecast', origin: number, horizon: number, requestId: number }
 *
 *   Worker -> Main:
 *     { type: 'status', text, key? }
 *     { type: 'indexReady', seriesIndex }
 *     { type: 'modelReady', modelBytes, loadMs, nQuantiles, backend, seriesIndex }
 *     { type: 'seriesReady', index, series, dates, name, unit, frequency, defaultOriginIndex, naive, live }
 *     { type: 'seriesOffline', index, name, reason }
 *     { type: 'forecast', origin, requestId, quantiles, nQuantiles, horizon, ms }
 *     { type: 'error', message }
 */

// TODO(TC): once t0-alpha-q8_0.gguf is published, replace LOCAL model
// fetching below with this Hub URL.
const MODEL_HUB_URL = 'https://huggingface.co/idle-intelligence/t0-alpha-q8_0/resolve/main/t0-alpha-q8_0.gguf';
const MODEL_URL = new URL('./models/t0-alpha-q8_0.gguf', import.meta.url).href;
const INDEX_URL = new URL('./data/index.json', import.meta.url).href;
const CACHE_NAME = 't0-model-v1';

const CONTEXT_CAP = 512;
// Matches MAX_LIVE_WINDOW in index.html -- the last N points shown for a
// live series with no fixed window, used to place the 60%-into-window
// default origin below.
const MAX_LIVE_WINDOW = 190;
// Base backoff before retrying IEM's asos.py specifically -- it's the one
// endpoint here that's slow and prone to 429/503 under load.
const IEM_RETRY_STAGGER_MS = 350;

let t0wasm = null;
let model = null;
let seriesIndex = null; // parsed data/index.json

// WebGPU: t0-fast (crates/t0-fast, no Burn at inference, GGUF Q8_0/Q4_0
// weights kept resident on the GPU, no F32-expansion round trip -- see
// t0-web's docs/BENCHMARKS.md head-to-head table, ~34ms warm vs Burn's
// ~169ms). No WebGPU: Burn/burn-ndarray on CPU, same as t0-web's own page.
const HAS_WEBGPU = typeof navigator !== 'undefined' && !!navigator.gpu;
const BACKEND = HAS_WEBGPU ? 'WebGPU · t0-fast' : 'CPU';
const PKG_DIR = HAS_WEBGPU ? './pkg-fast' : './pkg';

self.onmessage = async (e) => {
    const { type, ...data } = e.data;
    try {
        if (type === 'loadIndex') {
            await handleLoadIndex();
        } else if (type === 'load') {
            await handleLoad();
        } else if (type === 'loadSeries') {
            await handleLoadSeries(data.index);
        } else if (type === 'forecast') {
            await handleForecast(data.origin, data.horizon, data.requestId);
        } else if (type === 'setActiveSeries') {
            self.__currentSeries = data.series;
        } else {
            console.warn('[worker] unknown message type:', type);
        }
    } catch (err) {
        self.postMessage({ type: 'error', message: err.message || String(err) });
    }
};

async function cachedFetch(url, label) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url);
    if (cached) {
        self.postMessage({ type: 'status', key: 'download', text: `${label} (cached)` });
        return await cached.arrayBuffer();
    }
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch ${url}: ${resp.status} ${resp.statusText}`);
    const contentLength = parseInt(resp.headers.get('Content-Length') || '0', 10);
    const reader = resp.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        if (contentLength > 0) {
            const pct = ((loaded / contentLength) * 100).toFixed(0);
            self.postMessage({ type: 'status', key: 'download', text: `${label}: ${pct}%` });
        }
    }
    const buf = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { buf.set(chunk, offset); offset += chunk.byteLength; }
    try {
        await cache.put(url, new Response(buf.buffer, { headers: { 'Content-Type': 'application/octet-stream' } }));
    } catch (cacheErr) { console.warn('[worker] could not cache:', cacheErr); }
    return buf.buffer;
}

async function fetchSeriesIndex() {
    if (seriesIndex) return seriesIndex;
    seriesIndex = await fetch(INDEX_URL).then((r) => r.json());
    return seriesIndex;
}

// Fetches only data/index.json -- no WASM, no model -- so the page can show
// the series picker and drawn data before the model is downloaded.
async function handleLoadIndex() {
    const idx = await fetchSeriesIndex();
    self.postMessage({ type: 'indexReady', seriesIndex: idx });
}

async function handleLoad() {
    self.postMessage({ type: 'status', text: `Loading WASM module (${BACKEND})...` });
    const wasmJsUrl = new URL(`${PKG_DIR}/t0_wasm.js`, import.meta.url).href;
    t0wasm = await import(wasmJsUrl);
    await t0wasm.default();
    await t0wasm.initBackend();

    self.postMessage({ type: 'status', key: 'download', text: 'Downloading model (Q8_0, ~109 MB)...' });
    const modelBuf = await cachedFetch(MODEL_URL, 'Downloading model');

    self.postMessage({ type: 'status', key: 'load', text: 'Loading model...' });
    const t0 = performance.now();
    model = t0wasm.T0Wasm.load(new Uint8Array(modelBuf));
    const loadMs = performance.now() - t0;
    self.postMessage({ type: 'status', key: 'load', text: `Model loaded in ${loadMs.toFixed(0)} ms, backend ${BACKEND}` });

    // Only data/index.json itself -- not any live source (IEM/NOAA/USGS/
    // OpenAQ) -- is fetched here; a live series' own data is fetched on
    // first click, in handleLoadSeries below. Reuses the index if
    // 'loadIndex' already fetched it before this download started.
    await fetchSeriesIndex();

    self.postMessage({
        type: 'modelReady',
        modelBytes: modelBuf.byteLength,
        loadMs,
        nQuantiles: model.nQuantiles(),
        backend: BACKEND,
        seriesIndex,
    });
}

// ---- calendar stepping for bundled series (D, W, 30T, MS) ----
function addFreq(date, freq, n) {
    const d = new Date(date.getTime());
    switch (freq) {
        case 'D': d.setUTCDate(d.getUTCDate() + n); return d;
        case 'W': d.setUTCDate(d.getUTCDate() + n * 7); return d;
        case '30T': d.setUTCMinutes(d.getUTCMinutes() + n * 30); return d;
        case '15T': d.setUTCMinutes(d.getUTCMinutes() + n * 15); return d;
        case 'H': d.setUTCHours(d.getUTCHours() + n); return d;
        case 'MS': d.setUTCMonth(d.getUTCMonth() + n); return d;
        default: throw new Error(`unknown freq ${freq}`);
    }
}
function parseStart(startDate) {
    return new Date(startDate.replace(' ', 'T') + 'Z');
}
function dateAtIndexGeneric(startDate, freq, i) {
    return addFreq(parseStart(startDate), freq, i);
}
function isoDateOrDatetime(d, freq) {
    return freq === 'D' || freq === 'W' || freq === 'MS' ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 16).replace('T', ' ');
}

// naive baseline offset per the spec: repeat-last-week for daily,
// repeat-last-day for sub-daily, persistence (last value) for weekly/monthly.
function naiveDescriptor(freq) {
    switch (freq) {
        case 'D': return { label: 'repeat-last-week', lag: 7 };
        case 'H': return { label: 'repeat-last-day', lag: 24 };
        case '30T': return { label: 'repeat-last-day', lag: 48 };
        case '15T': return { label: 'repeat-last-day', lag: 96 };
        case 'W': return { label: 'last value', lag: 0 };
        case 'MS': return { label: 'last value', lag: 0 };
        default: return { label: 'last value', lag: 0 };
    }
}

// entry.defaultOrigin may be coarser than the dates array's own format
// (e.g. "2008-09" against monthly dates "2008-09-01"), so this matches by
// nearest timestamp rather than exact string equality.
function looseTimeWorker(s) {
    const t = s.trim();
    return new Date(t.replace(' ', 'T') + (t.endsWith('Z') ? '' : 'Z')).getTime();
}
function findNearestDateIndex(dates, target) {
    const targetT = looseTimeWorker(target);
    let best = 0, bestDiff = Infinity;
    for (let i = 0; i < dates.length; i++) {
        const diff = Math.abs(looseTimeWorker(dates[i]) - targetT);
        if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadBundled(entry) {
    const base = new URL(`./data/${entry.file}`, import.meta.url).href;
    const metaUrl = new URL(`./data/${entry.meta}`, import.meta.url).href;
    const [buf, meta] = await Promise.all([
        fetch(base).then((r) => r.arrayBuffer()),
        fetch(metaUrl).then((r) => r.json()),
    ]);
    const values = Array.from(new Float32Array(buf));
    const dates = values.map((_, i) => isoDateOrDatetime(dateAtIndexGeneric(meta.start_date, meta.freq, i), meta.freq));
    return { values, dates, freq: meta.freq };
}

// ---- live sources ----
async function fetchLiveNoaaTide(entry) {
    // Drawn window stays the last ~8 days (MAX_LIVE_WINDOW points in
    // index.html); fetch enough extra hourly history before it -- 512h
    // (~21.3 days) of context, same rule as the METAR fetch below -- so the
    // model isn't starved of context at the default (or an early) origin.
    const end = new Date();
    const begin = new Date(end.getTime() - 30 * 86400000);
    const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${fmt(begin)}&end_date=${fmt(end)}&station=8443970&product=water_level&datum=MLLW&units=metric&time_zone=gmt&format=json`;
    const resp = await fetch(url);
    if (!resp.ok) { const err = new Error(`NOAA tide fetch failed: ${resp.status}`); err.status = resp.status; throw err; }
    const json = await resp.json();
    if (json.error) throw new Error(json.error.message || 'NOAA tide error');
    const rows = json.data; // 6-min native
    const decimated = rows.filter((_, i) => i % 10 === 0); // -> hourly
    const values = decimated.map((r) => parseFloat(r.v));
    const dates = decimated.map((r) => r.t.replace(' ', 'T').slice(0, 16).replace('T', ' '));
    return { values, dates, freq: 'H' };
}

async function fetchLiveUsgsDischarge(entry) {
    // Drawn window stays ~3 days; fetch 512 x 15min (~5.3 days) of extra
    // context before it -- 200h total (3d + 512*15min), no more.
    const end = new Date();
    const begin = new Date(end.getTime() - 200 * 3600000);
    const fmt = (d) => d.toISOString().slice(0, 19) + 'Z';
    const url = `https://waterservices.usgs.gov/nwis/iv/?sites=01646500&parameterCd=00060&startDT=${fmt(begin)}&endDT=${fmt(end)}&format=json`;
    const resp = await fetch(url);
    if (!resp.ok) { const err = new Error(`USGS fetch failed: ${resp.status}`); err.status = resp.status; throw err; }
    const json = await resp.json();
    const series = json.value?.timeSeries?.[0]?.values?.[0]?.value;
    if (!series || !series.length) throw new Error('USGS: no data returned');
    const values = series.map((v) => parseFloat(v.value));
    const dates = series.map((v) => v.dateTime.slice(0, 16).replace('T', ' '));
    return { values, dates, freq: '15T' };
}

async function fetchLiveMetar(entry) {
    // Drawn window stays ~7 days; fetch 512h (~21.3 days) of extra context
    // before it, ~29 days total.
    const end = new Date();
    const begin = new Date(end.getTime() - 29 * 86400000);
    const fmt = (d) => [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    const [y1, m1, d1] = fmt(begin);
    const [y2, m2, d2] = fmt(end);
    const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=LFPB&data=tmpc&year1=${y1}&month1=${m1}&day1=${d1}&year2=${y2}&month2=${m2}&day2=${d2}&tz=UTC&format=onlycomma&latlon=no&elev=no&missing=M&trace=T&direct=no&report_type=3`;
    const resp = await fetch(url);
    if (!resp.ok) { const err = new Error(`IEM METAR fetch failed: ${resp.status}`); err.status = resp.status; throw err; }
    const text = await resp.text();
    const lines = text.trim().split('\n').slice(1);
    const values = [], dates = [];
    for (const line of lines) {
        const [, valid, tmpc] = line.split(',');
        if (tmpc === 'M' || tmpc === '' || tmpc === undefined) continue;
        values.push(parseFloat(tmpc));
        dates.push(valid);
    }
    if (!values.length) throw new Error('IEM METAR: no data returned');
    return { values, dates, freq: 'H' };
}

async function fetchLiveOpenAq(entry) {
    // OpenAQ v3 requires an API key (X-API-Key header) that this
    // deployment does not have -- see web/data/README.md (series repo).
    // This always fails, surfacing "(offline)" on the button, per spec.
    const resp = await fetch(entry.liveUrl);
    if (!resp.ok) { const err = new Error(`OpenAQ requires an API key (HTTP ${resp.status})`); err.status = resp.status; throw err; }
    throw new Error('OpenAQ: unexpected success without a key -- parsing not implemented');
}

const LIVE_FETCHERS = {
    'noaa-tide': fetchLiveNoaaTide,
    'usgs-iv': fetchLiveUsgsDischarge,
    'iem-metar': fetchLiveMetar,
    'openaq-v3': fetchLiveOpenAq,
};

// Live fetches happen only on demand (first click on that series), never
// as a prefetch. Cached in memory for the life of the worker (the
// session), so a repeat click is instant.
const liveCache = new Map(); // index -> { status: 'ready' | 'offline', result?, reason? }

async function fetchWithRetry(fetcher, entry) {
    try {
        return await fetcher(entry);
    } catch (err) {
        if (err.status === 429 || err.status === 503) {
            const backoff = entry.liveApi === 'iem-metar'
                ? IEM_RETRY_STAGGER_MS * 2 + Math.random() * 400
                : 800 + Math.random() * 400;
            await sleep(backoff);
            return await fetcher(entry);
        }
        throw err;
    }
}

// 60% into the displayed window, matching index.html's MAX_LIVE_WINDOW slice.
function liveDefaultOriginIndex(n) {
    const start = Math.max(0, n - MAX_LIVE_WINDOW);
    const end = n - 1;
    return start + Math.round(0.6 * (end - start));
}

async function handleLoadSeries(index) {
    const entry = seriesIndex[index];
    try {
        let values, dates, freq;
        if (entry.live) {
            const cached = liveCache.get(index);
            if (cached && cached.status === 'ready') {
                ({ values, dates, freq } = cached.result);
            } else if (cached && cached.status === 'offline') {
                throw new Error(cached.reason);
            } else {
                self.postMessage({ type: 'status', text: `fetching ${entry.name}...` });
                const fetcher = LIVE_FETCHERS[entry.liveApi];
                if (!fetcher) throw new Error(`no fetcher for liveApi ${entry.liveApi}`);
                const t0 = performance.now();
                const result = await fetchWithRetry(fetcher, entry);
                const fetchMs = performance.now() - t0;
                liveCache.set(index, { status: 'ready', result });
                console.log(`[worker] ${entry.name} fetched in ${fetchMs.toFixed(0)}ms`);
                self.postMessage({ type: 'status', text: `${entry.name} fetched in ${(fetchMs / 1000).toFixed(1)}s` });
                ({ values, dates, freq } = result);
            }
        } else {
            self.postMessage({ type: 'status', text: `Loading ${entry.name}...` });
            ({ values, dates, freq } = await loadBundled(entry));
        }
        const n = values.length;
        const defaultOriginIndex = entry.live ? liveDefaultOriginIndex(n) : findNearestDateIndex(dates, entry.defaultOrigin);
        self.postMessage({
            type: 'seriesReady',
            index,
            name: entry.name,
            unit: entry.unit,
            frequency: freq,
            live: !!entry.live,
            series: values,
            dates,
            defaultOriginIndex,
            naive: naiveDescriptor(freq),
            source: entry.source,
            license: entry.license,
        });
    } catch (err) {
        const reason = err.message || String(err);
        if (entry.live && (!liveCache.has(index) || liveCache.get(index).status !== 'offline')) {
            liveCache.set(index, { status: 'offline', reason });
        }
        self.postMessage({ type: 'seriesOffline', index, name: entry.name, reason });
    }
}

async function handleForecast(origin, horizon, requestId) {
    if (!model || !self.__currentSeries) {
        self.postMessage({ type: 'error', message: 'forecast requested before model/series ready' });
        return;
    }
    const series = self.__currentSeries;
    const ctxStart = Math.max(0, origin - CONTEXT_CAP);
    const context = new Float32Array(series.slice(ctxStart, origin));
    const t0 = performance.now();
    const quantiles = await model.forecast(context, horizon);
    const ms = performance.now() - t0;
    self.postMessage({
        type: 'forecast',
        origin,
        requestId,
        quantiles: Array.from(quantiles),
        nQuantiles: model.nQuantiles(),
        horizon,
        ms,
    });
}
