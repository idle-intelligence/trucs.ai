// sparkline.js — minimal canvas line charts, grayscale only (no libraries).

export function drawSparkline(canvas, values, { color = '#888' } = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const range = max - min || 1;
  const n = values.length;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  let started = false;
  values.forEach((v, i) => {
    const x = (i / (n - 1)) * w;
    if (!Number.isFinite(v)) {
      started = false;
      return;
    }
    const y = h - ((v - min) / range) * (h - 2) - 1;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
}

// Draws several stations' series on one canvas (light gray, own time axis each —
// not resampled to a shared clock), plus a marker for the IDW estimate at the
// right edge so the estimate's position relative to the spread is visible.
export function drawOverlaySparkline(canvas, seriesArray, estimate) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const all = seriesArray.flat().filter((v) => Number.isFinite(v));
  if (Number.isFinite(estimate)) all.push(estimate);
  if (all.length < 2) return;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;

  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 1;
  for (const series of seriesArray) {
    const n = series.length;
    if (n < 2) continue;
    ctx.beginPath();
    let started = false;
    series.forEach((v, i) => {
      const x = (i / (n - 1)) * (w - 8);
      if (!Number.isFinite(v)) {
        started = false;
        return;
      }
      const y = h - ((v - min) / range) * (h - 2) - 1;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }

  if (Number.isFinite(estimate)) {
    const y = h - ((estimate - min) / range) * (h - 2) - 1;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w - 8, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w - 2, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
  }
}
