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

import { parseIemCurrents, parseNwsLatest, nwsStationId } from './pkg/weather_wasm.js?v=9f05f31';

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
// (as IEM and the metar-stations dataset carry it). Id mapping and body
// parsing (unit conversion, field normalization) happen in the wasm package.
export async function fetchNws(icao) {
  const res = await fetch(`https://api.weather.gov/stations/${nwsStationId(icao)}/observations/latest`);
  if (res.status === 404) return null; // station not in NWS network (non-US, etc.)
  if (!res.ok) throw new Error(`NWS ${res.status}`);
  const text = await res.text();
  return parseNwsLatest(text);
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
