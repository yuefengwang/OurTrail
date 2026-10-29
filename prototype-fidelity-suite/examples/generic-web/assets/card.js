document.addEventListener('DOMContentLoaded', function () {
  var btn = document.getElementById('b-btn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    btn.textContent = open ? '展开说明' : '收起说明';
    document.getElementById('b-note').textContent = open ? '说明已收起' : '说明已展开';
  });
});
