'use strict';
/**
 * Self-contained HTML report. No external CSS/JS/fonts: the file must open from
 * disk, offline, years later, with the images baked in as data URIs.
 */
const fs = require('fs');
const path = require('path');
const { escapeHtml } = require('./html');
const { sha256File, ensureDir, round } = require('./util');

const STATUS_COLORS = {
  PASS: '#1a7f37',
  FAIL: '#cf222e',
  UNVERIFIED: '#9a6700',
  BLOCKED: '#6e7781',
  NOT_APPLICABLE: '#6e7781',
};

function badge(status) {
  const c = STATUS_COLORS[status] || '#6e7781';
  return `<span class="badge" style="color:${c};border-color:${c}">${escapeHtml(status)}</span>`;
}

function imgTag(src, alt, cls) {
  if (!src) return `<div class="missing ${cls || ''}">no image</div>`;
  if (/^data:/.test(src)) return `<img class="${cls || ''}" src="${src}" alt="${escapeHtml(alt)}">`;
  if (!fs.existsSync(src)) return `<div class="missing ${cls || ''}">missing: ${escapeHtml(path.basename(src))}</div>`;
  const ext = path.extname(src).slice(1).toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
  const b64 = fs.readFileSync(src).toString('base64');
  return `<img class="${cls || ''}" src="data:${mime};base64,${b64}" alt="${escapeHtml(alt)}">`;
}

function fmtDelta(v, unit) {
  if (v == null || Number.isNaN(v)) return '—';
  const n = round(v, 2);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n}${unit || ''}`;
}

function provenanceRow(label, p) {
  if (!p) return '';
  const parts = [
    p.platform && `platform <code>${escapeHtml(p.platform)}</code>`,
    p.url && `url <code>${escapeHtml(p.url)}</code>`,
    p.viewport && `viewport <code>${p.viewport.width}×${p.viewport.height}</code>`,
    p.dpr != null && `dpr <code>${p.dpr}</code>`,
    p.codeVersion && `code <code>${escapeHtml(String(p.codeVersion).slice(0, 12))}</code>`,
    p.dataSource && `data <code>${escapeHtml(p.dataSource)}</code>`,
    p.capturedAt && `captured <code>${escapeHtml(p.capturedAt)}</code>`,
    p.screenshotSha256 && `sha256 <code>${escapeHtml(p.screenshotSha256.slice(0, 16))}…</code>`,
    p.screenshotScale && `screenshot scale <code>${p.screenshotScale.x}×${p.screenshotScale.y}</code>`,
    p.note && escapeHtml(p.note),
  ].filter(Boolean);
  return `<tr><th>${escapeHtml(label)}</th><td>${parts.join(' · ') || '—'}</td></tr>`;
}

function coverageLabel(cov) {
  if (cov == null) return '—';
  if (typeof cov === 'number') return `${Math.round(cov * 100)}%`;
  const parts = [];
  if (cov.pairsDeclared != null) parts.push(`${cov.pairsMeasured == null ? '?' : cov.pairsMeasured}/${cov.pairsDeclared} pairs measured`);
  if (cov.pairsUnverified) parts.push(`${cov.pairsUnverified} unverified`);
  if (cov.notApplicable) parts.push(`${cov.notApplicable} not applicable`);
  if (cov.pixelsCompared != null) parts.push(`${cov.pixelsCompared} pixel regions`);
  return parts.join(' · ') || '—';
}

function scorecardTable(sc) {
  if (!sc) return '<p class="muted">No scorecard in this run.</p>';
  const rows = Object.entries(sc.dimensions || {}).map(([name, d]) => {
    const checks = d.checks || {};
    return `<tr>
      <td>${escapeHtml(name)}</td>
      <td>${badge(d.verdict)}</td>
      <td class="num">${checks.pass || 0}</td>
      <td class="num">${checks.fail || 0}</td>
      <td class="num">${checks.unverified || 0}</td>
      <td>${escapeHtml(d.summary || '')}</td>
    </tr>`;
  }).join('');
  const critical = Array.isArray(sc.criticalFailures) ? sc.criticalFailures : [];
  const nonCritical = Array.isArray(sc.nonCriticalFailures) ? sc.nonCriticalFailures : [];
  const names = list => list.map(f => f && (f.pairId || f.role || f.id || '?')).join(', ');
  return `<table class="grid">
    <thead><tr><th>Dimension</th><th>Verdict</th><th class="num">Pass</th><th class="num">Fail</th><th class="num">Unverified</th><th>Notes</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="muted">Critical failures: <b>${critical.length}</b>${critical.length ? ' — ' + escapeHtml(names(critical)) : ''} · non-critical failures: <b>${nonCritical.length}</b>${nonCritical.length ? ' — ' + escapeHtml(names(nonCritical)) : ''} · coverage <b>${escapeHtml(coverageLabel(sc.coverage))}</b></p>`;
}

function styleRows(record) {
  const fails = (record.styles || []).filter(s => s.status === 'FAIL');
  if (!fails.length) return '<p class="muted">No style declaration differences above tolerance.</p>';
  return `<table class="grid tight">
    <thead><tr><th>Property</th><th>Category</th><th>Prototype</th><th>Target</th><th class="num">Δ</th></tr></thead>
    <tbody>${fails.map(s => `<tr>
      <td><code>${escapeHtml(s.prop)}</code></td><td>${escapeHtml(s.category || '')}</td>
      <td><code>${escapeHtml(stringify(s.a))}</code></td><td><code>${escapeHtml(stringify(s.b))}</code></td>
      <td class="num">${fmtDelta(s.delta)}</td></tr>`).join('')}</tbody>
  </table>`;
}

function stringify(v) {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.join(' ');
  return String(v);
}

function regionCard(r) {
  const g = r.geometry || {};
  const px = r.pixel || {};
  const open = r.status === 'FAIL' ? ' open' : '';
  return `<details class="region"${open}>
    <summary>
      ${badge(r.status)}
      <span class="role">${escapeHtml(r.role || r.id)}</span>
      <span class="muted">${escapeHtml(r.id)}</span>
      <span class="facts">Δx ${fmtDelta(g.dx, 'px')} · Δy ${fmtDelta(g.dy, 'px')} · Δw ${fmtDelta(g.dw, 'px')} · Δh ${fmtDelta(g.dh, 'px')}${px.diffRatio != null ? ` · pixel ${round(px.diffRatio * 100, 2)}%` : ''}</span>
    </summary>
    <div class="shots">
      <figure><figcaption>prototype</figcaption>${imgTag(r.images && r.images.prototype, 'prototype crop of ' + r.id)}</figure>
      <figure><figcaption>target</figcaption>${imgTag(r.images && r.images.target, 'target crop of ' + r.id)}</figure>
      <figure><figcaption>diff</figcaption>${imgTag(r.images && r.images.diff, 'diff of ' + r.id)}</figure>
    </div>
    <div class="detail">
      <p>${escapeHtml(detailLine(r))}</p>
      ${styleRows(r)}
      ${textRow(r)}
      ${r.evidence ? `<p class="muted">Selectors: <code>${escapeHtml(String(r.evidence.prototypeSelector || r.evidence.prototypePath || '—'))}</code> → <code>${escapeHtml(String(r.evidence.targetSelector || r.evidence.targetPath || '—'))}</code></p>` : ''}
    </div>
  </details>`;
}

function detailLine(r) {
  const cats = (r.categories || []).filter(Boolean);
  const parts = [];
  if (cats.length) parts.push('categories: ' + [...new Set(cats)].join(', '));
  if (r.notes) parts.push(r.notes);
  if (r.pixel && r.pixel.diffCount != null) parts.push(`${r.pixel.diffCount} pixels differ (${r.pixel.aaCount || 0} anti-aliased)`);
  if (r.pixel && r.pixel.masked && r.pixel.masked.pixels) {
    parts.push(`${(r.pixel.masked.ratio * 100).toFixed(1)} % of the crop masked over declared child regions (${(r.pixel.maskedBy || []).join(', ')})`);
  }
  if (r.pixel && r.pixel.judged === false) {
    parts.push('content channels not judged: declared dynamic text');
  }
  if (r.pixel && r.pixel.status === 'UNVERIFIED' && r.pixel.unmeasured) {
    parts.push('pixel not measured: ' + r.pixel.unmeasured);
  }
  return parts.join(' · ') || 'no differences recorded';
}

/**
 * Text is compared only on leaves (containers carry their own empty string on
 * the web side and concatenated child text on the mini program side, so a
 * container "mismatch" is a capture artefact, not a defect). A pair declared
 * `dynamicText` is never judged character-by-character; it is shown but
 * labelled so nobody reads the observation as a verdict.
 */
function textRow(r) {
  const t = r.text;
  if (!t || t.judged === false || t.comparable === false) return '';
  const differs = t.equal === false || (t.volatile && t.prototype !== t.target);
  if (!differs && !t.volatile) return '';
  const lines = t.lines && t.lines.prototype != null && t.lines.target != null
    ? ` · lines ${t.lines.prototype} vs ${t.lines.target}`
    : '';
  const label = t.volatile || r.dynamicText
    ? 'Text (declared dynamic — not compared character-by-character; presence still required)'
    : 'Text';
  return `<p class="muted">${escapeHtml(label)}: prototype <q>${escapeHtml(t.prototype == null ? '' : t.prototype)}</q> vs target <q>${escapeHtml(t.target == null ? '' : t.target)}</q>${escapeHtml(lines)}</p>`;
}

function interactionsTable(it) {
  const checks = (it && it.checks) || [];
  if (!checks.length) return '<p class="muted">No interaction checks recorded.</p>';
  return `<table class="grid">
    <thead><tr><th>Check</th><th>Status</th><th>Expected</th><th>Observed</th><th>Evidence</th></tr></thead>
    <tbody>${checks.map(c => `<tr>
      <td>${escapeHtml(c.id || '')} ${escapeHtml(c.title || '')}</td>
      <td>${badge(c.status)}</td>
      <td>${escapeHtml(stringify(c.expected))}</td>
      <td>${escapeHtml(stringify(c.observed))}</td>
      <td class="muted">${escapeHtml(stringify(c.evidence))}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function renderReport(manifest) {
  const m = manifest || {};
  const regions = m.regions || [];
  const failing = regions.filter(r => r.status === 'FAIL');
  const warnings = m.warnings || [];
  const accepted = m.acceptedDifferences || [];
  const title = m.title || 'Prototype fidelity report';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — ${escapeHtml(m.verdict || 'UNVERIFIED')}</title>
<style>
:root{--fg:#1f2328;--muted:#6e7781;--line:#d0d7de;--bg:#fff;--soft:#f6f8fa}
*{box-sizing:border-box}
body{margin:0;padding:24px;font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg)}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
code{font:12px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--soft);padding:1px 4px;border-radius:4px}
.badge{display:inline-block;padding:1px 7px;border:1px solid;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:.02em}
.verdict{display:inline-block;margin-left:8px;font-size:14px;vertical-align:4px}
table{border-collapse:collapse;width:100%;margin:8px 0}
.grid th,.grid td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.grid th{background:var(--soft);font-weight:600}
.grid.tight td,.grid.tight th{padding:4px 6px}
.num{text-align:right;font-variant-numeric:tabular-nums}
.muted{color:var(--muted)}
.provenance th{width:120px}
.region{border:1px solid var(--line);border-radius:6px;margin:10px 0;overflow:hidden}
.region>summary{cursor:pointer;padding:8px 10px;background:var(--soft);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.region .role{font-weight:600}
.region .facts{color:var(--muted);font-variant-numeric:tabular-nums}
.shots{display:flex;gap:12px;padding:12px;overflow:auto}
.shots figure{margin:0;flex:1 1 0;min-width:160px}
.shots figcaption{font-size:11px;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em}
.shots img{width:100%;height:auto;border:1px solid var(--line);border-radius:4px;image-rendering:pixelated;background:#fff}
.missing{padding:24px 8px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:4px}
.detail{padding:0 12px 12px}
.warn{background:#fff8c5;border:1px solid #d4a72c;border-radius:6px;padding:8px 12px;margin:8px 0}
.blocked{background:#eaeef2;border:1px solid var(--line);border-radius:6px;padding:8px 12px;margin:8px 0}
footer{margin-top:32px;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:11px}
</style></head><body>
<h1>${escapeHtml(title)}<span class="verdict">${badge(m.verdict || 'UNVERIFIED')}</span></h1>
<p class="muted">run <code>${escapeHtml(m.runId || 'unknown')}</code> · generated <code>${escapeHtml(m.generatedAt || '')}</code>${m.scope ? ` · ${escapeHtml(m.scope)}` : ''}</p>

${warnings.length ? `<h2>Warnings and scope limits</h2>${warnings.map(w => `<div class="warn">${escapeHtml(w)}</div>`).join('')}` : ''}
${m.blocked ? `<div class="blocked"><b>BLOCKED:</b> ${escapeHtml(m.blocked)}</div>` : ''}

<h2>Scorecard</h2>
${scorecardTable(m.scorecard)}

<h2>Provenance</h2>
<table class="grid provenance">
${provenanceRow('prototype', m.provenance && m.provenance.prototype)}
${provenanceRow('target', m.provenance && m.provenance.target)}
${provenanceRow('mapping', m.provenance && m.provenance.mapping)}
</table>

<h2>Regions (${regions.length}) — ${failing.length} failing</h2>
${regions.length ? regions.map(regionCard).join('') : '<p class="muted">No regions were compared.</p>'}

${accepted.length ? `<h2>Accepted differences</h2><table class="grid">
  <thead><tr><th>Id</th><th>Reason</th><th>Status</th></tr></thead>
  <tbody>${accepted.map(a => `<tr><td><code>${escapeHtml(a.id)}</code></td><td>${escapeHtml(a.reason || '')}</td><td>${badge(a.status || 'NOT_APPLICABLE')}</td></tr>`).join('')}</tbody>
</table>` : ''}

<h2>Interaction checks</h2>
${interactionsTable(m.interactions)}

<footer>
${(m.artifacts || []).map(a => `${escapeHtml(a.path)}${a.sha256 ? ` · sha256 <code>${escapeHtml(a.sha256.slice(0, 16))}…</code>` : ''}`).join('<br>') || 'no artifact list'}
<br>Statuses: PASS · FAIL · UNVERIFIED · BLOCKED · NOT_APPLICABLE. Missing evidence is never reported as PASS.
</footer>
</body></html>`;
}

function writeReport(file, manifest) {
  ensureDir(path.dirname(file));
  const html = renderReport(manifest);
  fs.writeFileSync(file, html, 'utf8');
  return { file, sha256: sha256File(file), bytes: Buffer.byteLength(html, 'utf8') };
}

module.exports = { renderReport, writeReport, badge, imgTag };
