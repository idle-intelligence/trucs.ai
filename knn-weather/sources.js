// sources.js — live observation fetchers.
// Each returns a normalized observation: { tempC, dewpointC, windMs, windDirDeg,
// pressureHpa, obsTimeMillis, source } with missing fields left undefined
// (never zero-filled). CORS verified 2026-09-19 with:
//   curl -sI -H 'Origin: https://trucs.ai' <url>
// IEM currents.json           -> Access-Control-Allow-Origin: *
// api.weather.gov observations -> access-control-allow-origin: *
// api.open-meteo.com forecast  -> access-control-allow-origin: *
// aviationweather.gov sends no Access-Control-Allow-Origin header, so it is
// not used here.

import { parseIemCurrents } from './pkg/weather_wasm.js?v=ae5146e';

// Iowa Environmental Mesonet — global ASOS/METAR current observations, one call
// for any number of stations via repeated `station=` query params. Parsing
// (unit conversion, field normalization) happens in the wasm package.
export async function fetchIem(icaos) {
  const url = new URL('https://mesonet.agron.iastate.edu/api/1/currents.json');
  for (const icao of icaos) url.searchParams.append('station', icao);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IEM ${res.status}`);
  const text = await res.text();
  return parseIemCurrents(text);
}

// NWS api.weather.gov — US stations only, called with the station's own id
// (as IEM and the metar-stations dataset carry it). NWS needs the full
// 4-letter ICAO id: CONUS state networks carry a bare 3-character id there
// (e.g. "JFK", "00U") and need a "K" prefix; Alaska, Hawaii, Puerto Rico,
// Guam and the US Virgin Islands already carry their real 4-letter ICAO id
// (e.g. "PANC", "PHNL") and are used as-is (checked against
// stations.parquet's source_network column, 2026-09-27: every non-AK/HI/
// GU/PR/VI US network is 3-character, every AK/HI/GU/PR/VI one is already
// 4-character).
function nwsId(icao) {
  return icao.length === 3 ? `K${icao}` : icao;
}

export async function fetchNws(icao) {
  const res = await fetch(`https://api.weather.gov/stations/${nwsId(icao)}/observations/latest`);
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
  if (p.timestamp) obs.obsTimeMillis = new Date(p.timestamp).getTime();
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
    elevationM: typeof body.elevation === 'number' ? body.elevation : undefined,
    source: 'Open-Meteo (model)',
  };
}
