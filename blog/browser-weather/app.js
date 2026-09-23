// app.js — interactive widget for blog/browser-weather.md.
// Imports the kNN weather modules from /knn-weather/ (never modifies them).

import { nearest } from '/knn-weather/knn.js';
import { fetchIem, fetchNws, fetchOpenMeteoPoint } from '/knn-weather/sources.js';
import { idw } from '/knn-weather/idw.js';
import { computeCorrections } from '/knn-weather/corrections.js';

const K_MAIN = 5;
const K_MAX = 23;
const RADIUS_KM = 100;

const CITIES = [
  { name: 'Paris', lat: 48.8566, lon: 2.3522 },
  { name: 'New York', short: 'NYC', lat: 40.7128, lon: -74.0060 },
  { name: 'Toronto', lat: 43.6532, lon: -79.3832 },
];

const cityGrid = document.getElementById('bw-city-grid');
const locInput = document.getElementById('bw-loc-input');
const geoBtn = document.getElementById('bw-geo-btn');
const statusText = document.getElementById('bw-status-text');
const countLine = document.getElementById('bw-count-line');
const outputPanel = document.getElementById('bw-output-panel');
const equationBlock = document.getElementById('bw-equation-block');
const tableWrap = document.getElementById('bw-table-wrap');
const metricGrid = document.getElementById('bw-metric-grid');
const chartCanvas = document.getElementById('bw-chart');
const chartCaption = document.getElementById('bw-chart-caption');

let sweep = null; // { temperature: [...], dewpoint: [...], wind: [...], pressure: [...] }
let activeMetric = 'temperature';

function setStatus(text) {
  statusText.textContent = text;
}

function renderCityButtons() {
  cityGrid.innerHTML = '';
  for (const c of CITIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'series-btn';
    btn.textContent = c.name;
    btn.addEventListener('click', () => {
      markActiveCity(c.name);
      run(c.lat, c.lon);
    });
    cityGrid.appendChild(btn);
  }
}

function markActiveCity(name) {
  cityGrid.querySelectorAll('.series-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.textContent === name);
  });
}

function parseCoords(text) {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

locInput.addEventListener('change', () => {
  const parsed = parseCoords(locInput.value);
  if (!parsed) {
    setStatus('enter coordinates as "lat, lon"');
    return;
  }
  markActiveCity(null);
  run(parsed.lat, parsed.lon);
});
locInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') locInput.dispatchEvent(new Event('change'));
});

geoBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    setStatus('geolocation not supported by this browser');
    return;
  }
  setStatus('requesting your location...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      markActiveCity(null);
      run(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => setStatus(`geolocation failed: ${err.message}`),
  );
});

function ageMinutes(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / 60000;
}

function renderCount(n) {
  countLine.textContent = `There are ${n} stations under ${RADIUS_KM} km from this location.`;
}

function renderTable(rows) {
  const head = '<tr><th>id</th><th>name</th><th>distance (km)</th><th>temp (C)</th><th>dew point (C)</th><th>wind</th><th>pressure (hPa)</th><th>obs age (min)</th></tr>';
  const body = rows.map((s) => {
    const o = s.obs || {};
    const age = ageMinutes(o.obsTime);
    return `<tr>
      <td>${s.icao}</td>
      <td>${s.name ?? ''}</td>
      <td>${s.distance.toFixed(1)}</td>
      <td>${Number.isFinite(o.tempC) ? o.tempC.toFixed(1) : '-'}</td>
      <td>${Number.isFinite(o.dewpointC) ? o.dewpointC.toFixed(1) : '-'}</td>
      <td>${Number.isFinite(o.windMs) ? `${o.windMs.toFixed(1)} m/s${Number.isFinite(o.windDirDeg) ? ` @${o.windDirDeg.toFixed(0)}°` : ''}` : '-'}</td>
      <td>${Number.isFinite(o.pressureHpa) ? o.pressureHpa.toFixed(1) : '-'}</td>
      <td>${age != null ? age.toFixed(0) : '-'}</td>
    </tr>`;
  }).join('');
  tableWrap.innerHTML = `<table class="bw-table">${head}${body}</table>`;
}

function correctedValueFor(corr) {
  return {
    temperature: corr.temperature.corrected ?? corr.temperature.plain,
    dewpoint: corr.dewpoint.corrected ?? corr.dewpoint.plain,
    wind: corr.wind.correctedSpeed ?? corr.wind.plainScalarSpeed,
    pressure: corr.pressure.correctedStation ?? corr.pressure.plain,
  };
}

function renderOutput(corr) {
  const v = correctedValueFor(corr);
  const wDir = corr.wind.correctedDir;
  const lines = [
    { label: 'temperature', value: v.temperature != null ? `${v.temperature.toFixed(1)} °C` : 'n/a' },
    { label: 'dew point', value: v.dewpoint != null ? `${v.dewpoint.toFixed(1)} °C` : 'n/a' },
    { label: 'wind', value: v.wind != null ? `${v.wind.toFixed(1)} m/s${wDir != null ? ` from ${wDir.toFixed(0)}°` : ''}` : 'n/a' },
    { label: 'pressure', value: v.pressure != null ? `${v.pressure.toFixed(1)} hPa` : 'n/a' },
  ];
  outputPanel.innerHTML = lines.map((l) => `
    <div class="output-line">
      <span class="output-label">${l.label}</span>
      <span class="output-value">${l.value}</span>
    </div>
  `).join('');
}

function renderEquation(corr, subset) {
  const tPts = subset
    .filter((s) => Number.isFinite(s.obs?.tempC))
    .map((s) => ({ icao: s.icao, distance: s.distance, value: s.obs.tempC }));
  const result = idw(tPts);
  if (!result) {
    equationBlock.textContent = '';
    return;
  }
  const terms = result.terms
    .map((t) => `${t.value.toFixed(1)} °C at ${t.distance.toFixed(1)} km, w=1/${t.distance.toFixed(1)}=${t.weight.toFixed(4)} (${(t.weightNorm * 100).toFixed(0)}%)`)
    .join('\n');
  const lines = [
    'T_hat = sum(T_i * w_i) / sum(w_i), with w_i = 1 / distance_i',
    terms,
    `plain distance-weighted average: ${result.value.toFixed(2)} °C`,
  ];
  if (corr.temperature.corrected != null) {
    lines.push(`corrected to this point's elevation${corr.targetElevM != null ? ` (${corr.targetElevM.toFixed(0)} m)` : ''} with a fitted lapse rate of ${corr.lapse.lapseKPerKm.toFixed(1)} K/km: ${corr.temperature.corrected.toFixed(2)} °C`);
  }
  equationBlock.textContent = lines.join('\n');
}

const METRICS = {
  temperature: { label: 'temperature', unit: '°C' },
  dewpoint: { label: 'dew point', unit: '°C' },
  wind: { label: 'wind speed', unit: 'm/s' },
  pressure: { label: 'pressure', unit: 'hPa' },
};

function renderMetricButtons() {
  metricGrid.innerHTML = '';
  for (const key of Object.keys(METRICS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'series-btn';
    btn.textContent = METRICS[key].label;
    btn.classList.toggle('active', key === activeMetric);
    btn.addEventListener('click', () => {
      activeMetric = key;
      renderMetricButtons();
      drawChart();
    });
    metricGrid.appendChild(btn);
  }
}

const PAD_L = 48, PAD_R = 8, PAD_T = 10, PAD_B = 20;

function fitCanvas(canvas, ctx) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w: rect.width, h: rect.height };
}

function drawChart() {
  if (!sweep) return;
  const ctx = chartCanvas.getContext('2d');
  const { w, h } = fitCanvas(chartCanvas, ctx);
  ctx.clearRect(0, 0, w, h);

  const values = sweep[activeMetric];
  const n = values.length;
  if (n === 0) return;

  let lo = Infinity, hi = -Infinity;
  for (const v of values) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const pad = (hi - lo) * 0.15 || 1;
  const domain = { lo: lo - pad, hi: hi + pad };

  const plotW = w - PAD_L - PAD_R;
  const plotH = h - PAD_T - PAD_B;
  const xAt = (i) => PAD_L + (n === 1 ? 0 : (i / (n - 1)) * plotW);
  const yAt = (v) => PAD_T + plotH - ((v - domain.lo) / (domain.hi - domain.lo)) * plotH;

  ctx.strokeStyle = '#eee';
  ctx.fillStyle = '#999';
  ctx.font = '10px ui-monospace, monospace';
  ctx.lineWidth = 1;
  const nY = 4;
  for (let t = 0; t <= nY; t++) {
    const v = domain.lo + (t / nY) * (domain.hi - domain.lo);
    const y = yAt(v);
    ctx.beginPath();
    ctx.moveTo(PAD_L, y);
    ctx.lineTo(w - PAD_R, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(1), 2, y + 3);
  }

  const stride = Math.max(1, Math.round(n / 8));
  for (let i = 0; i < n; i += stride) {
    const x = xAt(i);
    ctx.beginPath();
    ctx.moveTo(x, PAD_T);
    ctx.lineTo(x, h - PAD_B);
    ctx.stroke();
    ctx.fillText(String(i + 1), x - 3, h - 6);
  }

  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = xAt(i), y = yAt(values[i]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  chartCaption.textContent = `${METRICS[activeMetric].label} (${METRICS[activeMetric].unit}) estimated with k = 1 to ${n} nearest stations`;
}

async function run(lat, lon) {
  setStatus('finding nearby stations...');
  countLine.textContent = '';
  outputPanel.innerHTML = '';
  equationBlock.textContent = '';
  tableWrap.innerHTML = '';
  sweep = null;

  const wide = await nearest(lat, lon, 60);
  const within100 = wide.filter((s) => s.distance <= RADIUS_KM);
  renderCount(within100.length);

  setStatus('fetching observations...');
  const pool = wide.slice(0, 30);

  let iemMap = new Map();
  try {
    iemMap = await fetchIem(pool.map((c) => c.icao));
  } catch (err) {
    console.log(`IEM fetch failed: ${err.message}`);
  }
  const usStations = pool.filter((c) => c.country === 'US');
  const nwsMap = new Map();
  if (usStations.length > 0) {
    const results = await Promise.allSettled(usStations.map((c) => fetchNws(c.icao)));
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) nwsMap.set(usStations[i].icao, r.value);
    });
  }
  for (const c of pool) {
    c.obs = nwsMap.get(c.icao) ?? iemMap.get(c.icao) ?? null;
  }

  const withObs = pool.filter((c) => c.obs);
  if (withObs.length === 0) {
    setStatus('no station observations available for this location');
    return;
  }

  let targetElevM = null;
  try {
    const p = await fetchOpenMeteoPoint(lat, lon);
    targetElevM = p?.elevationM ?? null;
  } catch (err) {
    console.log(`elevation fetch failed: ${err.message}`);
  }

  setStatus('computing estimate...');

  renderTable(withObs);

  const kMax = Math.min(K_MAX, withObs.length);
  const kMain = Math.min(K_MAIN, kMax);
  const mainSubset = withObs.slice(0, kMain);
  const mainCorr = computeCorrections(mainSubset, targetElevM);
  renderOutput(mainCorr);
  renderEquation(mainCorr, mainSubset);

  sweep = { temperature: [], dewpoint: [], wind: [], pressure: [] };
  for (let k = 1; k <= kMax; k++) {
    const subset = withObs.slice(0, k);
    const corr = computeCorrections(subset, targetElevM);
    const v = correctedValueFor(corr);
    sweep.temperature.push(v.temperature);
    sweep.dewpoint.push(v.dewpoint);
    sweep.wind.push(v.wind);
    sweep.pressure.push(v.pressure);
  }
  drawChart();

  setStatus(`ready, ${withObs.length} stations with observations, chart uses k = 1 to ${kMax}`);
}

renderCityButtons();
renderMetricButtons();
window.addEventListener('resize', drawChart);

// Exposed for headless verification.
window.__bwApp = { run };
