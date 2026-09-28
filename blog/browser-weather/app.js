// app.js — interactive widget for blog/browser-weather.md.
// Imports the kNN weather modules from /knn-weather/ (never modifies them).
// Selection, radius, fallback, age cutoff, NWS parsing and physics
// corrections all live in the weather-web wasm package; this file only
// wires fetches to it and renders what it returns.

import { select } from '/knn-weather/knn.js';
import { fetchIem, fetchNws, fetchOpenMeteoPoint } from '/knn-weather/sources.js';
import { idw, computeCorrections, estimate } from '/knn-weather/pkg/weather_wasm.js?v=9f05f31';

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
const fetchMsSpan = document.getElementById('bw-fetch-ms');
const firstEstimateValue = document.getElementById('bw-first-estimate-value');
const finalEq = document.getElementById('bw-final-eq');
const outputPanel = document.getElementById('bw-output-panel');
const weightChartCanvas = document.getElementById('bw-weight-chart');
const weightCaption = document.getElementById('bw-weight-caption');
const theoryChartCanvas = document.getElementById('bw-theory-chart');
const stationsUsedLine = document.getElementById('bw-stations-used-line');

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

function renderCount(final, result) {
  countLine.textContent = `There are ${final.length} stations within ${RADIUS_KM} km of this location, ${result.freshCount} with a recent report.`;
}

// final: selection.stations ({ station, distance }). observations: icao ->
// obs. estStations: estimate()'s per-station array (ageMinutes, fresh,
// hasObservation), parallel to final.
function renderTable(final, observations, estStations) {
  const head = '<tr><th>id</th><th>name</th><th>distance (km)</th><th>temp (C)</th><th>dew point (C)</th><th>wind</th><th>pressure (hPa)</th><th>obs age</th></tr>';
  const body = final.map((s, i) => {
    const o = observations[s.station.icao] || {};
    const est = estStations[i];
    const ageStr = est.ageMinutes != null ? `${est.ageMinutes.toFixed(0)} min ago` : '-';
    if (!est.fresh) {
      return `<tr>
        <td>${s.station.icao}</td>
        <td>${s.station.name ?? ''}</td>
        <td>${s.distance.toFixed(1)}</td>
        <td colspan="4" class="bw-no-report">no recent report</td>
        <td>${ageStr}</td>
      </tr>`;
    }
    return `<tr>
      <td>${s.station.icao}</td>
      <td>${s.station.name ?? ''}</td>
      <td>${s.distance.toFixed(1)}</td>
      <td>${Number.isFinite(o.tempC) ? o.tempC.toFixed(1) : '-'}</td>
      <td>${Number.isFinite(o.dewpointC) ? o.dewpointC.toFixed(1) : '-'}</td>
      <td>${Number.isFinite(o.windMs) ? `${o.windMs.toFixed(1)} m/s${Number.isFinite(o.windDirDeg) ? ` @${o.windDirDeg.toFixed(0)}°` : ''}` : '-'}</td>
      <td>${Number.isFinite(o.pressureHpa) ? o.pressureHpa.toFixed(0) : '-'}</td>
      <td>${ageStr}</td>
    </tr>`;
  }).join('');
  tableWrap.innerHTML = `<table class="bw-table">${head}${body}</table>`;
}

function renderPlainMean(freshStations, observations) {
  const temps = freshStations.map((s) => observations[s.station.icao]?.tempC).filter((v) => Number.isFinite(v));
  if (temps.length === 0) {
    plainMeanValue.textContent = 'n/a';
    return;
  }
  const mean = temps.reduce((a, b) => a + b, 0) / temps.length;
  plainMeanValue.textContent = `${mean.toFixed(1)} °C (${temps.length} stations)`;
}

function renderStationsUsedLine(n) {
  const noun = n === 1 ? 'station' : 'stations';
  stationsUsedLine.textContent = `Here are the ${n} ${noun} used for your place, and the share of the total each one gets:`;
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
    pressure: corr.pressure.correctedQnh ?? corr.pressure.plain,
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
  if (v.pressure != null) lines.push(`pressure: averaged as QNH (sea level): ${v.pressure.toFixed(2)} hPa`);
  if (v.wind != null) lines.push(`wind: averaged as (u, v) vector components: ${v.wind.toFixed(2)} m/s${wDir != null ? ` from ${wDir.toFixed(0)}°` : ''}`);
  finalEq.textContent = lines.join('\n');
}

// result: estimate() result. model: fetchOpenMeteoPoint() result (or null),
// shown under each line for comparison. Both report sea-level (QNH)
// pressure, so the two pressure numbers are directly comparable. Anything
// but a fresh estimate (status "ok") shows "n/a", matching the map's "--".
function renderOutput(result, model) {
  const fin = (x) => Number.isFinite(x);
  const ok = result.status.kind === 'ok';
  const wDir = result.windDirDeg;
  const lines = [
    {
      label: 'temperature',
      value: ok && fin(result.temperatureC) ? `${result.temperatureC.toFixed(1)} °C` : 'n/a',
      model: model && fin(model.tempC) ? `${model.tempC.toFixed(1)} °C` : null,
    },
    {
      label: 'dew point',
      value: ok && fin(result.dewpointC) ? `${result.dewpointC.toFixed(1)} °C` : 'n/a',
      model: model && fin(model.dewpointC) ? `${model.dewpointC.toFixed(1)} °C` : null,
    },
    {
      label: 'wind',
      value: ok && fin(result.windSpeedMs) ? `${result.windSpeedMs.toFixed(1)} m/s${fin(wDir) ? ` from ${wDir.toFixed(0)}°` : ''}` : 'n/a',
      model: model && fin(model.windMs) ? `${model.windMs.toFixed(1)} m/s${fin(model.windDirDeg) ? ` from ${model.windDirDeg.toFixed(0)}°` : ''}` : null,
    },
    {
      label: 'pressure',
      value: ok && fin(result.pressureQnhHpa) ? `${result.pressureQnhHpa.toFixed(0)} hPa` : 'n/a',
      model: model && fin(model.pressureHpa) ? `${model.pressureHpa.toFixed(0)} hPa` : null,
    },
  ];
  outputPanel.innerHTML = lines.map((l) => `
    <div class="output-line">
      <span class="output-label">${l.label}</span>
      <span class="output-value">${l.value}</span>
      ${l.model != null ? `<div class="output-model">weather model: ${l.model}</div>` : ''}
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

function drawAxes(ctx, w, h, xAt, yAt, xTicks, yTicks, xLabel, yLabel = (v) => `${v.toFixed(0)}%`) {
  ctx.strokeStyle = '#eee';
  ctx.fillStyle = '#999';
  ctx.font = '10px ui-monospace, monospace';
  ctx.lineWidth = 1;
  for (const pct of yTicks) {
    const y = yAt(pct);
    ctx.beginPath();
    ctx.moveTo(PAD_L, y);
    ctx.lineTo(w - PAD_R, y);
    ctx.stroke();
    ctx.fillText(yLabel(pct), 2, y + 3);
  }
  for (const d of xTicks) {
    const x = xAt(d);
    ctx.beginPath();
    ctx.moveTo(x, PAD_T);
    ctx.lineTo(x, h - PAD_B);
    ctx.stroke();
    // Near the right edge, right-align so the label doesn't run off the canvas.
    ctx.textAlign = x > w - 40 ? 'right' : 'left';
    ctx.fillText(xLabel(d), x > w - 40 ? x - 2 : x - 10, h - 6);
    ctx.textAlign = 'left';
  }
}

function drawTheoryChart() {
  const ctx = theoryChartCanvas.getContext('2d');
  const { w, h } = fitCanvas(theoryChartCanvas, ctx);
  ctx.clearRect(0, 0, w, h);

  // w(d) = 1 / d, d in km, drawn from 1 km (1/d is undefined at 0) to 100 km
  // on the same 0 to 100 km axis as the weight chart below.
  const dMin = 0, dMax = 100, yMax = 1;
  const plotW = w - PAD_L - PAD_R;
  const plotH = h - PAD_T - PAD_B;
  const xAt = (d) => PAD_L + ((d - dMin) / (dMax - dMin)) * plotW;
  const yAt = (v) => PAD_T + plotH - (v / yMax) * plotH;

  drawAxes(ctx, w, h, xAt, yAt, [0, 25, 50, 75, 100], [0, 0.25, 0.5, 0.75, 1], (d) => `${d}km`, (v) => `${v}`);

  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD_L, PAD_T, plotW, plotH);
  ctx.clip();

  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const steps = 400;
  for (let i = 0; i <= steps; i++) {
    const d = 1 + (i / steps) * (dMax - 1);
    const x = xAt(d);
    const y = yAt(1 / d);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawWeightChart() {
  if (!weightPlot) return;
  const ctx = weightChartCanvas.getContext('2d');
  const { w, h } = fitCanvas(weightChartCanvas, ctx);
  ctx.clearRect(0, 0, w, h);

  const { terms, total } = weightPlot;
  const curveAt = (d) => (1 / d / total) * 100;
  // Fixed axes for every selection, so the chart is directly comparable
  // across places: x is the search radius (0 to 100 km), y is 0 to 100%.
  const dMin = 0, dMax = RADIUS_KM, yMax = 100;

  const plotW = w - PAD_L - PAD_R;
  const plotH = h - PAD_T - PAD_B;
  const xAt = (d) => PAD_L + ((d - dMin) / (dMax - dMin)) * plotW;
  const yAt = (pct) => PAD_T + plotH - (pct / yMax) * plotH;

  drawAxes(ctx, w, h, xAt, yAt, [0, 25, 50, 75, 100], [0, 25, 50, 75, 100], (d) => `${d}km`);

  // theoretical curve: weight share = (1/d) / total, drawn from 1 km (1/d is
  // undefined at 0) to the 100 km search radius. Clipped to the plot rect,
  // never clamped: near 1 km the curve is far above 100% for a nearby
  // station, and the clip lets it run off the top instead of flattening.
  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD_L, PAD_T, plotW, plotH);
  ctx.clip();

  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const steps = 100;
  const curveMin = 1;
  for (let i = 0; i <= steps; i++) {
    const d = curveMin + (i / steps) * (dMax - curveMin);
    const pct = curveAt(d);
    const x = xAt(d);
    const y = yAt(pct);
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
  ctx.restore();

  weightCaption.textContent = `share of the final weight (gray: theoretical 1/distance, dots: the ${terms.length} stations used)`;
}

async function run(lat, lon) {
  setStatus('finding nearby stations...');
  countLine.textContent = '';
  tableWrap.innerHTML = '';
  plainMeanValue.textContent = '';
  weightedEq.textContent = '';
  firstMsSpan.textContent = '';
  if (fetchMsSpan) fetchMsSpan.textContent = '';
  firstEstimateValue.textContent = '';
  finalEq.textContent = '';
  outputPanel.innerHTML = '';
  weightCaption.textContent = '';
  weightPlot = null;

  let selection;
  try {
    selection = await select(lat, lon);
  } catch (err) {
    setStatus(`failed to load station list: ${err.message}`);
    return;
  }
  if (!selection) {
    setStatus('no stations loaded');
    return;
  }

  // Up to 5 nearest stations within 100 km, closest first — no fallback to
  // farther stations when none are in range.
  const final = selection.stations;

  setStatus('fetching observations...');
  const tFetch0 = performance.now();

  let iemMap = {};
  const nwsMap = new Map();
  if (final.length > 0) {
    try {
      iemMap = await fetchIem(final.map((s) => s.station.icao));
    } catch (err) {
      console.log(`IEM fetch failed: ${err.message}`);
    }
    const usStations = final.filter((s) => s.station.country === 'US');
    if (usStations.length > 0) {
      const results = await Promise.allSettled(usStations.map((s) => fetchNws(s.station.icao)));
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) nwsMap.set(usStations[i].station.icao, r.value);
      });
    }
  }
  const observations = {};
  for (const s of final) {
    const obs = nwsMap.get(s.station.icao) ?? iemMap[s.station.icao] ?? null;
    if (obs) observations[s.station.icao] = obs;
  }

  // One Open-Meteo call: the point's elevation for the corrections, and the
  // weather model's current values for comparison.
  let modelPoint = null;
  let targetElevM = null;
  try {
    modelPoint = await fetchOpenMeteoPoint(lat, lon);
    targetElevM = modelPoint?.elevationM ?? null;
  } catch (err) {
    console.log(`Open-Meteo fetch failed: ${err.message}`);
  }

  const tFetch1 = performance.now();
  if (fetchMsSpan) fetchMsSpan.textContent = Math.round(tFetch1 - tFetch0).toString();
  setStatus('computing estimate...');
  const tCompute0 = performance.now();

  const now = Date.now();
  const result = estimate(selection, observations, targetElevM, now);

  renderTable(final, observations, result.stations);

  if (result.status.kind === 'noStationWithinRadius') {
    const km = Math.round(result.status.nearestKm);
    countLine.textContent = `No weather station within ${RADIUS_KM} km of this location. The nearest, ${result.status.nearestId}, is ${km} km away.`;
  } else {
    renderCount(final, result);
  }

  const freshStations = final.filter((s, i) => result.stations[i].fresh);
  renderPlainMean(freshStations, observations);
  renderStationsUsedLine(freshStations.length);

  if (freshStations.length > 0) {
    const tFirst0 = performance.now();
    const tPtsMain = freshStations
      .filter((s) => Number.isFinite(observations[s.station.icao]?.tempC))
      .map((s) => ({ icao: s.station.icao, distance: s.distance, value: observations[s.station.icao].tempC }));
    const idwMain = idw(tPtsMain);
    const tFirst1 = performance.now();

    renderWeightedEquation(idwMain);
    const firstMs = tFirst1 - tFirst0;
    firstMsSpan.textContent = firstMs < 0.01 ? 'less than 0.01 ms' : `${firstMs.toFixed(2)} ms`;
    if (idwMain) firstEstimateValue.textContent = `${idwMain.value.toFixed(1)} °C`;

    if (idwMain) {
      weightPlot = { terms: idwMain.terms, total: idwMain.terms.reduce((a, t) => a + t.weight, 0) };
      drawWeightChart();
    } else {
      weightCaption.textContent = 'not enough stations with a recent report to plot this';
    }

    const rows = freshStations.map((s) => ({ icao: s.station.icao, distance: s.distance, elevM: s.station.elevM, obs: observations[s.station.icao] ?? null }));
    const mainCorr = computeCorrections(rows, targetElevM, now);
    if (idwMain) renderFinalEquation(mainCorr, idwMain.value);
  } else {
    weightCaption.textContent = 'not enough stations with a recent report to plot this';
  }

  renderOutput(result, modelPoint);

  const tCompute1 = performance.now();
  setStatus(`ready (${(tCompute1 - tCompute0).toFixed(2)} ms)`);
}

renderCityButtons();
drawTheoryChart();
window.addEventListener('resize', () => { drawTheoryChart(); drawWeightChart(); });

// Exposed for headless verification.
window.__bwApp = { run };
