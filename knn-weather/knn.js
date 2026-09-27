// knn.js: nearest-METAR-station search, backed by the weather-web wasm
// package's Stations class (haversine + partial sort in Rust).
//
// Station list: idle-intelligence/metar-stations on the Hugging Face Hub,
// rows [icao, lat, lon, elevM, name, country]. `?local=1` in the page URL
// loads a local dev copy instead (the dataset is not uploaded yet).

import init, { Stations } from './pkg/weather_wasm.js?v=aa27f02';

const wasmReady = init(new URL('./pkg/weather_wasm_bg.wasm?v=aa27f02', import.meta.url));

const HF_STATIONS_URL = 'https://huggingface.co/datasets/idle-intelligence/metar-stations/resolve/main/stations.json';

function stationsUrl() {
  if (new URLSearchParams(location.search).get('local') === '1') {
    return new URL('./stations.json', import.meta.url);
  }
  return HF_STATIONS_URL;
}

let stationsPromise = null;

export async function loadStations() {
  if (!stationsPromise) {
    stationsPromise = wasmReady
      .then(() => fetch(stationsUrl()))
      .then((r) => {
        if (!r.ok) throw new Error(`failed to load stations: ${r.status}`);
        return r.text();
      })
      .then((text) => new Stations(text));
  }
  return stationsPromise;
}

// Returns the k nearest stations to (lat, lon), sorted by ascending distance (km).
export async function nearest(lat, lon, k = 5) {
  const stations = await loadStations();
  return stations.nearest(lat, lon, k);
}
