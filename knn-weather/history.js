// history.js — last-24h METAR history per station, from IEM's ASOS request endpoint.
// CORS verified 2026-09-19 (see sources.js note). One request per station, in parallel.

const F_TO_C = (f) => ((f - 32) * 5) / 9;
const KT_TO_MS = (kt) => kt * 0.514444;
const INHG_TO_HPA = (inhg) => inhg * 33.8639;

function pad(n) {
  return String(n).padStart(2, '0');
}

// Parses asos.py's format=onlycomma output. Header row names the columns
// (order varies with `data=`/`latlon=`); "M" marks a missing value.
function parseAsosCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < header.length) continue;
    const num = (key) => {
      const j = idx[key];
      if (j === undefined) return undefined;
      const v = cols[j];
      if (v === undefined || v === 'M' || v.trim() === '') return undefined;
      const f = parseFloat(v);
      return Number.isFinite(f) ? f : undefined;
    };
    const validRaw = idx.valid !== undefined ? cols[idx.valid] : undefined;
    const row = { time: validRaw ? new Date(validRaw.trim().replace(' ', 'T') + 'Z') : null };
    const tmpf = num('tmpf');
    const dwpf = num('dwpf');
    const sknt = num('sknt');
    const drct = num('drct');
    const alti = num('alti');
    if (tmpf !== undefined) row.tempC = F_TO_C(tmpf);
    if (dwpf !== undefined) row.dewpointC = F_TO_C(dwpf);
    if (sknt !== undefined) row.windMs = KT_TO_MS(sknt);
    if (drct !== undefined) row.windDirDeg = drct;
    if (alti !== undefined) row.pressureHpa = INHG_TO_HPA(alti);
    out.push(row);
  }
  return out;
}

// Fetches the last 24h of observations for one station. Never throws:
// returns { icao, obs: [], error } on any failure.
export async function fetchStationHistory(icao, now = new Date()) {
  const end = now;
  const start = new Date(now.getTime() - 24 * 3600 * 1000);
  const url = new URL('https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py');
  url.searchParams.set('station', icao);
  url.searchParams.set('data', 'tmpf,dwpf,drct,sknt,alti');
  url.searchParams.set('year1', String(start.getUTCFullYear()));
  url.searchParams.set('month1', pad(start.getUTCMonth() + 1));
  url.searchParams.set('day1', pad(start.getUTCDate()));
  url.searchParams.set('year2', String(end.getUTCFullYear()));
  url.searchParams.set('month2', pad(end.getUTCMonth() + 1));
  url.searchParams.set('day2', pad(end.getUTCDate()));
  url.searchParams.set('tz', 'Etc/UTC');
  url.searchParams.set('format', 'onlycomma');
  url.searchParams.set('latlon', 'yes');
  // IEM's asos.py rejects most of a burst of simultaneous requests with
  // 429/503; retry those a few times with backoff before giving up.
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status === 503) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1) + Math.random() * 300));
        continue;
      }
      if (!res.ok) return { icao, obs: [], error: `HTTP ${res.status}` };
      const text = await res.text();
      const obs = parseAsosCsv(text);
      if (obs.length === 0) return { icao, obs: [], error: 'no observations in the last 24 h' };
      return { icao, obs, error: null };
    } catch (err) {
      return { icao, obs: [], error: err.message };
    }
  }
  return { icao, obs: [], error: 'rate-limited (429/503) after retries' };
}

// Fetches history for multiple stations in parallel — requests are started
// concurrently, staggered by a few ms each to avoid triggering IEM's burst
// rate limit outright (retried anyway on 429/503, see fetchStationHistory).
// onEach(result) fires as each station's fetch resolves, for progressive
// STATUS logging.
export async function fetchStationHistories(icaos, onEach) {
  const results = await Promise.all(
    icaos.map(async (icao, i) => {
      if (i > 0) await new Promise((r) => setTimeout(r, 350 * i));
      const r = await fetchStationHistory(icao);
      if (onEach) onEach(r);
      return r;
    }),
  );
  const map = new Map();
  for (const r of results) map.set(r.icao, r);
  return map;
}
