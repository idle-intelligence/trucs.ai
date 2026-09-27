// idw.js — inverse-distance-weighted kNN regression.
// Port of models.py build_global_metar_kNN: sklearn KNeighborsRegressor(weights='distance').
// sklearn's 'distance' weighting is weight = 1/d (NOT 1/d^2) — see sklearn/neighbors/_base.py
// _get_weights(): dist = 1.0 / dist, with the special case that if any neighbour has
// distance exactly 0, only that neighbour is used (weight 1) and all others get weight 0,
// to avoid a divide-by-zero / to make the observation itself authoritative.

// points: array of { value, distance } with value already a finite number and
// distance >= 0 (km). Returns { value, terms } where terms mirrors the weighting
// applied to each input point (for display), or null if points is empty.
export function idw(points) {
  if (points.length === 0) return null;

  const zeroIdx = points.findIndex((p) => p.distance === 0);
  let weights;
  if (zeroIdx >= 0) {
    weights = points.map((_, i) => (i === zeroIdx ? 1 : 0));
  } else {
    weights = points.map((p) => 1 / p.distance);
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const value = points.reduce((sum, p, i) => sum + p.value * weights[i], 0) / totalWeight;

  const terms = points.map((p, i) => ({
    value: p.value,
    distance: p.distance,
    weight: weights[i],
    weightNorm: weights[i] / totalWeight,
  }));

  return { value, terms };
}

// Circular version for wind direction (degrees). Weighted vector mean.
export function idwCircularDeg(points) {
  if (points.length === 0) return null;

  const zeroIdx = points.findIndex((p) => p.distance === 0);
  let weights;
  if (zeroIdx >= 0) {
    weights = points.map((_, i) => (i === zeroIdx ? 1 : 0));
  } else {
    weights = points.map((p) => 1 / p.distance);
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let sumSin = 0;
  let sumCos = 0;
  points.forEach((p, i) => {
    const rad = (p.value * Math.PI) / 180;
    sumSin += weights[i] * Math.sin(rad);
    sumCos += weights[i] * Math.cos(rad);
  });
  const value = ((Math.atan2(sumSin / totalWeight, sumCos / totalWeight) * 180) / Math.PI + 360) % 360;

  const terms = points.map((p, i) => ({
    value: p.value,
    distance: p.distance,
    weight: weights[i],
    weightNorm: weights[i] / totalWeight,
  }));

  return { value, terms };
}
