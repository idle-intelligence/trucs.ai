// corrections.js — physics-correct averaging on top of the plain
// distance-weighted average, after Nalder & Wein (1998) and standard
// meteorological practice:
//   - temperature: reduced to the target elevation with a lapse rate fitted
//     by least squares across the neighbours (falls back to the standard
//     atmosphere, -6.5 K/km, if fewer than 3 stations or an implausible fit).
//   - dew point: averaged as vapour pressure (Magnus formula), then converted
//     back, since dew point itself is not a linearly averageable quantity.
//   - pressure: the altimeter setting (QNH) is averaged, then reduced to
//     station pressure at the target elevation.
//   - wind: averaged as vector components (u, v), not scalar speed/direction.
// Observations older than 60 minutes are excluded from the corrected average
// (the plain average does not apply this cutoff, for comparison).

import { idw } from './idw.js';
import {
  fitLapseRateKPerKm,
  reduceTempToElevation,
  vaporPressureHpa,
  dewpointFromVaporPressureHpa,
  stationPressureHpa,
  windComponents,
  windFromComponents,
  stdDev,
  idwAverage,
} from './physics.js';

export const MAX_AGE_MIN = 60;

function ageMinutes(obsTime, now) {
  if (!(obsTime instanceof Date) || Number.isNaN(obsTime.getTime())) return null;
  return (now.getTime() - obsTime.getTime()) / 60000;
}

// rows: final neighbours (each carrying .obs), sorted by ascending distance.
// targetElevM: target-point elevation (Open-Meteo), or null if unavailable.
export function computeCorrections(rows, targetElevM, now = new Date()) {
  const withAge = rows.map((s) => ({ s, age: ageMinutes(s.obs?.obsTime, now) }));
  const hasTarget = Number.isFinite(targetElevM);

  // ---- temperature ----
  const tPts = withAge
    .filter(({ s }) => Number.isFinite(s.obs?.tempC))
    .map(({ s, age }) => ({
      icao: s.icao, distance: s.distance, elevM: s.elev, value: s.obs.tempC, age,
      included: age != null && age <= MAX_AGE_MIN,
    }));
  const tFresh = tPts.filter((p) => p.included && Number.isFinite(p.elevM));
  const lapse = fitLapseRateKPerKm(tFresh.map((p) => ({ elevM: p.elevM, tempC: p.value })));
  const tempCorrPoints = hasTarget
    ? tFresh.map((p) => ({ ...p, correctedValue: reduceTempToElevation(p.value, p.elevM, targetElevM, lapse.lapseKPerKm) }))
    : [];
  const temperature = {
    plain: tPts.length ? idw(tPts).value : null,
    corrected: tempCorrPoints.length ? idwAverage(tempCorrPoints, tempCorrPoints.map((p) => p.correctedValue)) : null,
    points: tPts.map((p) => ({ ...p, correctedValue: tempCorrPoints.find((c) => c.icao === p.icao)?.correctedValue ?? null })),
    lapse,
    spread: stdDev(tPts.map((p) => p.value)),
    nearestDist: tPts.length ? Math.min(...tPts.map((p) => p.distance)) : null,
    elevSpread: tFresh.length ? Math.max(...tFresh.map((p) => p.elevM)) - Math.min(...tFresh.map((p) => p.elevM)) : null,
    maxAge: tPts.length ? Math.max(...tPts.map((p) => p.age ?? 0)) : null,
    excluded: tPts.filter((p) => !p.included).length,
  };

  // ---- dew point ----
  const dPts = withAge
    .filter(({ s }) => Number.isFinite(s.obs?.dewpointC))
    .map(({ s, age }) => ({ icao: s.icao, distance: s.distance, value: s.obs.dewpointC, age, included: age != null && age <= MAX_AGE_MIN }));
  const dFresh = dPts.filter((p) => p.included);
  const ePoints = dFresh.map((p) => ({ ...p, e: vaporPressureHpa(p.value) }));
  const eAvg = ePoints.length ? idwAverage(ePoints, ePoints.map((p) => p.e)) : null;
  const dewpoint = {
    plain: dPts.length ? idw(dPts).value : null,
    corrected: eAvg != null ? dewpointFromVaporPressureHpa(eAvg) : null,
    points: dPts.map((p) => ({ ...p, e: vaporPressureHpa(p.value) })),
    spread: stdDev(dPts.map((p) => p.value)),
    nearestDist: dPts.length ? Math.min(...dPts.map((p) => p.distance)) : null,
    maxAge: dPts.length ? Math.max(...dPts.map((p) => p.age ?? 0)) : null,
    excluded: dPts.filter((p) => !p.included).length,
  };

  // ---- pressure ----
  const pPts = withAge
    .filter(({ s }) => Number.isFinite(s.obs?.pressureHpa))
    .map(({ s, age }) => ({ icao: s.icao, distance: s.distance, value: s.obs.pressureHpa, age, included: age != null && age <= MAX_AGE_MIN }));
  const pFresh = pPts.filter((p) => p.included);
  const qnhAvg = pFresh.length ? idwAverage(pFresh, pFresh.map((p) => p.value)) : null;
  const pressure = {
    plain: pPts.length ? idw(pPts).value : null,
    correctedQnh: qnhAvg,
    correctedStation: qnhAvg != null && hasTarget ? stationPressureHpa(qnhAvg, targetElevM) : null,
    points: pPts,
    spread: stdDev(pPts.map((p) => p.value)),
    nearestDist: pPts.length ? Math.min(...pPts.map((p) => p.distance)) : null,
    maxAge: pPts.length ? Math.max(...pPts.map((p) => p.age ?? 0)) : null,
    excluded: pPts.filter((p) => !p.included).length,
  };

  // ---- wind ----
  const wPts = withAge
    .filter(({ s }) => Number.isFinite(s.obs?.windMs) && Number.isFinite(s.obs?.windDirDeg))
    .map(({ s, age }) => ({ icao: s.icao, distance: s.distance, speed: s.obs.windMs, dir: s.obs.windDirDeg, age, included: age != null && age <= MAX_AGE_MIN }));
  const wFresh = wPts.filter((p) => p.included);
  const wVec = wFresh.map((p) => ({ ...p, ...windComponents(p.speed, p.dir) }));
  const uAvg = wVec.length ? idwAverage(wVec, wVec.map((p) => p.u)) : null;
  const vAvg = wVec.length ? idwAverage(wVec, wVec.map((p) => p.v)) : null;
  const vecResult = uAvg != null && vAvg != null ? windFromComponents(uAvg, vAvg) : null;
  const wind = {
    plainScalarSpeed: wPts.length ? idwAverage(wPts, wPts.map((p) => p.speed)) : null,
    correctedSpeed: vecResult?.speed ?? null,
    correctedDir: vecResult?.dir ?? null,
    points: wPts,
    spread: stdDev(wPts.map((p) => p.speed)),
    nearestDist: wPts.length ? Math.min(...wPts.map((p) => p.distance)) : null,
    maxAge: wPts.length ? Math.max(...wPts.map((p) => p.age ?? 0)) : null,
    excluded: wPts.filter((p) => !p.included).length,
  };

  return { targetElevM: hasTarget ? targetElevM : null, lapse, temperature, dewpoint, pressure, wind };
}
