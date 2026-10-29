'use strict';

const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

function escapeHtml(value) {
  if (value == null) return '';
  return String(value).replace(/[&<>"'`]/g, c => MAP[c]);
}

module.exports = { escapeHtml };
