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
const tableWrap = document.getElementById('bw-table-wrap');
const plainMeanValue = document.getElementById('bw-plain-mean-value');
const weightedEq = document.getElementById('bw-weighted-eq');
const firstMsSpan = document.getElementById('bw-first-ms');
const firstEstimateValue = document.getElementById('bw-first-estimate-value');
const finalEq = document.getElementById('bw-final-eq');
const outputPanel = document.getElementById('bw-output-panel');
const weightChartCanvas = document.getElementById('bw-weight-chart');
const weightCaption = document.getElementById('bw-weight-caption');
const metricGrid = document.getElementById('bw-metric-grid');
const chartCanvas = document.getElementById('bw-chart');
const chartCaption = document.getElementById('bw-chart-caption');

let sweep = null; // { temperature: [...], dewpoint: [...], wind: [...], pressure: [...] }
let activeMetric = 'temperature';
let weightPlot = null; // { terms, total }

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

function renderCount(n, shown) {
  countLine.textContent = `There are ${n} stations under ${RADIUS_KM} km from this location. The table shows the nearest ${shown}.`;
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

function renderPlainMean(withObs) {
  const temps = withObs.map((s) => s.obs?.tempC).filter((v) => Number.isFinite(v));
  if (temps.length === 0) {
    plainMeanValue.textContent = 'n/a';
    return;
  }
  const mean = temps.reduce((a, b) => a + b, 0) / temps.length;
  plainMeanValue.textContent = `${mean.toFixed(1)} °C (${temps.length} stations)`;
}

function renderWeightedEquation(idwResult) {
  if (!idwResult) {
    weightedEq.textContent = '';
    return;
  }
  const terms = idwResult.terms
    .map((t) => `${t.value.toFixed(1)} °C at ${t.distance.toFixed(1)} km, w=1/${t.distance.toFixed(1)}=${t.weight.toFixed(4)} (${(t.weightNorm * 100).toFixed(0)}%)`)
    .join('\n');
  weightedEq.textContent = [
    'T_hat = sum(T_i * w_i) / sum(w_i), with w_i = 1 / distance_i',
    terms,
    `T_hat = ${idwResult.value.toFixed(2)} °C`,
  ].join('\n');
}

function correctedValueFor(corr) {
  return {
    temperature: corr.temperature.corrected ?? corr.temperature.plain,
    dewpoint: corr.dewpoint.corrected ?? corr.dewpoint.plain,
    wind: corr.wind.correctedSpeed ?? corr.wind.plainScalarSpeed,
    pressure: corr.pressure.correctedStation ?? corr.pressure.plain,
  };
}

function renderFinalEquation(corr, plainValue) {
  const v = correctedValueFor(corr);
  const wDir = corr.wind.correctedDir;
  const lines = [
    `T_hat (distance-weighted, no correction) = ${plainValue.toFixed(2)} °C`,
  ];
  if (v.temperature != null) {
    lines.push(`corrected to this point's elevation${corr.targetElevM != null ? ` (${corr.targetElevM.toFixed(0)} m)` : ''} with a fitted lapse rate of ${corr.lapse.lapseKPerKm.toFixed(1)} K/km: ${v.temperature.toFixed(2)} °C`);
  }
  if (v.dewpoint != null) lines.push(`dew point: averaged as vapour pressure, converted back: ${v.dewpoint.toFixed(2)} °C`);
  if (v.pressure != null) lines.push(`pressure: QNH averaged, reduced to this elevation: ${v.pressure.toFixed(2)} hPa`);
  if (v.wind != null) lines.push(`wind: averaged as (u, v) vector components: ${v.wind.toFixed(2)} m/s${wDir != null ? ` from ${wDir.toFixed(0)}°` : ''}`);
  finalEq.textContent = lines.join('\n');
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

const PAD_L = 48, PAD_R = 8, PAD_T = 10, PAD_B = 20;

function fitCanvas(canvas, ctx) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w: rect.width, h: rect.height };
}

function drawWeightChart() {
  if (!weightPlot) return;
  const ctx = weightChartCanvas.getContext('2d');
  const { w, h } = fitCanvas(weightChartCanvas, ctx);
  ctx.clearRect(0, 0, w, h);

  const { terms, total } = weightPlot;
  const distances = terms.map((t) => t.distance);
  const dMin = Math.min(...distances) * 0.5;
  const dMax = Math.max(...distances) * 1.3;
  const yMax = Math.max(...terms.map((t) => t.weightNorm * 100)) * 1.2;

  const plotW = w - PAD_L - PAD_R;
  const plotH = h - PAD_T - PAD_B;
  const xAt = (d) => PAD_L + ((d - dMin) / (dMax - dMin)) * plotW;
  const yAt = (pct) => PAD_T + plotH - (pct / yMax) * plotH;

  ctx.strokeStyle = '#eee';
  ctx.fillStyle = '#999';
  ctx.font = '10px ui-monospace, monospace';
  ctx.lineWidth = 1;
  for (let t = 0; t <= 4; t++) {
    const pct = (t / 4) * yMax;
    const y = yAt(pct);
    ctx.beginPath();
    ctx.moveTo(PAD_L, y);
    ctx.lineTo(w - PAD_R, y);
    ctx.stroke();
    ctx.fillText(`${pct.toFixed(0)}%`, 2, y + 3);
  }
  for (let t = 0; t <= 4; t++) {
    const d = dMin + (t / 4) * (dMax - dMin);
    const x = xAt(d);
    ctx.beginPath();
    ctx.moveTo(x, PAD_T);
    ctx.lineTo(x, h - PAD_B);
    ctx.stroke();
    ctx.fillText(`${d.toFixed(0)}km`, x - 10, h - 6);
  }

  // theoretical curve: weight share = (1/d) / total
  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const steps = 100;
  for (let i = 0; i <= steps; i++) {
    const d = dMin + (i / steps) * (dMax - dMin);
    const pct = (1 / d / total) * 100;
    const x = xAt(d);
    const y = yAt(Math.min(pct, yMax));
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // actual stations as points
  ctx.fillStyle = '#111';
  for (const t of terms) {
    const x = xAt(t.distance);
    const y = yAt(t.weightNorm * 100);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  weightCaption.textContent = `share of the final weight (grey: theoretical 1/distance, dots: the ${terms.length} stations used)`;
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
  tableWrap.innerHTML = '';
  plainMeanValue.textContent = '';
  weightedEq.textContent = '';
  firstMsSpan.textContent = '';
  firstEstimateValue.textContent = '';
  finalEq.textContent = '';
  outputPanel.innerHTML = '';
  sweep = null;
  weightPlot = null;

  const wide = await nearest(lat, lon, 60);
  const within100 = wide.filter((s) => s.distance <= RADIUS_KM);

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
  renderCount(within100.length, withObs.length);
  renderPlainMean(withObs);

  // k nearest within 100 km, falling back to the closest available if the
  // area has fewer than that many stations within range.
  const within100WithObs = withObs.filter((s) => s.distance <= RADIUS_KM);
  const mainPool = within100WithObs.length > 0 ? within100WithObs : withObs;
  const kMain = Math.min(K_MAIN, mainPool.length);
  const mainSubset = mainPool.slice(0, kMain);

  const tFirst0 = performance.now();
  const tPtsMain = mainSubset
    .filter((s) => Number.isFinite(s.obs?.tempC))
    .map((s) => ({ icao: s.icao, distance: s.distance, value: s.obs.tempC }));
  const idwMain = idw(tPtsMain);
  const tFirst1 = performance.now();

  renderWeightedEquation(idwMain);
  firstMsSpan.textContent = (tFirst1 - tFirst0).toFixed(2);
  if (idwMain) firstEstimateValue.textContent = `${idwMain.value.toFixed(1)} °C`;

  if (idwMain) {
    weightPlot = { terms: idwMain.terms, total: idwMain.terms.reduce((a, t) => a + t.weight, 0) };
    drawWeightChart();
  }

  const mainCorr = computeCorrections(mainSubset, targetElevM);
  if (idwMain) renderFinalEquation(mainCorr, idwMain.value);
  renderOutput(mainCorr);

  const kMax = Math.min(K_MAX, withObs.length);
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
window.addEventListener('resize', () => { drawChart(); drawWeightChart(); });

// Exposed for headless verification.
window.__bwApp = { run };
