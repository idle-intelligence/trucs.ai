// knn.js: nearest-METAR-station search, backed by the weather-web wasm
// package's Stations class (haversine + partial sort in Rust).
//
// Station list: idle-intelligence/metar-stations on the Hugging Face Hub,
// rows [icao, lat, lon, elevM, name, country]. `?local=1` in the page URL
// loads a local dev copy instead (the dataset is not uploaded yet).

import init, { Stations } from './pkg/weather_wasm.js?v=9f05f31';

const wasmReady = init(new URL('./pkg/weather_wasm_bg.wasm?v=9f05f31', import.meta.url));

const HF_STATIONS_URL = 'https://huggingface.co/datasets/idle-intelligence/metar-stations/resolve/main/stations.json';

function stationsUrl() {
  if (new URLSearchParams(location.search).get('local') === '1') {
    return new URL('./stations.json', import.meta.url);
  }
  return HF_STATIONS_URL;
}

// The raw station rows (one fetch, shared by the search index below and by
// map.js's background station dots — both need the same list, so there is
// only one place that loads it).
let rowsPromise = null;

function loadStationRows() {
  if (!rowsPromise) {
    rowsPromise = wasmReady
      .then(() => fetch(stationsUrl()))
      .then((r) => {
        if (!r.ok) throw new Error(`failed to load stations: ${r.status}`);
        return r.text();
      });
  }
  return rowsPromise;
}

// The parsed rows, [icao, lat, lon, elevM, name, country] each — for map.js.
export async function loadStationRowsParsed() {
  return JSON.parse(await loadStationRows());
}

let stationsPromise = null;

export async function loadStations() {
  if (!stationsPromise) {
    stationsPromise = loadStationRows().then((text) => new Stations(text));
  }
  return stationsPromise;
}

// Selects the station(s) an estimate at (lat, lon) should use: up to 5
// nearest stations within 100 km (closest first), plus the nearest station
// overall (for the "no station in range" message). `null` if no stations
// are loaded.
export async function select(lat, lon) {
  const stations = await loadStations();
  return stations.select(lat, lon);
}
