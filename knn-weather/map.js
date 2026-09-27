// map.js — plain canvas 2D basemap: country borders, a few city labels, a
// sparse sample of weather stations, the used stations for the current
// estimate (each with its data drawn alongside it), and the selected point.
// Web Mercator, no libraries, no tiles.
//
// Data: Natural Earth 1:110m (and, lazily once zoomed in, 1:50m) admin-0
// countries, and populated-places-simple at the same two scales (all public
// domain), fetched once and cached for the session.

// Palette: a dark desaturated blue ocean against an off-white land mass is
// the standard figure-ground contrast for reference maps (Wikipedia,
// "Figure-ground (cartography)": partitioning into a light land / dark sea
// pairs is used specifically so the coastline itself carries the contrast,
// not just the boundary lines). Land tone and border weight follow the
// "muted background, subtle admin lines" guidance in GIS Geography's "5
// Types of Color Combinations for Maps" and Map Library's cartographic
// color-theory notes (both: keep reference/background layers muted so the
// data drawn on top - here, stations and the point - stays the visual
// focus). HALO is used as a text/dot/line casing (a standard label
// technique) so those stay legible over both the light land and dark ocean.
const OCEAN = '#1c2b38';
const LAND = '#f2f0ea';
const BORDER = '#9c9a8f';
const HALO = '#fff';

const TILE = 256;
const MIN_ZOOM = 1.5;
const MAX_ZOOM = 10;
const REGION_SPAN_KM = 500; // idle/region view on load: country-ish scale
const SELECTION_SPAN_KM = 40; // floor for a tap/city/geo selection: station scale
const FIFTY_M_ZOOM = 6; // switch to finer country borders and city set past this zoom

const COUNTRIES_110M_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
// Finer coastlines past FIFTY_M_ZOOM come from two files rather than
// ne_50m_admin_0_countries.geojson: measured gzip transfer sizes (curl -H
// 'Accept-Encoding: gzip' -w '%{size_download}', 2026-09-23) were
// ne_50m_admin_0_countries.geojson: 1,022,612 B; ne_50m_land.geojson (fill
// only): 529,836 B; ne_50m_admin_0_boundary_lines_land.geojson (borders
// only): 195,680 B. Land + boundary together (725,516 B) is ~29% smaller
// than the single admin_0_countries file, because that file repeats each
// shared border's geometry once per adjacent country plus per-country
// attribute columns this page never reads.
const LAND_50M_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson';
const BOUNDARY_50M_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_boundary_lines_land.geojson';
const CITIES_110M_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_populated_places_simple.geojson';
const CITIES_50M_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_populated_places_simple.geojson';
// The background dots and ids drawn at every zoom come from the same
// station list knn.js already loads for the nearest-neighbor search (one
// fetch, one list — a separate derived file drifted out of sync with the
// search list once the search list changed source).
import { loadStationRowsParsed } from './knn.js';

let countries110Promise = null;
let land50Promise = null;
let boundary50Promise = null;
let cities110Promise = null;
let cities50Promise = null;
let stationsMapPromise = null;

function loadStationsMap() {
  if (!stationsMapPromise) {
    stationsMapPromise = loadStationRowsParsed()
      .then((rows) => rows.map(([id, lat, lon, elev]) => ({ id, lat, lon, elev })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  }
  return stationsMapPromise;
}

function loadCountries110() {
  if (!countries110Promise) {
    countries110Promise = fetch(COUNTRIES_110M_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`countries110 ${r.status}`))))
      .then((d) => d.features);
  }
  return countries110Promise;
}

// Fetched together, right after the 110m world view first paints, once the
// map is at region zoom or closer (see FIFTY_M_ZOOM) — kept for every zoom
// past that, not just a "closer still" tier.
function loadLand50() {
  if (!land50Promise) {
    land50Promise = fetch(LAND_50M_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`land50 ${r.status}`))))
      .then((d) => d.features);
  }
  return land50Promise;
}

function loadBoundary50() {
  if (!boundary50Promise) {
    boundary50Promise = fetch(BOUNDARY_50M_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`boundary50 ${r.status}`))))
      .then((d) => d.features);
  }
  return boundary50Promise;
}

function toCities(d) {
  return d.features
    .map((f) => ({
      name: f.properties.nameascii || f.properties.name,
      lat: f.properties.latitude,
      lon: f.properties.longitude,
      scalerank: f.properties.scalerank,
      minZoom: f.properties.min_zoom ?? 6,
    }))
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
}

function loadCities110() {
  if (!cities110Promise) {
    cities110Promise = fetch(CITIES_110M_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`cities110 ${r.status}`))))
      .then(toCities);
  }
  return cities110Promise;
}

// Only fetched once a map zooms in past FIFTY_M_ZOOM: more cities, same
// ne_*_populated_places_simple shape as the 110m set. ne_10m would add
// finer detail still, but at ~4.9MB (vs. ~850KB for 50m) that is not cheap
// enough for a lazy fetch on a minimal page, so this stops at 50m.
function loadCities50() {
  if (!cities50Promise) {
    cities50Promise = fetch(CITIES_50M_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`cities50 ${r.status}`))))
      .then(toCities);
  }
  return cities50Promise;
}

function mercX(lon) {
  return (lon + 180) / 360;
}

function mercY(lat) {
  const clamped = Math.max(Math.min(lat, 85.05112878), -85.05112878);
  const rad = (clamped * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI);
}

function invMercLon(fx) {
  return fx * 360 - 180;
}

function invMercLat(fy) {
  const n = Math.PI - 2 * Math.PI * fy;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// view: { wx, wy, zoom } — wx/wy are world-pixel coordinates (0..TILE*2^zoom)
// of the point currently centered on the canvas.
export function createMapView(canvas, { onTap } = {}) {
  const ctx = canvas.getContext('2d');
  let dpr = window.devicePixelRatio || 1;
  let cssW = 0;
  let cssH = 0;

  // Root cause of the off-center idle map: this used to be { wx: TILE / 2,
  // wy: TILE / 2 }, which is only the world-pixel center of lon 0/lat 0 at
  // zoom 0 (scale = TILE). At any other zoom the scale is TILE * 2^zoom, so
  // the center must be scaled the same way — otherwise the "centered" point
  // drifts toward the bottom-right as zoom grows. Not DPR-dependent; it just
  // wasn't visible until the map defaulted to a non-zero starting zoom.
  const INITIAL_ZOOM = 1.5;
  const initialScale = TILE * 2 ** INITIAL_ZOOM;
  const view = { wx: 0.5 * initialScale, wy: 0.5 * initialScale, zoom: INITIAL_ZOOM }; // lon 0, lat 0

  let cities110 = null;
  let cities50 = null;
  let countries110 = null;
  let land50 = null;
  let boundary50 = null;
  let stationGrid = null; // Map<"cx,cy", station[]>, built once from the station list
  let overlayRects = []; // real DOM rects (canvas-local px) of the status/panel overlays
  let visibleStations = [];
  let usedStations = [];
  let point = null; // { lat, lon }

  // Grid cell size in degrees. A viewport only ever touches a handful of
  // cells, so a pan/zoom redraw only iterates nearby stations instead of
  // all ~8k every frame.
  const STATION_GRID_CELL = 2;

  function buildStationGrid(stations) {
    const grid = new Map();
    for (const s of stations) {
      const cx = Math.floor(s.lon / STATION_GRID_CELL);
      const cy = Math.floor(s.lat / STATION_GRID_CELL);
      const key = `${cx},${cy}`;
      let bucket = grid.get(key);
      if (!bucket) grid.set(key, (bucket = []));
      bucket.push(s);
    }
    return grid;
  }

  // Collects every station whose grid cell overlaps the current viewport
  // (with a small pad so labels near the edge don't pop in/out), in the
  // grid's fixed id order — this is what makes label placement stable
  // while panning: the same stations are tried in the same order every
  // frame, so the same subset wins the collision pass until the zoom (and
  // so which stations even fit on screen) changes.
  function collectVisibleStations() {
    if (!stationGrid) {
      visibleStations = [];
      return;
    }
    const pad = 0.15;
    const tl = lonLatOfScreen(-cssW * pad, -cssH * pad);
    const br = lonLatOfScreen(cssW * (1 + pad), cssH * (1 + pad));
    const latMin = Math.min(tl.lat, br.lat);
    const latMax = Math.max(tl.lat, br.lat);
    const lonMin = tl.lon;
    const lonMax = br.lon;
    const cxMin = Math.floor(lonMin / STATION_GRID_CELL);
    const cxMax = Math.floor(lonMax / STATION_GRID_CELL);
    const cyMin = Math.floor(latMin / STATION_GRID_CELL);
    const cyMax = Math.floor(latMax / STATION_GRID_CELL);
    const out = [];
    for (let cy = cyMin; cy <= cyMax; cy++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const bucket = stationGrid.get(`${cx},${cy}`);
        if (!bucket) continue;
        for (const s of bucket) {
          if (s.lat < latMin || s.lat > latMax || s.lon < lonMin || s.lon > lonMax) continue;
          out.push(s);
        }
      }
    }
    // Buckets are unordered relative to each other; re-sort by id so the
    // priority order used for label placement is the same fixed order
    // regardless of which cells a given pan happens to touch.
    out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    visibleStations = out;
  }

  function worldPx(lat, lon, zoom = view.zoom) {
    const scale = TILE * 2 ** zoom;
    return { x: mercX(lon) * scale, y: mercY(lat) * scale };
  }

  function screenOf(lat, lon) {
    const p = worldPx(lat, lon);
    return { x: cssW / 2 + (p.x - view.wx), y: cssH / 2 + (p.y - view.wy) };
  }

  function lonLatOfScreen(sx, sy) {
    const scale = TILE * 2 ** view.zoom;
    const wx = view.wx + (sx - cssW / 2);
    const wy = view.wy + (sy - cssH / 2);
    return { lon: invMercLon(wx / scale), lat: invMercLat(wy / scale) };
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    cssW = rect.width;
    cssH = rect.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    schedule();
  }

  function drawRing(ring) {
    ring.forEach(([lon, lat], i) => {
      const p = screenOf(lat, lon);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
  }

  function drawLine(coords) {
    coords.forEach(([lon, lat], i) => {
      const p = screenOf(lat, lon);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
  }

  function forEachPolygon(features, fn) {
    for (const f of features) {
      const g = f.geometry;
      if (!g) continue;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) for (const ring of poly) fn(ring);
    }
  }

  function forEachLine(features, fn) {
    for (const f of features) {
      const g = f.geometry;
      if (!g) continue;
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const line of lines) fn(line);
    }
  }

  // 110m (world view, always loaded) fills and strokes from one file, since
  // at that scale a single admin_0_countries pass is plenty. Past
  // FIFTY_M_ZOOM the fill switches to ne_50m_land.geojson and the stroke to
  // ne_50m_admin_0_boundary_lines_land.geojson (see the size comment above
  // loadLand50/loadBoundary50) for real coastline detail.
  function drawCountries() {
    const useFine = view.zoom > FIFTY_M_ZOOM && land50 && boundary50;
    if (useFine) {
      ctx.beginPath();
      forEachPolygon(land50, drawRing);
      ctx.fillStyle = LAND;
      ctx.fill();
      ctx.beginPath();
      forEachLine(boundary50, drawLine);
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }
    if (!countries110) return;
    ctx.beginPath();
    forEachPolygon(countries110, drawRing);
    ctx.fillStyle = LAND;
    ctx.fill();
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ── Label placement: a simple collision pass shared by city names and used-
  // station ids. The point marker reserves its zone first and always wins. ──

  let placedRects = [];

  function rectsOverlap(a, b) {
    return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
  }

  function reserve(rect) {
    placedRects.push(rect);
  }

  function collides(rect) {
    return placedRects.some((r) => rectsOverlap(rect, r));
  }

  // Tries a small set of offsets around (x, y) for `text`; reserves and
  // returns the first that doesn't collide, or null if every offset does
  // (the dot is still drawn, just without a label).
  // Draws `text` (plain, no background, no stroke halo — TC, 2026-09-23:
  // "the cities names with a white underlay feel wrong") at the first free
  // offset around (x, y), or nothing if every offset collides.
  function placeLabel(x, y, text, color) {
    const w = ctx.measureText(text).width;
    const h = 11;
    const offsets = [
      [5, 0],
      [5, 11],
      [-w - 5, 0],
      [5, -11],
    ];
    for (const [dx, dy] of offsets) {
      const rect = { x1: x + dx - 1, y1: y + dy - h / 2, x2: x + dx + w + 1, y2: y + dy + h / 2 };
      if (collides(rect)) continue;
      reserve(rect);
      ctx.fillStyle = color;
      ctx.fillText(text, x + dx, y + dy);
      return true;
    }
    return false;
  }

  // ── Halo helpers: a light casing behind dark ink, so dots/lines/labels
  // stay legible over both the light land and the dark ocean fill. ──

  function haloDot(x, y, r, fillStyle) {
    ctx.beginPath();
    ctx.arc(x, y, r + 1.3, 0, Math.PI * 2);
    ctx.fillStyle = HALO;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  function haloRingDot(x, y, r, strokeStyle, lineWidth) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = HALO;
    ctx.lineWidth = lineWidth + 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  // A small opaque-ish white backing sized to the given box — used behind
  // text instead of a stroke halo, which read as a smeared white glow
  // around each letter (TC, 2026-09-23).
  const PRINT_BG = 'rgba(255, 255, 255, 0.9)';

  function printBg(x1, y1, x2, y2) {
    ctx.fillStyle = PRINT_BG;
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  }

  function drawCities() {
    if (view.zoom > FIFTY_M_ZOOM && !cities50) {
      loadCities50().then((data) => {
        cities50 = data;
        schedule();
      });
    }
    const useFine = view.zoom > FIFTY_M_ZOOM && cities50;
    const cities = useFine ? cities50 : cities110;
    if (!cities) return;
    ctx.font = '10px monospace';
    ctx.textBaseline = 'middle';
    const shown = cities.filter((c) => view.zoom >= c.minZoom - 1.5).sort((a, b) => a.scalerank - b.scalerank);
    let labelled = 0;
    for (const c of shown) {
      const p = screenOf(c.lat, c.lon);
      if (p.x < -20 || p.x > cssW + 20 || p.y < -20 || p.y > cssH + 20) continue;
      const dotRect = { x1: p.x - 2, y1: p.y - 2, x2: p.x + 2, y2: p.y + 2 };
      if (collides(dotRect)) continue;
      reserve(dotRect);
      haloDot(p.x, p.y, 1.5, '#555');
      if (placeLabel(p.x, p.y, c.name, '#555')) labelled++;
      if (labelled >= 10) break;
    }
  }

  // Paint order vs. collision-priority order are different things (TC,
  // 2026-09-23, after background dots painted over used-station blocks):
  // background dots must be painted BEFORE used-station dots/blocks so the
  // blocks' print-label backgrounds sit visually on top of them, but the id
  // LABELS still collide in lowest-priority order — the point, used-station
  // blocks, city names, then plain station ids — so their placement is
  // attempted last, after every higher-priority rect (blocks, city labels,
  // and the status/result-panel overlays) is already reserved. Reservation
  // order therefore stays as before; only when each piece is drawn moves.

  // Called early, right after the basemap: one dot per visible station,
  // used stations included (their own dot is redrawn on top later — cheap,
  // and keeps this function independent of which stations end up "used").
  // Paints only — no reserve() here. A dot's screen position is fixed by
  // geography and can't be moved, so it must never compete for space with
  // blocks/cities/other labels the way a placed label does; it just needs
  // to be visually underneath anything that outranks it, which painting
  // order alone guarantees. (A first attempt at this bug reserved dots
  // here too, which made almost every used-station block placement fail at
  // any zoom dense enough to have background dots near the point — TC,
  // 2026-09-23.)
  function drawStationDots() {
    for (const s of visibleStations) {
      const p = screenOf(s.lat, s.lon);
      haloDot(p.x, p.y, 1.5, '#999');
    }
  }

  // Called last: id labels, lowest priority, skipped for used stations
  // (they already have a block) and capped for the world view where
  // thousands of stations can be visible at once. Each dot's rect is
  // reserved here — at the same low-priority point in the sequence as
  // before — only so two plain id labels don't land on each other's dots;
  // it happens well after blocks and city labels have already claimed
  // their space.
  const MAX_STATION_LABEL_ATTEMPTS = 400;

  function drawStationLabels() {
    for (const s of visibleStations) {
      if (usedStations.some((u) => u.icao === s.id)) continue;
      const p = screenOf(s.lat, s.lon);
      reserve({ x1: p.x - 2, y1: p.y - 2, x2: p.x + 2, y2: p.y + 2 });
    }
    // visibleStations includes a padded margin outside the canvas (so
    // labels are ready just before a station pans into view). The cap used
    // to apply to that combined, id-sorted list, so an off-canvas station
    // with an alphabetically early id could burn the whole budget before
    // any genuinely on-screen station got a single attempt (TC, 2026-09-23:
    // a station stayed unlabelled for several pans, only labelling once it
    // was "well into the map"). On-canvas stations are tried first, with no
    // cap — the real limit on how many can ever succeed is screen space,
    // enforced by the collision pass itself — and only the padding-margin
    // stations share the capped remainder, since they're a preload, not
    // something the visitor is looking at yet.
    const onCanvas = [];
    const padOnly = [];
    for (const s of visibleStations) {
      if (usedStations.some((u) => u.icao === s.id)) continue;
      const p = screenOf(s.lat, s.lon);
      (p.x >= 0 && p.x <= cssW && p.y >= 0 && p.y <= cssH ? onCanvas : padOnly).push(s);
    }
    for (const s of onCanvas) {
      const p = screenOf(s.lat, s.lon);
      placeLabel(p.x, p.y, s.id, '#555');
    }
    let attempts = 0;
    for (const s of padOnly) {
      if (attempts >= MAX_STATION_LABEL_ATTEMPTS) break;
      attempts++;
      const p = screenOf(s.lat, s.lon);
      placeLabel(p.x, p.y, s.id, '#555');
    }
  }

  function drawPoint() {
    if (!point) return;
    const pp = screenOf(point.lat, point.lon);
    // Reserve the crosshair's zone first: the point always wins.
    reserve({ x1: pp.x - 9, y1: pp.y - 9, x2: pp.x + 9, y2: pp.y + 9 });
    for (const [color, width] of [[HALO, 3.5], ['#111', 1.5]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(pp.x - 6, pp.y);
      ctx.lineTo(pp.x + 6, pp.y);
      ctx.moveTo(pp.x, pp.y - 6);
      ctx.lineTo(pp.x, pp.y + 6);
      ctx.stroke();
    }
    haloRingDot(pp.x, pp.y, 6, '#111', 1.5);
  }

  function drawLines() {
    if (!point || usedStations.length === 0) return;
    const pp = screenOf(point.lat, point.lon);
    for (const [color, width] of [[HALO, 3], ['#999', 1]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const s of usedStations) {
        const sp = screenOf(s.lat, s.lon);
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(pp.x, pp.y);
      }
      ctx.stroke();
    }
  }

  const BLOCK_FONT = '9px "Courier New", Courier, monospace';
  const BLOCK_LINE_H = 11;

  // Places a small vertical text block next to (x, y): tries right, left,
  // below, above (in that order), skipping any that collide with something
  // already reserved (a used station never overlaps the point marker, since
  // drawPoint() reserves its zone first). Draws a thin leader line from the
  // dot to the block when placed, since the block always sits a few px away.
  // 8 directions around the dot (the 4 sides plus 4 corners), tried at a
  // near and a far distance — 16 candidates total, up from the original 4
  // sides only. At region zoom, 5 used-station blocks packed close together
  // could exhaust 4 candidates before every block had a home, so 1-2 blocks
  // were silently dropped (TC, 2026-09-23: "only 2 of the 5 ... are
  // drawn"). More candidates makes that far less likely; the compact
  // last-resort fallback in placeBlock() below covers whatever's left.
  function blockCandidates(w, h, gaps) {
    const offsets = [];
    for (const gap of gaps) {
      offsets.push(
        { dx: gap, dy: -h / 2 },
        { dx: -gap - w, dy: -h / 2 },
        { dx: -w / 2, dy: gap },
        { dx: -w / 2, dy: -gap - h },
        { dx: gap, dy: -h - gap },
        { dx: gap, dy: gap },
        { dx: -gap - w, dy: -h - gap },
        { dx: -gap - w, dy: gap },
      );
    }
    return offsets;
  }

  // gaps: how far from the dot to try, at 8 directions each. The primary
  // (full) block only tries two distances — beyond that a "nearby" block
  // stops reading as belonging to its dot. The compact last-resort block is
  // small enough, and rare enough, that it can afford to search much
  // farther out (TC, 2026-09-23: at region zoom, 5 clustered stations'
  // blocks can fully surround the point within the first two distances,
  // so the 5th needs a wider search to find any gap at all).
  function tryPlaceBox(x, y, lines, gaps) {
    const pad = 3;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
    const h = lines.length * BLOCK_LINE_H + pad * 2;
    for (const c of blockCandidates(w, h, gaps)) {
      const rect = { x1: x + c.dx, y1: y + c.dy, x2: x + c.dx + w, y2: y + c.dy + h };
      if (collides(rect)) continue;
      reserve(rect);
      const cx = Math.max(rect.x1, Math.min(x, rect.x2));
      const cy = Math.max(rect.y1, Math.min(y, rect.y2));
      for (const [color, width] of [[HALO, 3], ['#999', 1]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(cx, cy);
        ctx.stroke();
      }
      printBg(rect.x1, rect.y1, rect.x2, rect.y2);
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#111';
      lines.forEach((line, i) => ctx.fillText(line, rect.x1 + pad, rect.y1 + pad + i * BLOCK_LINE_H));
      return true;
    }
    return false;
  }

  // A used station's block always wins over plain ids and city names
  // (those are placed later and simply skip any rect a block already
  // reserved — see draw()'s call order). This only ever fails to find room
  // against OTHER used-station blocks, since there are at most 5 of them;
  // compactLines (id + temperature only, tried at the same 16 offsets) is
  // the last resort so a block never just disappears.
  function placeBlock(x, y, lines, compactLines) {
    ctx.font = BLOCK_FONT;
    if (tryPlaceBox(x, y, lines, [7, 14])) return true;
    if (compactLines && tryPlaceBox(x, y, compactLines, [7, 14, 21, 28, 35, 42, 56, 70, 90, 110, 130])) return true;
    return false; // genuinely no room left; the dot alone still shows
  }

  // A station without a usable observation is not skipped (it is still the
  // geometrically nearest one), but it is drawn as a hollow dot rather than
  // a filled one so it reads as "no recent data" rather than being confused
  // with a normal reading. Background sparse stations stay in their own
  // light gray style regardless — whether an arbitrary station is currently
  // reporting isn't something this page can know without querying it, so
  // only the actually-queried used stations get this distinction.
  // Two passes: every dot is drawn and reserved first, then every block is
  // placed. Otherwise a block placed while an earlier station is processed
  // could still get drawn over by a later station's dot, since a dot's
  // position is fixed by geography and can't be moved out of the way.
  function drawUsedStations() {
    const compact = cssW < 480;
    for (const s of usedStations) {
      const sp = screenOf(s.lat, s.lon);
      const hasObs = s.label ? s.label.hasObs : true;
      reserve({ x1: sp.x - 3, y1: sp.y - 3, x2: sp.x + 3, y2: sp.y + 3 });
      if (hasObs) {
        haloDot(sp.x, sp.y, 3, '#111');
      } else {
        haloRingDot(sp.x, sp.y, 3, '#555', 1.2);
      }
    }
    for (const s of usedStations) {
      if (!s.label) continue;
      const sp = screenOf(s.lat, s.lon);
      const hasObs = s.label.hasObs;
      const lines = !hasObs
        ? [s.label.name, `${s.label.id} ${s.label.distanceKm}km`, 'no recent report']
        : compact
          ? [s.label.id, s.label.tempStr, s.label.windStr]
          : [
              s.label.name,
              `${s.label.id} ${s.label.distanceKm}km`,
              s.label.tempStr,
              s.label.dewStr,
              s.label.windStr,
              s.label.pressureStr,
              s.label.ageStr,
            ];
      const compactLines = [s.label.id, hasObs ? s.label.tempStr : 'no report'];
      placeBlock(sp.x, sp.y, lines, compactLines);
    }
  }

  let raf = null;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(draw);
  }

  // The status line and result panel are HTML/CSS overlays, not drawn on
  // the canvas, but they cover real screen area. A fixed guessed box here
  // was the root cause of a station staying unlabelled for several pans on
  // phone (TC, 2026-09-23): on narrow layouts the result panel moves BELOW
  // the map (see the index.html media query), so the guessed top-right
  // 160x100 box was reserved on the canvas even though nothing was really
  // there, and it was large enough relative to a phone-width canvas to
  // blank out a real station's only clear spot for several frames. Fixed
  // by having index.html measure each overlay's actual
  // getBoundingClientRect() (relative to the canvas, after every resize
  // and status/result update) and pass only the ones that truly overlap
  // the canvas via setOverlayRects().
  function reserveOverlayRects() {
    for (const r of overlayRects) reserve(r);
  }

  function draw() {
    raf = null;
    placedRects = [];
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = OCEAN;
    ctx.fillRect(0, 0, cssW, cssH);
    drawCountries();
    collectVisibleStations();
    reserveOverlayRects();
    drawStationDots();
    drawLines();
    drawPoint(); // reserves its zone before any label is placed
    drawUsedStations(); // dots, then blocks — blocks paint over dots below
    drawCities();
    drawStationLabels(); // lowest priority: placed only where nothing else won
    ctx.strokeStyle = '#ddd';
    ctx.strokeRect(0.5, 0.5, cssW - 1, cssH - 1);
    ctx.restore();
  }

  function setZoom(newZoom, aroundScreen) {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    if (clamped === view.zoom) return;
    const anchor = aroundScreen ?? { x: cssW / 2, y: cssH / 2 };
    const before = lonLatOfScreen(anchor.x, anchor.y);
    const scale = 2 ** (clamped - view.zoom);
    view.wx *= scale;
    view.wy *= scale;
    view.zoom = clamped;
    const after = lonLatOfScreen(anchor.x, anchor.y);
    const shiftScale = TILE * 2 ** view.zoom;
    view.wx += (mercX(before.lon) - mercX(after.lon)) * shiftScale;
    view.wy += (mercY(before.lat) - mercY(after.lat)) * shiftScale;
    schedule();
  }

  function centerOn(lat, lon, zoom = view.zoom) {
    const p = worldPx(lat, lon, zoom);
    view.wx = p.x;
    view.wy = p.y;
    view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    schedule();
  }

  // Zoom that fits a spanKm x spanKm box centered at centerLat into the
  // current canvas, with `pad` fractional margin on each side.
  function zoomForSpanKm(centerLat, spanKm, pad) {
    const halfKm = spanKm / 2;
    const latHalfDeg = halfKm / 111.32;
    const lonHalfDeg = halfKm / (111.32 * Math.max(Math.cos((centerLat * Math.PI) / 180), 0.15));
    const spanXFrac = (2 * lonHalfDeg) / 360;
    const spanYFrac = mercY(centerLat - latHalfDeg) - mercY(centerLat + latHalfDeg);
    const zx = Math.log2((cssW * (1 - pad)) / (spanXFrac * TILE));
    const zy = Math.log2((cssH * (1 - pad)) / (spanYFrac * TILE));
    return Math.min(zx, zy);
  }

  // On load only: a region-level view (country/regional scale) centered on
  // a coarse location, with no point or stations selected yet.
  function showRegion(lat, lon) {
    centerOn(lat, lon, Math.min(zoomForSpanKm(lat, REGION_SPAN_KM, 0.35), 8));
  }

  // Fits the point + its used stations tightly (25% padding), then clamps
  // zoom so it never goes in past SELECTION_SPAN_KM — a single very close
  // station should not zoom to street level. At this scale country borders
  // are often out of view; that's fine, the point is to read the stations.
  function fitTo(lat, lon, stations) {
    const lats = [lat, ...stations.map((s) => s.lat)];
    const lons = [lon, ...stations.map((s) => s.lon)];
    const latMin = Math.min(...lats);
    const latMax = Math.max(...lats);
    const lonMin = Math.min(...lons);
    const lonMax = Math.max(...lons);
    const centerLat = (latMin + latMax) / 2;
    const centerLon = (lonMin + lonMax) / 2;
    const pad = 0.25;

    const spanX = Math.max(mercX(lonMax) - mercX(lonMin), 1e-6);
    const spanY = Math.max(mercY(latMin) - mercY(latMax), 1e-6);
    const zx = Math.log2((cssW * (1 - pad)) / (spanX * TILE));
    const zy = Math.log2((cssH * (1 - pad)) / (spanY * TILE));
    const zCap = zoomForSpanKm(centerLat, SELECTION_SPAN_KM, pad);

    centerOn(centerLat, centerLon, Math.min(zx, zy, zCap, 8));
  }

  // ── Pointer interaction: drag to pan, wheel/pinch to zoom, tap to pick. ──
  //
  // Root cause of "when I zoom, it moves" (TC, 2026-09-23): pinch-zoom
  // called setZoom() with no anchor, which defaults to the canvas center —
  // so unless a pinch happened to be dead-center, the geo point under the
  // fingers drifted every frame. Fixed by anchoring at the pinch midpoint
  // and also panning by the midpoint's own movement (a pinch is rarely
  // perfectly stationary). Separately, lifting one finger mid-pinch reused
  // a single-finger drag baseline (lastX/lastY) that was last set before
  // the pinch started, producing a jump on the very next move; fixed by
  // re-baselining both the drag and pinch state on every pointerdown/up,
  // not just tracking one continuously-updated pair of numbers.

  let dragging = false;
  let dragMoved = false;
  let lastX = 0;
  let lastY = 0;
  let pinchDist = null;
  let pinchMidX = 0;
  let pinchMidY = 0;
  const pointers = new Map();

  function midpoint() {
    const [a, b] = Array.from(pointers.values());
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  // Called whenever the active pointer count changes (finger down or up),
  // so the next move always computes a delta from a fresh baseline.
  function reanchor() {
    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      const m = midpoint();
      pinchMidX = m.x;
      pinchMidY = m.y;
    } else {
      pinchDist = null;
    }
    if (pointers.size === 1) {
      const [p] = Array.from(pointers.values());
      lastX = p.x;
      lastY = p.y;
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragging = true;
    if (pointers.size >= 2) dragMoved = true; // a pinch is never a tap, however it ends
    else dragMoved = false;
    reanchor();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const m = midpoint();
      if (pinchDist) {
        // Pan by the midpoint's own movement first, so the point under the
        // fingers is exactly where they now are...
        view.wx -= m.x - pinchMidX;
        view.wy -= m.y - pinchMidY;
        // ...then zoom anchored at that (now current) midpoint, so the
        // geo point under the fingers stays fixed through the zoom too.
        const rect = canvas.getBoundingClientRect();
        setZoom(view.zoom + Math.log2(dist / pinchDist), { x: m.x - rect.left, y: m.y - rect.top });
      }
      pinchDist = dist;
      pinchMidX = m.x;
      pinchMidY = m.y;
      schedule();
      return;
    }

    if (pointers.size !== 1 || !dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
    view.wx -= dx;
    view.wy -= dy;
    lastX = e.clientX;
    lastY = e.clientY;
    schedule();
  });

  function endPointer(e) {
    const rect = canvas.getBoundingClientRect();
    const wasTap = pointers.size === 1 && dragging && !dragMoved;
    pointers.delete(e.pointerId);
    reanchor();
    if (wasTap && onTap) {
      const { lat, lon } = lonLatOfScreen(e.clientX - rect.left, e.clientY - rect.top);
      onTap(lat, lon);
    }
    if (pointers.size === 0) dragging = false;
  }

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      setZoom(view.zoom - e.deltaY * 0.0025, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    { passive: false },
  );

  new ResizeObserver(resize).observe(canvas);
  resize();

  loadCountries110()
    .then((data) => {
      countries110 = data;
      schedule();
      // Kick off the finer coastline data right after the 110m world view
      // first paints, rather than waiting for the user to zoom past
      // FIFTY_M_ZOOM — by the time they do (every region/selection view
      // starts past that zoom already), it's usually already cached.
      loadLand50().then((d) => {
        land50 = d;
        schedule();
      });
      loadBoundary50().then((d) => {
        boundary50 = d;
        schedule();
      });
    })
    .catch(() => {
      /* map still shows stations without country borders */
    });
  loadCities110()
    .then((data) => {
      cities110 = data;
      schedule();
    })
    .catch(() => {});
  loadStationsMap()
    .then((stations) => {
      stationGrid = buildStationGrid(stations);
      schedule();
    })
    .catch(() => {
      /* map still shows the point/used stations without the background set */
    });

  return {
    showRegion(lat, lon) {
      point = null;
      usedStations = [];
      showRegion(lat, lon);
    },
    // Sets the point and its stations without moving the view — used for a
    // map tap, which TC wants to select and compute in place. Stations
    // outside the current view still count; their lines just run off-edge.
    setSelection(lat, lon, used) {
      point = { lat, lon };
      usedStations = used;
      schedule();
    },
    // Same, but also fits the view to the point + stations — used for "use
    // my location", where the point could otherwise land off-screen.
    setSelectionAndFit(lat, lon, used) {
      point = { lat, lon };
      usedStations = used;
      fitTo(lat, lon, used);
    },
    // rects: array of {x1, y1, x2, y2} in canvas-local CSS px, already
    // filtered by the caller to only those that actually overlap the
    // canvas. See reserveOverlayRects().
    setOverlayRects(rects) {
      overlayRects = rects;
      schedule();
    },
    clear() {
      point = null;
      usedStations = [];
      schedule();
    },
    getZoom() {
      return view.zoom;
    },
    _lonLatAt(sx, sy) {
      return lonLatOfScreen(sx, sy);
    },
    _debug() {
      return { cssW, cssH, dpr, view: { ...view }, canvasW: canvas.width, canvasH: canvas.height };
    },
  };
}
