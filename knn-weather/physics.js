// physics.js — small numeric primitives for the elevation, vapour-pressure,
// QNH and vector-wind corrections in corrections.js (see that file for the
// method description and its source, after Nalder & Wein 1998).

export function leastSquaresSlope(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

// points: [{ elevM, tempC }]. Falls back to the standard atmosphere lapse
// rate (-6.5 K/km) if there are too few stations or the fit is implausible.
export function fitLapseRateKPerKm(points) {
  const STANDARD = -6.5;
  if (points.length < 3) {
    return { lapseKPerKm: STANDARD, fallback: true, reason: `only ${points.length} station(s) with elevation and temperature (need >=3)` };
  }
  const slopePerM = leastSquaresSlope(points.map((p) => p.elevM), points.map((p) => p.tempC));
  const lapseKPerKm = slopePerM * 1000;
  if (Math.abs(lapseKPerKm) > 15) {
    return { lapseKPerKm: STANDARD, fallback: true, reason: `fitted lapse rate ${lapseKPerKm.toFixed(1)} K/km is implausible (>15 K/km)`, fitted: lapseKPerKm };
  }
  return { lapseKPerKm, fallback: false };
}

export function reduceTempToElevation(tempC, stationElevM, targetElevM, lapseKPerKm) {
  return tempC + (lapseKPerKm / 1000) * (targetElevM - stationElevM);
}

// Magnus formula, hPa, td in °C.
export function vaporPressureHpa(tdC) {
  return 6.112 * Math.exp((17.62 * tdC) / (243.12 + tdC));
}

export function dewpointFromVaporPressureHpa(eHpa) {
  const ln = Math.log(eHpa / 6.112);
  return (243.12 * ln) / (17.62 - ln);
}

// QNH (altimeter setting, hPa) -> station pressure at elevM.
export function stationPressureHpa(qnhHpa, elevM) {
  return qnhHpa * Math.pow(1 - (0.0065 * elevM) / 288.15, 5.255);
}

// Meteorological convention: dir is where the wind blows FROM.
export function windComponents(speedMs, dirDeg) {
  const rad = (dirDeg * Math.PI) / 180;
  return { u: -speedMs * Math.sin(rad), v: -speedMs * Math.cos(rad) };
}

export function windFromComponents(u, v) {
  const speed = Math.sqrt(u * u + v * v);
  const dir = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
  return { speed, dir };
}

export function stdDev(values) {
  if (values.length === 0) return null;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// Same weighting as idw.js (weight = 1/distance, exact-match override at d=0),
// applied to an arbitrary derived value per point rather than the raw value.
export function idwAverage(points, values) {
  const zeroIdx = points.findIndex((p) => p.distance === 0);
  const weights = zeroIdx >= 0
    ? points.map((_, i) => (i === zeroIdx ? 1 : 0))
    : points.map((p) => 1 / p.distance);
  const total = weights.reduce((a, b) => a + b, 0);
  return values.reduce((sum, v, i) => sum + v * weights[i], 0) / total;
}
