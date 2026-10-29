'use strict';
/**
 * Finer-grained acceptance (audit F8).
 *
 * v0.1 accepted a whole *category* per region, so signing off on "one colour
 * differs" also signed off every other colour, every gap, and every pixel on
 * that region. An entry may now narrow what it excuses:
 *
 *   props[]    — only these style declarations (e.g. ['color']) are excused;
 *   axis       — only this geometry axis ('x' | 'y') is excused;
 *   maxAbsPx   — the difference is excused only while |delta| stays inside a bound.
 *
 * Two failure modes are reported instead of silently becoming free passes:
 * a narrow entry that matches nothing (`covers-nothing`) and a bound that cannot
 * be evaluated because the difference is not numeric (`unevaluable`, which also
 * marks the whole report as ACCEPTANCE_INVALID at the CLI layer).
 */
const GEOMETRY_AXES = {
  position: { x: 'dx', y: 'dy' },
  size: { x: 'dw', y: 'dh' },
};

function withinBound(delta, maxAbsPx) {
  if (maxAbsPx == null) return { ok: true };
  if (typeof delta !== 'number' || !Number.isFinite(delta)) {
    return { ok: false, reason: 'the difference is not numeric, so no pixel bound can describe it' };
  }
  return Math.abs(delta) <= maxAbsPx + 1e-9
    ? { ok: true }
    : { ok: false, reason: `|${delta}| exceeds the accepted bound ${maxAbsPx}px` };
}

function resolveAcceptance(rec, accepted) {
  const excused = new Set();
  const acceptedStyles = new Set();
  const broken = [];
  let invalid = false;
  const styles = rec.styles || [];
  const list = accepted || [];

  for (const entry of list) {
    if (!entry.categories || !entry.categories.length) continue;
    const bounded = entry.props != null || entry.axis != null || entry.maxAbsPx != null;
    for (const cat of entry.categories) {
      if (!bounded) { excused.add(cat); continue; }

      const catStyles = styles.map((s, i) => ({ s, i })).filter(x => x.s.category === cat);
      if (catStyles.length) {
        const picked = entry.props ? catStyles.filter(x => entry.props.includes(x.s.prop)) : catStyles;
        const outside = entry.props ? catStyles.filter(x => !entry.props.includes(x.s.prop)) : [];
        if (!picked.length) {
          broken.push({ category: cat, kind: 'covers-nothing', props: entry.props || null,
            reason: 'the acceptance names properties that do not differ on this region' });
          continue;
        }
        let allOk = true;
        for (const x of picked) {
          const res = withinBound(x.s.delta, entry.maxAbsPx);
          if (res.ok) acceptedStyles.add(x.i);
          else {
            allOk = false;
            broken.push({ category: cat, prop: x.s.prop, axis: null, observed: x.s.delta,
              maxAbsPx: entry.maxAbsPx == null ? null : entry.maxAbsPx, kind: 'bound-exceeded', reason: res.reason });
          }
        }
        if (allOk && !outside.length) excused.add(cat);
        continue;
      }

      // `props` names style declarations; a geometry category has none, so an
      // entry that narrows geometry by prop covers nothing at all.
      if (entry.props) {
        broken.push({ category: cat, kind: 'covers-nothing', props: entry.props,
          reason: 'props[] narrows style declarations; this category has none on this region' });
        continue;
      }

      const axes = GEOMETRY_AXES[cat];
      if (axes) {
        const wanted = entry.axis ? [entry.axis] : ['x', 'y'];
        let allOk = true;
        for (const ax of wanted) {
          const delta = rec.geometry && rec.geometry[axes[ax]];
          const res = withinBound(delta, entry.maxAbsPx);
          if (!res.ok) {
            allOk = false;
            broken.push({ category: cat, axis: ax, observed: delta, maxAbsPx: entry.maxAbsPx == null ? null : entry.maxAbsPx,
              kind: 'bound-exceeded', reason: res.reason });
          }
        }
        if (allOk) excused.add(cat);
        continue;
      }

      // A bound on ink/pixel/text has no measurable operand here; accepting it
      // silently would turn a declaration error into a free pass.
      invalid = true;
      broken.push({ category: cat, kind: 'unevaluable', axis: null,
        reason: `maxAbsPx cannot be checked against a ${cat} difference` });
    }
  }
  return { excused, acceptedStyles, broken, invalid };
}

module.exports = { GEOMETRY_AXES, withinBound, resolveAcceptance };
