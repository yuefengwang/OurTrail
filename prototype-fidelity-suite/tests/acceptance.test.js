'use strict';
/**
 * F8 — finer-grained acceptance.
 *
 * v0.1 accepted a whole category per region: signing off "this colour differs"
 * also signed off every other colour, every gap and every pixel there. These
 * assertions pin the narrowing that replaced it — and, just as important, that a
 * narrowing which matches nothing or cannot be evaluated is *reported*, not
 * silently treated as unlimited.
 */
const { resolveAcceptance, withinBound } = require('../core/lib/acceptance');
const { check, eq, section, finish } = require('./harness');

const rec = () => ({
  geometry: { dx: 1, dy: 5, dw: 0.5, dh: 0 },
  styles: [
    { category: 'typography', prop: 'color', delta: 3 },
    { category: 'typography', prop: 'font-size', delta: 2 },
    { category: 'appearance', prop: 'background-color', delta: 9 },
  ],
});

section('unbounded entries keep the v0.1 meaning');
{
  const res = resolveAcceptance(rec(), [{ categories: ['typography'] }]);
  check('the whole category is excused', res.excused.has('typography'));
  eq('no style record was singled out', res.acceptedStyles.size, 0);
  eq('nothing broken', res.broken, []);
  check('not invalid', res.invalid === false);
  eq('an entry with no categories excuses nothing', resolveAcceptance(rec(), [{ props: ['color'] }]).excused.size, 0);
}

section('props[] narrows which declarations are excused');
{
  const res = resolveAcceptance(rec(), [{ categories: ['typography'], props: ['color'] }]);
  check('the category is NOT excused while another prop still differs', !res.excused.has('typography'));
  check('only the named declaration is excused', res.acceptedStyles.has(0));
  check('…and the other declaration is not', !res.acceptedStyles.has(1));
  eq('a narrowed entry that covers every differing prop does excuse the category',
    Array.from(resolveAcceptance(rec(), [{ categories: ['typography'], props: ['color', 'font-size'] }]).excused), ['typography']);
  eq('a prop that does not differ on this region covers nothing',
    resolveAcceptance(rec(), [{ categories: ['typography'], props: ['letter-spacing'] }]).broken.map(b => b.kind), ['covers-nothing']);
  eq('props[] on a geometry category has no declaration to cover',
    resolveAcceptance(rec(), [{ categories: ['position'], props: ['color'] }]).broken.map(b => b.kind), ['covers-nothing']);
}

section('maxAbsPx bounds how far a difference may go');
{
  const loose = resolveAcceptance(rec(), [{ categories: ['position'], maxAbsPx: 6 }]);
  check('both axes inside the bound → category excused', loose.excused.has('position'));
  const tight = resolveAcceptance(rec(), [{ categories: ['position'], maxAbsPx: 2 }]);
  check('one axis outside the bound → not excused', !tight.excused.has('position'));
  eq('…and the offending axis is named', tight.broken.map(b => `${b.kind}:${b.axis}`), ['bound-exceeded:y']);
  eq('the observed value is reported', tight.broken[0].observed, 5);
  eq('the bound is reported', tight.broken[0].maxAbsPx, 2);
  eq('exactly at the bound is inside it (|delta| <= maxAbsPx)',
    resolveAcceptance(rec(), [{ categories: ['position'], axis: 'y', maxAbsPx: 5 }]).excused.has('position'), true);
  eq('size uses its own axes (dw/dh, never dx/dy)',
    resolveAcceptance(rec(), [{ categories: ['size'], axis: 'x', maxAbsPx: 0.2 }]).excused.has('size'), false);
  eq('…and a bound the size does satisfy is excused on that axis',
    resolveAcceptance(rec(), [{ categories: ['size'], axis: 'y', maxAbsPx: 0 }]).excused.has('size'), true);
}

section('axis narrows without changing the rest');
{
  const res = resolveAcceptance(rec(), [{ categories: ['position'], axis: 'x' }]);
  check('only the named axis is considered → excused', res.excused.has('position'));
  const noAxes = resolveAcceptance({ geometry: { dx: 1 } }, [{ categories: ['position'] }]);
  check('an axis with no measured value keeps the v0.1 unconditional excuse', noAxes.excused.has('position'));
  const boundedNoValue = resolveAcceptance({ geometry: { dx: 1 } }, [{ categories: ['position'], axis: 'y', maxAbsPx: 2 }]);
  check('a bound with no measured value is reported, not excused', !boundedNoValue.excused.has('position'));
  eq('…as a bound that could not be evaluated', boundedNoValue.broken.map(b => b.kind), ['bound-exceeded']);
  check('…and the reason says it is not numeric', /not numeric/.test(boundedNoValue.broken[0].reason), boundedNoValue.broken[0].reason);
}

section('an unevaluable bound is a declaration error, not a free pass');
{
  const res = resolveAcceptance(rec(), [{ categories: ['color'], maxAbsPx: 4 }]);
  check('the report is marked invalid', res.invalid === true);
  eq('one broken entry, kind unevaluable', res.broken.map(b => b.kind), ['unevaluable']);
  check('the category is not excused', !res.excused.has('color'));
  check('the message names the category', /color/.test(res.broken[0].reason), res.broken[0].reason);
}

section('withinBound is the single operand checker');
{
  eq('null bound → ok', withinBound(7, null).ok, true);
  eq('undefined bound → ok', withinBound(7, undefined).ok, true);
  eq('NaN delta → not ok', withinBound(NaN, 1).ok, false);
  eq('missing delta → not ok', withinBound(undefined, 1).ok, false);
  eq('string delta → not ok (a label is not a measurement)', withinBound('5', 1).ok, false);
  eq('negative delta uses magnitude', withinBound(-3, 3).ok, true);
  eq('negative delta beyond the bound fails', withinBound(-4, 3).ok, false);
}

section('narrow entries do not leak into other entries');
{
  const res = resolveAcceptance(rec(), [
    { categories: ['typography'], props: ['color'] },
    { categories: ['appearance'], maxAbsPx: 10 },
  ]);
  check('the narrowed typography entry still does not excuse font-size', !res.excused.has('typography'));
  check('the separate bounded appearance entry works on its own', res.excused.has('appearance'));
}

process.exit(finish('acceptance.test'));
