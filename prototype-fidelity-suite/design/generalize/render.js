'use strict';
/**
 * Render a design plan into the three artifacts a reviewer can actually work
 * with: a runnable HTML page, a design spec in Markdown, and the decision list.
 *
 * The one rule that shapes the output: **every element says where its form came
 * from.** A node either carries `data-grounding="rule:<id>"` (a rule in the
 * store allowed it) or `data-grounding="unmeasured"` (the store has no evidence
 * for this role on this page). There is no third state and no default, so a
 * reviewer can count the unmeasured nodes instead of trusting a summary.
 *
 * Layout numbers are deliberately relative (em / %). The store has measured type
 * sizes, radii, borders and tap targets, but no spacing scale at all — writing
 * `padding: 16px` here would be inventing a scale and then presenting it as
 * measured.
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function cssVarName(prop, value) {
  const slug = String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const prefix = prop === 'font-size' ? 'fs' : prop === 'font-weight' ? 'fw' : prop === 'border-radius' ? 'radius' : prop.replace(/[^a-z]+/g, '-');
  return `--${prefix}-${slug}`;
}

function tokenCss(plan) {
  const lines = [];
  for (const v of plan.tokens.variables) {
    // A variable whose rule lists several values is not a token, it is a
    // disagreement; the first value is used and the rest stay visible in the plan.
    const value = String(v.value).split(' | ')[0];
    lines.push(`  ${v.name}: ${value}; /* ${v.ruleId} */`);
  }
  for (const s of plan.tokens.scale) {
    lines.push(`  ${cssVarName(s.prop, s.value)}: ${s.value}; /* ${s.ruleId} */`);
  }
  return lines.join('\n');
}

function scaleDeclarations(plan) {
  const sizes = plan.tokens.scale.filter(s => s.prop === 'font-size').map(s => s.value);
  const weights = plan.tokens.scale.filter(s => s.prop === 'font-weight').map(s => s.value);
  const radii = plan.tokens.scale.filter(s => s.prop === 'border-radius').map(s => s.value);
  const out = [];
  if (sizes.length) out.push(`  --dna-type-scale: ${sizes.join(', ')}; /* 既有字号阶，未新增 */`);
  if (weights.length) out.push(`  --dna-weights: ${weights.join(', ')};`);
  if (radii.length) out.push(`  --dna-radii: ${radii.join(', ')};`);
  return out.join('\n');
}

function principleValue(plan, id, pattern) {
  const p = plan.principles.find(x => x.id === id);
  if (!p) return null;
  const m = pattern.exec(p.statement);
  return m ? m[1] : null;
}

function cssContext(plan) {
  const vars = new Map();
  for (const v of plan.tokens.variables) vars.set(v.name, String(v.value).split(' | ')[0]);
  for (const s of plan.tokens.scale) vars.set(cssVarName(s.prop, s.value), s.value);
  return vars;
}

function style(plan) {
  const tap = principleValue(plan, 'principle.tap-target', /中位数\s*(\d+)px/) || null;
  const hair = principleValue(plan, 'principle.hairline-separation', /(\d+)px/) || '1';
  const has = id => plan.principles.some(p => p.id === id);
  const vars = cssContext(plan);
  // Only a measured token may become a colour. A fallback like `var(--line, #ddd)`
  // is the same invention as writing `#ddd` outright, just hidden where nobody
  // looks; when the store has no token the declaration is dropped and the
  // element inherits instead.
  const v = name => (vars.has(name) ? `var(${name})` : null);
  const blocks = [];
  const rule = (selector, decls) => {
    const body = decls.filter(([, value]) => value != null).map(([prop, value]) => `  ${prop}: ${value};`);
    if (body.length) blocks.push(`${selector} {\n${body.join('\n')}\n}`);
  };
  const border = v('--line') ? `var(--dna-hairline) solid ${v('--line')}` : null;

  rule('*', [['box-sizing', 'border-box']]);
  rule('body', [
    ['margin', '0'],
    ['font-family', 'system-ui, -apple-system, "PingFang SC", sans-serif'],
    ['font-size', v('--fs-16px') || '1rem'],
    ['line-height', '1.5'],
    ['color', v('--ink')],
    ['background', v('--pale')],
  ]);
  rule('.page', [['max-width', '640px'], ['margin', '0 auto'], ['min-height', '100vh'], ['background', v('--pale')]]);
  rule('.section', [['padding', '0 1.25em']]);
  if (has('principle.hairline-separation') && border) {
    blocks.push(`.section + .section { border-top: ${border}; } /* principle.hairline-separation */`);
  }
  rule('.section[data-surface="header"]', [['padding-top', '1em']]);
  rule('.section[data-surface="footer"]', [['padding-bottom', '2em'], ['color', v('--muted')]]);
  rule('.dna-text', [['margin', '.75em 0'], ['font-size', v('--fs-17px')], ['font-weight', '600']]);
  rule('.dna-list', [['list-style', 'none'], ['margin', '.5em 0'], ['padding', '0']]);
  rule('.dna-list > li', [
    ['display', 'flex'], ['flex-direction', 'column'], ['gap', '.15em'], ['padding', '.75em 0'],
    ['border-bottom', border],
  ]);
  rule('.dna-list > li:last-child', [['border-bottom', '0']]);
  rule('.dna-list-title', [['font-size', v('--fs-16px')], ['color', v('--ink')]]);
  rule('.dna-list-meta', [['font-size', v('--fs-13px')], ['color', v('--muted')]]);
  rule('button, .dna-button', [
    ['min-height', tap ? `${tap}px` : '2.75em'],
    ['min-width', tap ? `${tap}px` : '2.75em'],
    ['border', '0'],
    ['border-radius', v('--radius-18px')],
    ['background', v('--green')],
    ['color', v('--pale')],
    ['font', 'inherit'],
    ['font-size', v('--fs-16px')],
    ['font-weight', '600'],
    ['padding', '0 1.25em'],
    ['cursor', 'pointer'],
  ]);
  rule('button:disabled', [['background', v('--muted')], ['cursor', 'not-allowed']]);
  rule('button > span', [['display', 'inline-block']]);
  rule('.dna-field', [['display', 'block'], ['margin', '.75em 0']]);
  rule('.dna-field input', [
    ['width', '100%'],
    ['min-height', tap ? `${tap}px` : '2.75em'],
    ['font-size', `max(14px, ${v('--fs-16px') || '1rem'})`],
    ['padding', '0 .75em'],
    ['border', border],
    ['border-radius', v('--radius-9px')],
    ['background', v('--pale')],
    ['color', v('--ink')],
  ]);
  rule('.dna-nav', [['display', 'flex'], ['gap', '.5em']]);
  rule('.overlay[hidden]', [['display', 'none']]);
  rule('.overlay', [
    ['position', 'fixed'], ['inset', '0'], ['background', v('--pale')],
    ['display', 'flex'], ['align-items', 'flex-end'],
  ]);
  rule('.overlay > [role="dialog"]', [
    ['width', '100%'],
    ['background', v('--pale')],
    ['border-radius', v('--radius-18px') ? `${v('--radius-18px')} ${v('--radius-18px')} 0 0` : null],
    ['padding', '1.25em'],
  ]);
  rule('.grounding-unmeasured', [['outline', v('--muted') ? `1px dashed ${v('--muted')}` : null]]);

  return `:root {
${tokenCss(plan)}
${scaleDeclarations(plan)}
  --dna-tap-target: ${tap ? tap + 'px' : 'unmeasured'};
  --dna-hairline: ${hair}px;
}

${blocks.join('\n')}
`;
}

function nodeAttrs(entry, grounding) {
  return [
    `data-function="${esc(entry.id)}"`,
    `data-kind="${esc(entry.kind)}"`,
    `data-role="${esc(entry.role)}"`,
    `data-state="${esc(renderedState(entry))}"`,
    `data-states="${esc(entry.states.join(' '))}"`,
    `data-grounding="${grounding}"`,
  ].join(' ');
}

// What the prototype actually shows. `states` is the set the function must
// support, not a variant to render; showing `loading` with filled content would
// make the page lie about which state the reviewer is looking at.
function renderedState(entry) {
  if (entry.states.includes('default')) return 'default';
  if (entry.states.includes('filled')) return 'filled';
  return entry.states[0];
}

function groundingOf(component) {
  return component && component.resolved ? `rule:${component.ruleId}` : 'unmeasured';
}

function renderFunction(entry, plan) {
  const attrs = nodeAttrs(entry, groundingOf(entry.component));
  const unmeasured = entry.component && entry.component.resolved ? '' : ' grounding-unmeasured';
  const label = esc(entry.label);
  switch (entry.kind) {
    case 'action': {
      // A function that declares a `confirming` state is the one the confirm
      // contract belongs to; wiring it is the difference between a mockup and a
      // prototype a reviewer can actually operate.
      const opens = entry.states.includes('confirming') && plan.interactions.some(i => i.name === 'confirm-dialog' && i.resolved);
      return `        <div class="section-actions">\n          <button type="button"${opens ? ' data-action="open-dialog"' : ''} ${attrs}><span>${label}</span></button>\n        </div>`;
    }
    case 'input':
      return `        <label class="dna-field${unmeasured}" ${attrs}><span>${label}</span><input type="text" placeholder="${label}" /></label>`;
    case 'navigation':
      return `        <nav class="dna-nav" ${attrs}><button type="button" role="tab" aria-selected="true"><span>${label}</span></button></nav>`;
    case 'list':
      return `        <ul class="dna-list${unmeasured}" ${attrs}>\n          <li><span class="dna-list-title">${label}（示例）</span><span class="dna-list-meta">该行形态未取证：库里没有本页可用的行组件，这是占位结构</span></li>\n        </ul>`;
    case 'feedback':
      return `        <p class="dna-text${unmeasured}" role="status" aria-live="polite" ${attrs}>${label}</p>`;
    default:
      return `        <p class="dna-text${unmeasured}" ${attrs}>${label}</p>`;
  }
}

function renderSection(section, plan) {
  const fns = section.functions.map(f => renderFunction(f, plan)).join('\n');
  return `    <section class="section" data-section="${esc(section.id)}" data-surface="${esc(section.surface)}" aria-label="${esc(section.role)}">
      <h2 class="dna-text" data-grounding="brief">${esc(section.role)}</h2>
${fns}
    </section>`;
}

function renderOverlays(plan) {
  const dialog = plan.interactions.find(i => i.name === 'confirm-dialog' && i.resolved);
  const blocks = [];
  if (dialog) {
    blocks.push(`  <div class="overlay" id="dna-confirm" hidden data-grounding="rule:${esc(dialog.ruleId)}">
    <div role="dialog" aria-modal="true" tabindex="-1" aria-label="确认">
      <p class="dna-text">确认要执行这一步吗？</p>
      <button type="button" data-action="close-dialog"><span>取消</span></button>
      <button type="button" data-action="close-dialog"><span>确认</span></button>
    </div>
  </div>`);
  }
  return blocks.join('\n');
}

function renderScript(plan) {
  if (!plan.interactions.some(i => i.name === 'confirm-dialog' && i.resolved)) return '';
  return `  <script>
    // 浮层的显隐由 overlay 的 hidden 控制：关闭态必须同时不可见、不命中点击。
    (function () {
      var overlay = document.getElementById('dna-confirm');
      if (!overlay) return;
      document.addEventListener('click', function (ev) {
        var el = ev.target.closest('[data-action]');
        if (!el) return;
        var action = el.getAttribute('data-action');
        if (action === 'open-dialog') overlay.hidden = false;
        if (action === 'close-dialog') overlay.hidden = true;
      });
    })();
  </script>`;
}

function renderHtml(plan) {
  const body = plan.sections.map(s => renderSection(s, plan)).join('\n');
  const overlays = renderOverlays(plan);
  const script = renderScript(plan);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(plan.title)}</title>
<!-- 由 design-dna-generalizer 生成；每个节点的 data-grounding 指向知识库里的规则 id，
     或标注为 unmeasured。plan.id=${esc(plan.id)} · store revision=${plan.basis.storeRevision} -->
<style>
${style(plan)}
</style>
</head>
<body>
  <main class="page" data-plan="${esc(plan.id)}" data-store-revision="${plan.basis.storeRevision}">
${body}
  </main>
${overlays}
${script}
</body>
</html>
`;
}

function ruleLine(plan, id) {
  const d = plan.decisions.find(x => x.id === id);
  if (!d) return '';
  const refs = d.ruleRefs.filter(Boolean);
  return `- **${d.id}** ${d.statement}${refs.length ? `（${refs.map(r => '`' + r + '`').join('、')}）` : ''}`;
}

function renderMarkdown(plan) {
  const s = plan.coverage;
  const lines = [];
  lines.push(`# ${plan.title} · 设计规格`);
  lines.push('');
  lines.push(`由 \`design-dna-generalizer\` 从知识库 \`${plan.basis.storeId || '-'}\`（revision ${plan.basis.storeRevision}）生成。`);
  lines.push(`本页家族：${plan.family ? '`' + plan.family + '`（族级规则标注为 borrowed）' : '未声明（只允许全局规则）'}。`);
  lines.push('');
  lines.push(`功能 ${s.functions} 项：已取证选型 ${s.resolved}、未取证 ${s.unresolved}；交互契约 ${s.interactionsResolved}/${s.interactionsRequested}。`);
  lines.push('');
  lines.push('## 1. 信息架构');
  lines.push('');
  lines.push('| 序 | 区块 | 表面 | 承载功能 |');
  lines.push('|---|---|---|---|');
  for (const sec of plan.sections) {
    lines.push(`| ${sec.layout.order} | ${sec.role} | ${sec.surface} | ${sec.functions.map(f => f.label).join('、')} |`);
  }
  lines.push('');
  lines.push('顺序取自业务给出的 `sections`，不取自任何原型屏。');
  lines.push('');
  lines.push('## 2. 组件选择');
  lines.push('');
  lines.push('| 功能 | 角色 | 形态 | 出处 | 依据 |');
  lines.push('|---|---|---|---|---|');
  for (const sec of plan.sections) {
    for (const f of sec.functions) {
      const c = f.component || {};
      lines.push(`| ${f.label} | ${f.role} | ${c.resolved ? '`' + c.signature + '`' : '**未选型**'} | ${c.resolved ? '`' + c.ruleId + '`' : '—'} | ${c.resolved ? c.basis : '全库没有可用于本页的该角色形态'} |`);
    }
  }
  lines.push('');
  lines.push('## 3. 布局规划');
  lines.push('');
  for (const sec of plan.sections) lines.push(`- \`${sec.id}\`：${sec.surface} 面，纵向堆叠，第 ${sec.layout.order} 位`);
  lines.push('');
  lines.push('绝对间距没有测量证据（知识库里没有间距阶），因此原型只用相对单位；间距留给实现按 token 补，不在此处编造数值。');
  lines.push('');
  lines.push('## 4. 交互设计');
  lines.push('');
  if (!plan.interactions.length) lines.push('- 业务没有声明交互契约。');
  for (const i of plan.interactions) {
    if (!i.resolved) { lines.push(`- \`${i.name}\`：**没有可用契约**（全库没有本页可用的该契约）`); continue; }
    lines.push(`- \`${i.name}\` ← \`${i.ruleId}\`（${i.scope}）：\`${JSON.stringify(i.contract)}\``);
  }
  lines.push('');
  lines.push('## 5. 设计决策与规则引用');
  lines.push('');
  for (const d of plan.decisions) lines.push(ruleLine(plan, d.id));
  lines.push('');
  lines.push('## 6. 缺口（必须由人或实现补齐）');
  lines.push('');
  if (!plan.gaps.length) lines.push('- 无。');
  for (const g of plan.gaps) lines.push(`- \`${g.code}\` @ \`${g.where}\`：${g.detail}`);
  lines.push('');
  lines.push('## 7. 被范围挡掉的规则');
  lines.push('');
  const byWhy = new Map();
  for (const r of plan.rejected) byWhy.set(r.why, (byWhy.get(r.why) || 0) + 1);
  for (const [why, n] of [...byWhy.entries()].sort((a, b) => b[1] - a[1])) lines.push(`- ${n} 条：${why}`);
  lines.push('');
  return lines.join('\n');
}

function renderDecisions(plan) {
  return {
    kind: 'design-decisions',
    page: plan.id,
    storeRevision: plan.basis.storeRevision,
    decisions: plan.decisions.map(d => ({ id: d.id, statement: d.statement, ruleRefs: d.ruleRefs })),
    gaps: plan.gaps.map(g => ({ code: g.code, where: g.where, detail: g.detail })),
  };
}

module.exports = { renderHtml, renderMarkdown, renderDecisions, cssVarName, esc };
