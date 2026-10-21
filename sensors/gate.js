// Rows and plots exist only once a source they need has delivered on this device.
// A row or plot declares the sources it needs (any one of them is enough); a part label
// (and anything listed with it) is shown only while its container, or any of its containers, holds something.
//
// A value that several event streams can carry (orientation from the absolute or the relative
// event) takes one source: `priorities` lists, per slot, the sources best first, and `accept`
// lets only the best source seen so far feed the slot, so streams are never mixed in one series.
export function createGate(parts, priorities = {}) {
  const seen = new Set();
  const best = {};
  const defs = [];
  const el = (id) => document.getElementById(id);

  function refresh() {
    parts.forEach((p) => {
      const shown = [].concat(p.box).some((id) => el(id).children.length > 0);
      [p.label].concat(p.also || []).forEach((id) => { el(id).hidden = !shown; });
    });
  }

  function sync() {
    defs.forEach((d) => {
      if (!d.made && d.needs.some((s) => seen.has(s))) {
        d.made = true;
        d.create();
      }
    });
    refresh();
  }

  return {
    define(needs, create) { defs.push({ needs, create, made: false }); sync(); },
    mark(source) { if (!seen.has(source)) { seen.add(source); sync(); } },
    refresh,
    accept(slot, source) {
      const i = priorities[slot].indexOf(source);
      if (best[slot] === undefined || i < best[slot]) best[slot] = i;
      return i === best[slot];
    },
  };
}
