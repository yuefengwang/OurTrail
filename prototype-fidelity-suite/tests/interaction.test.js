'use strict';
/**
 * Interaction checks: a PASS needs a real action AND its observed consequence.
 * Everything else is UNVERIFIED or BLOCKED — never silently green.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { check, eq, section, finish } = require('./harness');
const interaction = require('../core/lib/interaction');
const { PfError } = require('../core/lib/util');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-interaction-'));

/** The observation surface a driver hands back: functions, not raw data. */
function observedOf(view) {
  return {
    exists: s => (view.exists || []).includes(s),
    text: s => ((view.text || {})[s] === undefined ? null : view.text[s]),
    count: s => (view.count || {})[s] || 0,
    data: () => (view.data === undefined ? null : view.data),
  };
}

/** Minimal driver double: records calls, serves a mutable DOM-ish view. */
function fakeDriver(config) {
  const cfg = config || {};
  const view = cfg.view || {};
  const calls = [];
  return {
    kind: 'fake',
    calls,
    async open(page) { calls.push(['open', page]); return page; },
    async tap(spec) {
      calls.push(['tap', spec.selector, spec.index]);
      const found = view.exists && view.exists.includes(spec.selector);
      if (!found && cfg.strictTap) throw new PfError('DRIVER_TARGET', `tap target not found: ${spec.selector}`);
    },
    async input(spec, value) { calls.push(['input', spec.selector, value]); },
    async wait(ms) { calls.push(['wait', ms]); },
    async waitFor(spec) { calls.push(['waitFor', spec.selector]); return true; },
    async observe(selectors) {
      calls.push(['observe', selectors.length]);
      return observedOf(view);
    },
    async screenshot(file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    },
    async close() { calls.push(['close']); },
  };
}

async function main() {
  section('expectations are evaluated one by one');
  {
    const view = { exists: ['.a', '.b'], text: { '.a': '还没有常用地点' }, count: { '.row': 3 }, data: { homeTab: 'points' } };
    const r = interaction.evaluate(
      {
        exists: '.a',
        notExists: '.gone',
        textEquals: { selector: '.a', text: '还没有常用地点' },
        textIncludes: { selector: '.a', text: '常用地点' },
        dataEquals: { homeTab: 'points' },
        count: { selector: '.row', equals: 3 },
      },
      observedOf(view)
    );
    eq('one assertion per expectation', r.length, 6);
    check('every assertion carries its observed value', r.every(x => x.observed !== undefined));
    check('all pass', r.every(x => x.pass === true), JSON.stringify(r, null, 1));

    const missed = interaction.evaluate({ exists: '.missing' }, observedOf(view));
    eq('a missing element fails', missed[0].pass, false);
    eq('and says what it saw', missed[0].observed, false);
  }

  section('an unknown expectation is unsupported, not a pass');
  {
    const r = interaction.evaluate({ looksRight: '.a' }, observedOf({}));
    eq('no boolean verdict', r[0].pass, null);
    eq('named as unsupported', r[0].observed, 'unsupported');
  }

  section('status requires an observed consequence');
  eq('nothing asserted is UNVERIFIED', interaction.statusOf([]), 'UNVERIFIED');
  eq('all true is PASS', interaction.statusOf([{ pass: true }, { pass: true }]), 'PASS');
  eq('any false is FAIL', interaction.statusOf([{ pass: true }, { pass: false }]), 'FAIL');
  eq('unknown beats pass', interaction.statusOf([{ pass: true }, { pass: null }]), 'UNVERIFIED');
  eq('fail beats unknown', interaction.statusOf([{ pass: null }, { pass: false }]), 'FAIL');

  section('runChecks records what actually happened');
  {
    const outDir = path.join(tmp, 'run-ok');
    const driver = fakeDriver({
      view: { exists: ['.wh-quiet'], text: { '.wh-quiet': '还没有常用地点' }, data: { homeTab: 'points' } },
    });
    const records = await interaction.runChecks(driver, [{
      id: 'tab-points',
      title: 'switch to saved places',
      do: [{ tap: { selector: '.wh-tab', index: 1 } }, { wait: 400 }],
      expect: { exists: '.wh-quiet', textIncludes: { selector: '.wh-quiet', text: '常用地点' }, dataEquals: { homeTab: 'points' } },
      screenshot: true,
    }], { resetTo: '/pages/weather-hub/weather-hub', outDir });
    const rec = records[0];
    eq('status', rec.status, 'PASS');
    eq('the page was reset before the action', driver.calls[0], ['open', '/pages/weather-hub/weather-hub']);
    eq('the declared index reached the driver', driver.calls[1], ['tap', '.wh-tab', 1]);
    eq('the wait happened after the tap', driver.calls[2], ['wait', 400]);
    eq('the verification method is recorded', rec.verification, 'real-action-and-observation');
    check('duration is measured', typeof rec.durationMs === 'number' && rec.durationMs >= 0);
    check('the screenshot exists on disk', rec.screenshotPath && fs.existsSync(rec.screenshotPath), String(rec.screenshotPath));
    eq('observed lines summarise each assertion', rec.assertions.length, 3);

    const empty = await interaction.runChecks(driver, [{ id: 'no-expectation', do: [{ tap: { selector: '.wh-tab' } }] }], { outDir });
    eq('an action with no assertion is UNVERIFIED', empty[0].status, 'UNVERIFIED');
    eq('and it still recorded that the action ran', empty[0].verification, 'real-action-and-observation');
  }

  section('failures and unavailable drivers are distinguished');
  {
    const failDriver = fakeDriver({ view: { exists: [] } });
    const failed = await interaction.runChecks(failDriver, [{ id: 'bad', expect: { exists: '.nope' } }], { outDir: path.join(tmp, 'fail') });
    eq('a false assertion fails the check', failed[0].status, 'FAIL');
    eq('with the expectation attached', failed[0].expected.exists, '.nope');

    const thrower = fakeDriver({ strictTap: true });
    const thrown = await interaction.runChecks(thrower, [{ id: 'tap-missing', do: [{ tap: { selector: '.nope' } }], expect: { exists: '.a' } }], {});
    eq('a missing tap target is a check failure', thrown[0].status, 'FAIL');
    check('the driver message is kept', /not found/.test(thrown[0].error || ''), thrown[0].error);

    const blocked = {
      kind: 'none',
      async open() { throw new PfError('DRIVER_UNAVAILABLE', 'cannot connect'); },
    };
    const blockedRec = await interaction.runChecks(blocked, [{ id: 'blocked', expect: { exists: '.a' } }], { resetTo: '/pages/x' });
    eq('an unavailable driver is BLOCKED, never PASS', blockedRec[0].status, 'BLOCKED');
    eq('and the reason is preserved', blockedRec[0].error, 'cannot connect');
  }

  section('page data that cannot be read is UNVERIFIED');
  {
    const driver = fakeDriver({ view: { exists: ['.a'] } });
    const records = await interaction.runChecks(driver, [{ id: 'data', expect: { dataEquals: { homeTab: 'points' } } }], {});
    eq('no expectation is invented', records[0].assertions[0].pass, null);
    eq('so the check is UNVERIFIED', records[0].status, 'UNVERIFIED');
    eq('the reason is explicit', records[0].assertions[0].observed, 'page data unavailable');
  }

  section('a check can opt out of the reset');
  {
    const driver = fakeDriver({ view: { exists: ['.a'] } });
    await interaction.runChecks(driver, [{ id: 'no-reset', reset: false, expect: { exists: '.a' } }], { resetTo: '/pages/x' });
    eq('no open call was made', driver.calls.filter(c => c[0] === 'open').length, 0);
  }

  section('selectors are collected from actions and expectations');
  {
    const list = interaction.collectSelectors({
      do: [
        { tap: { selector: '.tab' } },
        { waitFor: '.panel' },
        { input: { selector: '.name' }, value: 'x' },
      ],
      expect: {
        exists: '.list',
        notExists: '.empty',
        textEquals: { selector: '.title', text: 't' },
        textIncludes: { selector: '.sub', text: 's' },
        count: { selector: '.row', equals: 2 },
      },
    });
    eq('deduplicated and complete', list.slice().sort(), ['.empty', '.list', '.name', '.panel', '.row', '.sub', '.tab', '.title']);
  }

  section('an unknown adapter is refused');
  {
    let code = null;
    try { await interaction.openDriver('flutter', {}, {}); } catch (e) { code = e.code; }
    eq('rejection code', code, 'DRIVER_UNKNOWN');
  }

  return finish('interaction.test');
}

main().then(code => process.exit(code), e => {
  console.error(e);
  process.exit(1);
});
