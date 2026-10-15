# Nine built-in sample silhouettes with a dropdown picker

The sample button's single hard-coded heart is replaced by a registry of nine procedural silhouettes (heart, star, half moon, balloon, ice cream, apple, cherry, cat, dog). A labelled native `<select>` plus a Load button picks which one to trace. `loadSample(id)` looks the draw function up in the registry and then runs the unchanged `loadFromSource` pipeline. The readme gets a short note under "Run locally" and an updated `index.js` bullet. The previous pass's blocking finding (an unrelated `atan2` edit inside Math background) is fixed: the readme diff now touches only the file-list bullet and the new note.

Watch for: nothing blocking. The dog head and ear are the weakest silhouette (possible, minor polish).

**Verdict**: APPROVED

## High-level view

Each sample is a small draw function that paints one solid black shape on a white 400x400 offscreen canvas. Parts are built to overlap, so the tracer's largest-blob outer-boundary logic yields one closed contour per sample. The verification report shows all nine tracing with M between 554 and 1024, success status, no console errors, and recognizable results at max N.

The registry is a plain ES5 array of `{id, label, draw}` with helper fill functions. Heart is the default at startup and in the select. The contour and DFT code is untouched; the diff in `index.js` is confined to the sample section, the new `sampleSelect` binding and the listener wiring.

The picker is a native select with a `for`-bound label, so keyboard and screen-reader access come for free. Its CSS reuses the existing theme variables, and `.row select { flex: 1; min-width: 0 }` lets it shrink on narrow screens next to the Load button.

<details>
<summary>Issues (1)</summary>

1. **Dog head and ear polish** — the ear reads as a flat cap with a notch at the neck, and the legs are plain rectangles. Optional; improve if desired (possible, non-blocking).

</details>

<details>
<summary>Details</summary>

## Single-component construction of the new shapes

I checked each draw function for overlap between its parts, since the pipeline discards everything except the largest blob. All nine pass:

- Cat: the ears overlap the head ellipse, the head overlaps the body, and the tail stroke starts inside the body ellipse.
- Dog: the neck polygon bridges head and body, the legs start inside the body ellipse, and the tail's round cap overlaps the body's right end.
- Balloon: the knot's apex sits inside the ellipse and the string starts inside the knot.
- Apple and cherry: the stems start inside the fruit bodies, and the leaf touches the stem.
- Half moon: it is a circle with a white circular bite, which leaves a connected crescent.

The reported traced counts (e.g. cherry 1074 and dog 1251 contour points resampled to 1024) fit single solid outlines, and no sample relies on hairlines or interior holes. Cherry and dog hit the 1024 cap, so their detail is capped, but the report shows them recognizable.

## Registry refactor and startup default

`loadSample(id)` falls back to the first registry entry for an unknown id, and `currentSampleId()` falls back to heart. Heart stays first in the list, so the startup call `loadSample(DEFAULT_SAMPLE_ID)` and the select's initial value agree. Style is ES5 (`var`, function expressions, `forEach`). The `// SAMPLES-START/END` markers are harmless. `ctx.ellipse` is the only newer canvas API used; it is widely supported.

## Pipeline and regression surface

The N slider, play/pause, drag and drop, and file upload code paths are not in the diff. The verification report confirms N carries across sample switches and clamps to the new max. `index.html` removes the old "Load sample (heart)" label in favor of "Load" next to the select; the button id is kept, so the existing binding still works. There is one stray blank line in `index.html`, which is cosmetic.

</details>

<details>
<summary>File map</summary>

- `index.js`: sample registry, nine draw functions, `loadSample(id)`, select population and wiring
- `index.html`: Sample shape label, select and Load button
- `index.css`: themed `select` style and a flexible width inside `.row`
- `readme.md`: file-list bullet and a sample note under "Run locally"; Math background untouched

Full diff: `git diff`

</details>
