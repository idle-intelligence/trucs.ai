// knn.js — nearest-METAR-station search over a fixed station list.
// A BallTree(haversine) nearest-neighbour search restated for the browser.
// No BallTree here: the station list (~8k entries) is small enough that a linear
// haversine scan + partial sort is plenty fast in a browser tab.

const EARTH_RADIUS_KM = 6371;

let stationsPromise = null;

function haversineKm(lat1, lon1, lat2, lon2) {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dlambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

// url: path to stations.json, resolved relative to this module unless absolute.
export async function loadStations(url = new URL('./stations.json', import.meta.url)) {
  if (!stationsPromise) {
    stationsPromise = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`failed to load stations.json: ${r.status}`);
      return r.json();
    });
  }
  return stationsPromise;
}

// Returns the k nearest stations to (lat, lon), sorted by ascending distance (km).
export async function nearest(lat, lon, k = 5) {
  const stations = await loadStations();
  const scored = new Array(stations.length);
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    scored[i] = { ...s, distance: haversineKm(lat, lon, s.lat, s.lon) };
  }
  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, k);
}
