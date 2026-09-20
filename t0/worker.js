/**
 * Web Worker: loads the t0-wasm module + model once, then loads whichever
 * series the page picks (bundled file or a live HTTP fetch) and runs
 * forecasts against it.
 *
 * Protocol:
 *   Main -> Worker:
 *     { type: 'load' }                                  -- fetch WASM + model, init
 *     { type: 'loadSeries', index }                      -- fetch/parse the series at data/index.json[index]
 *     { type: 'forecast', origin: number, requestId: number }
 *
 *   Worker -> Main:
 *     { type: 'status', text, key? }
 *     { type: 'modelReady', modelBytes, loadMs, nQuantiles, horizon, backend }
 *     { type: 'seriesReady', index, series, dates, name, unit, frequency, defaultOriginIndex, horizon, naive }
 *     { type: 'seriesOffline', index, name, reason }
 *     { type: 'forecast', origin, originDate, requestId, quantiles, nQuantiles, horizon, ms }
 *     { type: 'error', message }
 */

// TODO(TC): once t0-alpha-q8_0.gguf is published, replace LOCAL model
// fetching below with this Hub URL.
const MODEL_HUB_URL = 'https://huggingface.co/idle-intelligence/t0-alpha-q8_0/resolve/main/t0-alpha-q8_0.gguf';
const MODEL_URL = new URL('./models/t0-alpha-q8_0.gguf', import.meta.url).href;
const INDEX_URL = new URL('./data/index.json', import.meta.url).href;
const CACHE_NAME = 't0-model-v1';

const CONTEXT_CAP = 512;
const HORIZON = 32;

let t0wasm = null;
let model = null;
let seriesIndex = null; // parsed data/index.json

const HAS_WEBGPU = typeof navigator !== 'undefined' && !!navigator.gpu;
const BACKEND = HAS_WEBGPU ? 'webgpu' : 'wasm/ndarray';
const PKG_DIR = HAS_WEBGPU ? './pkg-wgpu' : './pkg';

self.onmessage = async (e) => {
    const { type, ...data } = e.data;
    try {
        if (type === 'load') {
            await handleLoad();
        } else if (type === 'loadSeries') {
            await handleLoadSeries(data.index);
        } else if (type === 'forecast') {
            await handleForecast(data.origin, data.requestId);
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

    seriesIndex = await fetch(INDEX_URL).then((r) => r.json());

    self.postMessage({
        type: 'modelReady',
        modelBytes: modelBuf.byteLength,
        loadMs,
        nQuantiles: model.nQuantiles(),
        horizon: HORIZON,
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
    const end = new Date();
    const begin = new Date(end.getTime() - 8 * 86400000);
    const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${fmt(begin)}&end_date=${fmt(end)}&station=8443970&product=water_level&datum=MLLW&units=metric&time_zone=gmt&format=json`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`NOAA tide fetch failed: ${resp.status}`);
    const json = await resp.json();
    if (json.error) throw new Error(json.error.message || 'NOAA tide error');
    const rows = json.data; // 6-min native
    const decimated = rows.filter((_, i) => i % 10 === 0); // -> hourly
    const values = decimated.map((r) => parseFloat(r.v));
    const dates = decimated.map((r) => r.t.replace(' ', 'T').slice(0, 16).replace('T', ' '));
    return { values, dates, freq: 'H' };
}

async function fetchLiveUsgsDischarge(entry) {
    const url = 'https://waterservices.usgs.gov/nwis/iv/?sites=01646500&parameterCd=00060&period=P3D&format=json';
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`USGS fetch failed: ${resp.status}`);
    const json = await resp.json();
    const series = json.value?.timeSeries?.[0]?.values?.[0]?.value;
    if (!series || !series.length) throw new Error('USGS: no data returned');
    const values = series.map((v) => parseFloat(v.value));
    const dates = series.map((v) => v.dateTime.slice(0, 16).replace('T', ' '));
    return { values, dates, freq: '15T' };
}

async function fetchLiveMetar(entry) {
    const end = new Date();
    const begin = new Date(end.getTime() - 7 * 86400000);
    const fmt = (d) => [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    const [y1, m1, d1] = fmt(begin);
    const [y2, m2, d2] = fmt(end);
    const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=LFPB&data=tmpc&year1=${y1}&month1=${m1}&day1=${d1}&year2=${y2}&month2=${m2}&day2=${d2}&tz=UTC&format=onlycomma&latlon=no&elev=no&missing=M&trace=T&direct=no&report_type=3`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`IEM METAR fetch failed: ${resp.status}`);
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
    if (!resp.ok) throw new Error(`OpenAQ requires an API key (HTTP ${resp.status})`);
    throw new Error('OpenAQ: unexpected success without a key -- parsing not implemented');
}

const LIVE_FETCHERS = {
    'noaa-tide': fetchLiveNoaaTide,
    'usgs-iv': fetchLiveUsgsDischarge,
    'iem-metar': fetchLiveMetar,
    'openaq-v3': fetchLiveOpenAq,
};

async function handleLoadSeries(index) {
    const entry = seriesIndex[index];
    self.postMessage({ type: 'status', text: `Loading ${entry.name}...` });
    try {
        let values, dates, freq;
        if (entry.live) {
            const fetcher = LIVE_FETCHERS[entry.liveApi];
            if (!fetcher) throw new Error(`no fetcher for liveApi ${entry.liveApi}`);
            ({ values, dates, freq } = await fetcher(entry));
        } else {
            ({ values, dates, freq } = await loadBundled(entry));
        }
        const n = values.length;
        const defaultOriginIndex = entry.live
            ? n - HORIZON
            : dates.indexOf(entry.defaultOrigin) >= 0 ? dates.indexOf(entry.defaultOrigin) : Math.max(0, n - HORIZON);
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
            horizon: HORIZON,
            naive: naiveDescriptor(freq),
            source: entry.source,
            license: entry.license,
        });
    } catch (err) {
        self.postMessage({ type: 'seriesOffline', index, name: entry.name, reason: err.message || String(err) });
    }
}

async function handleForecast(origin, requestId) {
    if (!model || !self.__currentSeries) {
        self.postMessage({ type: 'error', message: 'forecast requested before model/series ready' });
        return;
    }
    const series = self.__currentSeries;
    const ctxStart = Math.max(0, origin - CONTEXT_CAP);
    const context = new Float32Array(series.slice(ctxStart, origin));
    const t0 = performance.now();
    const quantiles = await model.forecast(context, HORIZON);
    const ms = performance.now() - t0;
    self.postMessage({
        type: 'forecast',
        origin,
        requestId,
        quantiles: Array.from(quantiles),
        nQuantiles: model.nQuantiles(),
        horizon: HORIZON,
        ms,
    });
}
