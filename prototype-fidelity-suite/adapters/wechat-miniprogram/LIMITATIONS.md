# WeChat mini program adapter — known limitations

Each heading id is referenced from `adapter.json` → `limitations[]`; the contracts
test fails if an id and a heading drift apart.

These are **measurement** limits, not a list of platform bugs. They decide which
conclusions this adapter is allowed to support, and each one names the workaround the
suite actually uses.

### WX-01 No DOM and no CSSOM

The DevTools automation endpoint exposes the host app service, not a browser document.
A probe on the IDE build of 2026-10-28 returned `appservice App.CDPEnable unimplemented`
for all three call shapes (`sendCommand(name, params)`, `sendCommand({method, params})`,
and an evaluated `document.querySelectorAll('*')` + `getComputedStyle` script); the raw
reading is in `docs/research-report.md` §5.

**Consequence**: there is no tree walk, no `getComputedStyle`, no `getBoundingClientRect`
over the document. Only per-element `offset()/size()/text()/style(prop)` and
`mp.screenshot()`.
**How the suite handles it**: the adapter probes exactly the selectors it is given;
everything else is simply not in the snapshot.
**Status**: measured on one build; re-probe before assuming it still holds.

### WX-02 The node tree is a flat list per selector

`page.$$(selector)` returns matches with no parent/child links, so nodes are emitted
with `parentId: null` and empty `children`.

**Consequence**: hierarchy cannot be discovered at runtime. A node that no selector
mentions is invisible to this capture — that means "not asked", not "does not exist".
**How the suite handles it**: hierarchy and pairing come from `pf.config.json`
(`pages[].mappings`), and a declared-but-unresolved selector is reported UNVERIFIED
instead of being treated as absent.
**Status**: structural limitation.

### WX-03 Line count is inferred, not measured

There is no equivalent of `Range.getClientRects()`. The adapter divides the element
height by its computed `line-height` and rounds, and labels the result
`lineCountSource: 'inferred'`.

**Consequence**: a wrap/overflow conclusion from this number is a hint. It is wrong
for elements with padding, borders or mixed line heights.
**How the suite handles it**: inferred line counts cannot by themselves produce a
typography PASS/FAIL; where wrapping matters, use the ink signature or the pixel
region.
**Status**: accepted gap, explicitly labelled in the snapshot.

### WX-04 Element text is concatenated text

`el.text()` joins descendant text. Container and leaf are not distinguished by the
platform call.

**Consequence**: "same text" does not mean "same layout of text" — two nodes can share
a string while wrapping or truncating differently.
**How the suite handles it**: text equality is only one input; the pair also has to
pass the ink signature before a text pair can be called PASS.
**Status**: handled by design.

### WX-05 Screenshot scale is not 1, and there is no element screenshot

Measured on a 390×844 viewport: the returned PNG is 306×660 (≈0.7846 × 0.7820). The
scale is device/build dependent, so the adapter measures the PNG header and records
`screenshotScale` per capture instead of assuming.

**Consequence**: comparing raw pixels across sides without normalisation compares
different pixel densities; cropping an element is impossible at capture time.
**How the suite handles it**: regions are cropped from the page screenshot using the
normalised geometry (`regions.js`), and both sides are resampled onto one shared CSS
sub-rectangle before diffing.
**Status**: handled; the recorded scale is the evidence.

### WX-06 Fonts and images are not awaited

There is no `document.fonts.ready` and no `img.decode()`. The adapter can only wait a
fixed time (`settleMs`) and then inject.

**Consequence**: "the screenshot was taken after the page settled" is an assumption,
not a fact.
**How the suite handles it**: the capture is only usable after the page's own render
prerequisites are asserted (the host project's pages have a gate chain: denied/loading/
data-present). Treat a capture without that assertion as UNVERIFIED.
**Status**: accepted gap; gate the capture, don't trust the wait.

### WX-07 Injection is `page.setData`, so the state is synthetic

Injecting writes page data directly. The adapter marks such captures
`dataSource: 'injected'`.

**Consequence**: an injected render proves the render path, never the data path, and
never interaction behaviour.
**How the suite handles it**: `capture-manifest` carries the flag, the page-state
manifest marks the state `usableAsInteractionEvidence: false`, and the interaction
contract refuses to count injected frames as evidence.
**Status**: enforced by contracts.

### WX-08 Native chrome is not in the element API

The default navigation bar, the capsule button and the system status bar are drawn by
the framework/simulator, not by WXML nodes.

**Consequence**: page headers cannot be paired by selector against a browser
prototype, and the top of the screenshot contains chrome the prototype may not have.
**How the suite handles it**: prototypes are captured inside an explicit frame
(`frameSelector`) with a matching chrome, comparisons are re-based on the content
anchor, and header-level differences are reported as platform differences rather than
target defects.
**Status**: accepted difference, must be declared in `acceptedDifferences`.

### WX-09 Fixed / sticky elements have an unverified coordinate basis

Geometry is document-space with `scrollTop` subtracted, which matches normal flow. For
`position: fixed` elements the two bases coincide, and it is not established on this
build whether `offset()` already reports the viewport position.

**Consequence**: after scrolling, a fixed or sticky element's reported `rect.y` may be
off by the scroll amount.
**How the suite handles it**: such elements are verified against the screenshot pixels,
not against geometry alone; a geometry-only claim about a fixed element is UNVERIFIED.
**Status**: unverified — probe it before trusting the number.
