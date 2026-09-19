// sources.js — live observation fetchers.
// Each returns a normalized observation: { tempC, dewpointC, windMs, windDirDeg,
// pressureHpa, obsTime (Date), source } with missing fields left undefined
// (never zero-filled). CORS verified 2026-09-19 with:
//   curl -sI -H 'Origin: https://trucs.ai' <url>
// IEM currents.json           -> Access-Control-Allow-Origin: *
// api.weather.gov observations -> access-control-allow-origin: *
// api.open-meteo.com forecast  -> access-control-allow-origin: *
// aviationweather.gov (used in TC's original METAR.py) sends no ACAO header and
// is therefore not used here; see report.

const F_TO_C = (f) => ((f - 32) * 5) / 9;
const KT_TO_MS = (kt) => kt * 0.514444;
const INHG_TO_HPA = (inhg) => inhg * 33.8639;

// Iowa Environmental Mesonet — global ASOS/METAR current observations, one call
// for any number of stations via repeated `station=` query params.
export async function fetchIem(icaos) {
  const url = new URL('https://mesonet.agron.iastate.edu/api/1/currents.json');
  for (const icao of icaos) url.searchParams.append('station', icao);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IEM ${res.status}`);
  const body = await res.json();
  const out = new Map();
  for (const row of body.data ?? []) {
    const obs = {};
    if (typeof row.tmpf === 'number') obs.tempC = F_TO_C(row.tmpf);
    if (typeof row.dwpf === 'number') obs.dewpointC = F_TO_C(row.dwpf);
    if (typeof row.sknt === 'number') obs.windMs = KT_TO_MS(row.sknt);
    if (typeof row.drct === 'number') obs.windDirDeg = row.drct;
    if (typeof row.alti === 'number') obs.pressureHpa = INHG_TO_HPA(row.alti);
    else if (typeof row.mslp === 'number') obs.pressureHpa = row.mslp;
    if (row.utc_valid) obs.obsTime = new Date(row.utc_valid);
    obs.source = 'IEM';
    if (Object.keys(obs).length > 1) out.set(row.station, obs);
  }
  return out;
}

// NWS api.weather.gov — US stations only. One call per station (no batch endpoint).
export async function fetchNws(icao) {
  const res = await fetch(`https://api.weather.gov/stations/${icao}/observations/latest`);
  if (res.status === 404) return null; // station not in NWS network (non-US, etc.)
  if (!res.ok) throw new Error(`NWS ${res.status}`);
  const body = await res.json();
  const p = body.properties;
  const obs = { source: 'NWS' };
  if (typeof p.temperature?.value === 'number') obs.tempC = p.temperature.value;
  if (typeof p.dewpoint?.value === 'number') obs.dewpointC = p.dewpoint.value;
  if (typeof p.windSpeed?.value === 'number') obs.windMs = p.windSpeed.value / 3.6; // km/h -> m/s
  if (typeof p.windDirection?.value === 'number') obs.windDirDeg = p.windDirection.value;
  if (typeof p.barometricPressure?.value === 'number') obs.pressureHpa = p.barometricPressure.value / 100; // Pa -> hPa
  if (p.timestamp) obs.obsTime = new Date(p.timestamp);
  return Object.keys(obs).length > 1 ? obs : null;
}

// Open-Meteo — gridded forecast model sampled at the exact point. NOT an observation;
// shown separately for comparison only.
export async function fetchOpenMeteoPoint(lat, lon) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set('current', 'temperature_2m,dew_point_2m,pressure_msl,wind_speed_10m,wind_direction_10m');
  url.searchParams.set('wind_speed_unit', 'ms');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const body = await res.json();
  const c = body.current ?? {};
  return {
    tempC: c.temperature_2m,
    dewpointC: c.dew_point_2m,
    pressureHpa: c.pressure_msl,
    windMs: c.wind_speed_10m,
    windDirDeg: c.wind_direction_10m,
    obsTime: c.time ? new Date(c.time + 'Z') : undefined,
    source: 'Open-Meteo (model)',
  };
}
