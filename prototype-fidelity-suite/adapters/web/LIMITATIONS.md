# Web adapter — known limitations

Each heading id is referenced from `adapter.json` → `limitations[]`; the contracts
test fails if an id and a heading drift apart.

### WEB-01 Rendering depends on the host machine

Chromium's output varies with OS, installed fonts, headless mode and GPU. The same
source at the same viewport can produce different pixels on two machines.

**Consequence**: a diff between captures taken on different hosts is not a fidelity
verdict, it is a font-stack report.
**How the suite handles it**: every capture records code version, viewport, DPR,
timestamp and screenshot sha256 (`capture-manifest`), and cross-machine comparison is
out of scope — only captures from one batch are compared.
**Status**: recorded, not eliminated.

### WEB-02 DOM text is not visible text

`line-clamp` and `text-overflow: ellipsis` truncate rendering without changing
`textContent`, so a node can read "identical text" while the user sees an ellipsis.

**Consequence**: text equality alone never proves visual fidelity.
**How the suite handles it**: text pairs also go through an ink signature
(`diff.js` → `compareInk`: ink extent + ink amount on the compared crops), which a
truncated line fails even when the strings are byte-identical.
**Status**: handled by design; the textual check stays informational next to it.

### WEB-03 Pseudo-elements are not nodes

`::before` / `::after`, list markers and CSS counters are painted but do not exist in
the DOM snapshot.

**Consequence**: decorative glyphs, separators and markers have no contract row.
**How the suite handles it**: they surface only in region diffs; do not add a
selector for them to the mapping table — it will resolve to nothing and be reported
UNVERIFIED rather than silently matched.
**Status**: accepted gap.
