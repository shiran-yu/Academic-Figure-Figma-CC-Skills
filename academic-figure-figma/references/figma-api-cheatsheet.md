# Figma Plugin API cheatsheet — the paper-figure subset

Self-contained. With this file plus `scripts/figma_lib.js`, you can write every
`use_figma` call for a paper figure WITHOUT loading the official figma-use skill or
the Plugin API typings. Stay inside this subset; it is sufficient and verified.

## The use_figma contract

- `code` is plain JavaScript, auto-wrapped in an async context: use top-level `await`,
  end with `return {...}` — the return value is your ONLY output channel
  (`console.log` is invisible; `figma.notify` throws).
- **Failed scripts are atomic**: an error means nothing was applied. Read the error,
  fix, retry once.
- **Context resets between calls.** Re-include figma_lib.js (first line `//@figma_lib`), re-load fonts, re-fetch
  nodes by id (`await figma.getNodeByIdAsync("12:34")`) every call.
- Always return every created/mutated node id: `return {createdNodeIds:[...], ...}`.
- Screenshot inside the call: `await node.screenshot({scale: 2.6})` — the image comes
  back with the tool result; no separate screenshot call needed.

## Allowed node types (hard rule: nothing else)

`createFrame` `createText` `createLine` `createPolygon` `createNodeFromSvg`

Plus the **component-reuse subset** (canvas-tested): `figma.createComponentFromNode(node)`,
`component.createInstance()`, and `page.findAll(n => n.type === 'COMPONENT')` to locate
components the user made by hand (e.g. Math-X formula objects) and place instances.

**Banned for paper figures** — they add API complexity with zero benefit here:
Auto Layout (`layoutMode`, `layoutSizing*`, `primaryAxisSizingMode`, `createAutoLayout`),
variant sets / component properties / published-library workflows, Variables/Tokens/Styles,
`figma.createImage*`, `loadAllPagesAsync`, `setPluginData`, Sticky/Connector (FigJam-only).
Absolute x/y positioning inside plain frames is the whole layout model.

## Formulas (canvas-tested pipeline)

Every symbol — `x_t`, `\hat{x}_1`, a fraction, a norm — is typeset, in the body's maths font,
at the size it will print:

```bash
uv run --with matplotlib python scripts/latex2svg.py '\hat{x}_1' sym-x1hat.svg 8        # fontset cm, 8 pt, black
uv run --with matplotlib python scripts/latex2svg.py '\genfrac{}{}{4.0}{1}{1}{2}' k12.svg 11.43   # = \tfrac12, digits 8 pt, bar 0.46 pt
```

The viewBox is in points and Figma imports one unit as one px, so on a print-size artboard the
node IS its font size: **never `rescale` a symbol.** Place it with `symbol(parent, svg, x, y,
anchor, name, colour)` (lib): anchor `center` puts the ink centre at (x, y), `left`/`right` the
ink edge, `baseline` the glyph baseline (read from the group's `translate(x baseline)`), so a row
of labels shares one baseline. For more than three or four symbols do not inline SVG text in the
call: render them to files, `upload_assets` with `count`, POST each as multipart (the filename
becomes the layer name, the response's `placedOnNodeId` is the node), park the nodes in a
`masters-cm` frame and `clone()` per use — cloning keeps every instance identical and a master
is never moved out of a figure by accident. Recolour a clone by setting `fills` on every vector
under it (the `patch_1` box has no fill and is skipped).

**`upload_assets` paints an SVG's `<defs>`.** matplotlib emits each glyph once in `<defs>` and
references it with `<use>`; that importer draws both, so every symbol arrives with a stray copy of
each glyph and a box about 0.7 pt too tall. Expand each `<use href="#g" transform="T"/>` into
`<path d="…" transform="T scale(s)"/>` with the definition's own `d` and `scale`, then delete the
glyph `<defs>` — it rasterises pixel-identical and imports clean. `createNodeFromSvg` handles the
references correctly, so this bites only the upload route. A second trap in the same place: a
flattened vector's reported `width`/`height` follow the curve **control points**, so they overshoot
the ink by a few tenths of a point. Only the exported PDF settles a question about size.

matplotlib mathtext, not TeX: `\mathrm{diag}` not `\operatorname`, `\|` not `\lVert`, `\genfrac`
with a numeric rule size in **hundredths of the font size** (`4.0` at 11.43 pt is a 0.46 pt bar;
`0` draws no bar, `0.4pt` fails to parse) not `\tfrac`,
`\varepsilon`, `\star`, `\circ`, `\top` all fine. Reserve `mathText()` for plain sub/superscripts
inside prose labels — never for a symbol the paper sets in maths.

## Raster panels — real data inside the figure (canvas-tested)

`figma.createImage*` is banned above and `createImageAsync` is refused by the MCP
server, so **`use_figma` cannot put a bitmap on the canvas at all**. The only route is
the separate `upload_assets` MCP tool, and it is worth taking: a method figure that
shows what the method's own intermediate quantities actually look like reads far better
than one that shows named rectangles. DAPS and DAVI both do exactly this.

Order matters, because the target nodes must exist before the upload:

1. In `use_figma`, create one frame per panel at its **final print size**, named
   `img-<lane>-<quantity>`, and return the ids. A plain frame is enough; the upload
   replaces its fill.
2. Call `upload_assets` with `count: N`, `nodeIds: [...]` in the **same order** as the
   files you are about to post, and `scaleMode` (`FILL` is right when source and frame
   share an aspect ratio). It returns N single-use `submitUrl`s that expire in 10
   minutes; at most 60 per call, 10 MB per asset.
3. POST each file from the shell. Multipart is preferred, because the filename becomes
   the layer name in Figma:

```bash
curl -s -X POST -F "file=@pipe_box_geta.png;type=image/png" "<submitUrl>"
```

**SVGs go through the same endpoint** with `image/svg+xml` and arrive as editable vector
trees on the current page, ignoring `nodeIds` and `scaleMode`. Use that when a typeset
formula would push the `code` string past its 50000-char limit; otherwise inlining it
with `createNodeFromSvg` is simpler, because you keep the node id.

**Cropping happens before the upload, never after.** Figma's crop handle is not in the
allowed API subset, `FILL` centre-crops whatever does not fit with no way to nudge it,
and `FIT` letterboxes into the frame's fill colour. Crop the source to the target
frame's exact aspect ratio first; a square panel from a square source is the safe
default.

Two rules decide whether a scientific panel survives print:

- **Render the panel natively; do not crop it out of a contact sheet or a built figure.**
  A contact sheet already carries labels, padding and one resampling, so cropping it
  gives away resolution and drags in stray ink. Re-run the source script for the one
  quantity you need.
- **Upsample before upload.** A panel printed at *P* pt needs about `4.2 × P` pixels to
  reach 300 dpi, so a 34 pt panel wants roughly 145 px. Use LANCZOS for photographs and
  smooth fields, **NEAREST for masks and any binary field**, so the edges stay crisp. A
  mask-shaped operator diagonal is only legible while its square stays square.

Normalise so a reader can compare across columns, and stay greyscale so the figure
survives greyscale printing (figure-grammar rule 11): signed fields symmetric about
mid-grey with the scale at the 99th percentile of the absolute value, non-negative
fields from 0 as black to the maximum as white. State the convention in the caption.

## Core facts (each one is a real trap)

| Fact | Detail |
|---|---|
| Colours are 0-1 | `{r:1,g:0,b:0}` = red. Use `HEX('#3373D9')` from the lib. |
| fills/strokes are read-only arrays | assign whole new arrays: `n.fills = [S(1,1,1)]` |
| Fonts must load first | `await figma.loadFontAsync({family:'Tinos',style:'Bold'})` before ANY text op — per call. Tinos = Times substitute; styles: Regular/Bold/Italic. Inter style names have spaces ("Semi Bold"). |
| Text wrapping | `textAutoResize='HEIGHT'` + `resize(width, anyHeight)`. The default mode ignores width and collapses the node to a thread. |
| lineHeight/letterSpacing | object form: `{unit:'PIXELS', value: 12}` — bare numbers throw |
| resize vs rescale | `resize(w,h)` sets box; `rescale(k)` scales children+strokes too — use rescale for SVG icons (`rescale(target/node.width)`) |
| Line length | `line.resize(len, 0)`; direction via `rotation` (-90 = downward) |
| Arrows = ONE node, always | `lib arrow(parent, pts, opts)`: createVector + `setVectorNetworkAsync`, final vertex `strokeCap:'ARROW_EQUILATERAL'`, others `'NONE'`. Straight/elbow/curved/dashed all single Vector — draggable as a unit. NEVER assemble arrows from line+polygon fragments (uneditable, drift apart, unreadable layer tree). |
| Arrow helpers are async | `await arrow/arrowH/arrowV/elbowArrow/curveArrow/selfLoop(...)` |
| Find nodes | `await figma.getNodeByIdAsync(id)`, `parent.children.filter(...)`, `node.findAll(n=>...)` |
| Batch edits by id | when re-positioning arrows/dividers, use an EXPLICIT id list. Filtering `type==='LINE'` once caught a dashed divider and dragged it 112pt. |
| Dashed lines | `n.dashPattern = [3,3]` |
| Corner radius | `n.cornerRadius = 4` |
| Page switch | `await figma.setCurrentPageAsync(page)` — the sync setter throws. One switch per call max. |
| New top-level nodes | default to (0,0) — set x/y away from existing content |
| **Never delete then reuse** | A lookup map built before a removal holds dead references, and the first `n.height` on one throws `The node with id "X" does not exist` — which fails the whole call atomically, so a rebuild that clears its own furniture loses the entire attempt. Cost three retries in one session. **When rebuilding: reparent what you keep OUT of the doomed subtree first, delete, then build the map.** Or simply never delete a node you intend to move — reposition it. |
| Children are found by position, not by a derived name | Naming a chip `'tr-'+title.slice(0,6)` yields `tr-prior ` with a trailing space, and the lookup silently misses. Index siblings with `parent.children.filter(...).sort((a,b)=>(a.y-b.y)||(a.x-b.x))` and take them in reading order. |
| A block wider than its gap inverts the arrows | If a block placed between two columns is wider than `pitch - tile`, its edges cross its neighbours, and an `arrow(x1 → x2)` computed from those edges gets `x1 > x2` and silently points backwards. Assert `blockWidth + 2*minShaft <= pitch - tile` before laying anything out. |
| An arrow under ~8 pt is all head | The `ARROW_EQUILATERAL` cap is about 5 pt long, so a 4 pt connector renders as a lone triangle. Give every shaft 8 pt or more, or drop the arrow and let adjacency carry the flow. |
| Rotate, then `placeAt` | After setting `rotation`, `x`/`y` no longer mean the visual top-left, so a rotated lane label lands somewhere else and looks like broken text. `placeAt(node, parent, x, y)` fixes it from the bounding boxes. |
| **`get_screenshot` never upscales** | A 236 pt artboard comes back as a 236 px PNG whatever `maxDimension` says (the parameter only caps), and at 1× a 0.7 pt collision, a label with zero padding or a 6-vs-7 pt size drift is invisible. Three figures were signed off on 1× renders and the user found "遮挡, 字体不协调" at once. Inspect at print scale only: `await art.screenshot({scale: 8})` inside the call (1888 px for a column figure; the image rides along with the tool result). When a PNG on disk is wanted, clone → `rescale(8)` → `get_screenshot` on the clone → `remove()` (8 is a power of two, so the clone is exact and the original is never touched). |
| Re-route arrows, never `resize` them | `resize` on an arrow node stretches the head with the shaft. `await reroute(v, pts)` (lib) rewrites the vector network from tail to head, keeps stroke, colour and the last vertex's cap, and moves x/y to the new corner — the way to re-lay-out a finished figure without redrawing it. |
| One placement rule per element kind | Three panel labels means three labels in the same slot on one aligned edge; if one does not fit (the widest was `diag(AᵀA)`), move the whole column until it does, never park that one label somewhere else. The reader diffs same-kind elements; one exception reads as an error. |
| **Property access throws on the wrong node type** | `n.findOne ? ... : ...` does NOT guard: reading `findOne` on a TEXT node raises `no such property 'findOne' on TEXT node`, and the whole call is atomic, so a helper that walks mixed children dies before anything is applied. Dispatch on `n.type` instead: `if (n.type === 'FRAME' \|\| n.type === 'GROUP' \|\| n.type === 'INSTANCE') { ... }`. Same for any container-only member. |
| A lint that uses a vector's bbox reports phantom collisions | `absoluteRenderBounds` of a diagonal path is the box around the whole path, so every label placed in the triangle beside it is reported as overlapping. Skip `type === 'VECTOR'` in pairwise overlap checks, or clip the label rectangle against each SEGMENT with `_clipSeg` (lib). Two such phantoms cost a redraw before the geometry was checked by hand. |
| Padding is visible even when nothing overflows | A chip whose text ink runs to its edge ("running average" in a 46 pt block with 45.75 pt of ink) passes every overflow check and still reads as crammed. `padReport(art)` (lib) lists every text/symbol inside a filled block whose ink is under 2 pt from an edge; widen the block, or shorten the label to the paper's own term. |

## Most-used canvas widths (full table: paper-canvas-specs.md)

IEEEtran `figure*` = **516pt**, `figure` = **252pt**; elsarticle single-column ≈ **390pt**.

## Canonical call skeleton

```js
//@figma_lib
await FONTS();
const art = await figma.getNodeByIdAsync("9:2");   // or figma.createFrame() on call 1

// ... composition using stageColumn / chip / txt / arrowH / placeSvg ...

await art.screenshot({ scale: 2.6 });
return { createdNodeIds: [/* every id */] };
```

## Reference colours (measure, don't guess)

```bash
uv run --with pillow python scripts/extract_palette.py palette ref.png -n 12   # whole-image orientation
uv run --with pillow python scripts/extract_palette.py palette ref.png --crop 0.67,0.12,0.87,0.47 -n 6
uv run --with pillow python scripts/extract_palette.py probe ref.png 0.76,0.145 0.935,0.28
```

- Crop (normalized x0,y0,x1,y1 around ONE component) returns its fill/stroke/text
  trio directly; probe (block centre = fill, border midpoint = stroke) returns
  exact points. The GLOBAL palette on a white-background figure is orientation
  only — anti-aliased edges blend into muddy averages. Near-white background is
  dropped before quantizing, so shares are relative to coloured pixels.
- Then override the lib palette with measured stroke/fill pairs BEFORE drawing:
  `PAL.green=[HEX('#5f8b66'),HEX('#e8f0e9')]` — one pair per component role.

## Text fitting (no overflow, ever)

- Flow per chip: `chip()` at fixed WIDTH → `txt()` → `fitChipToInk(chip)`.
  Height comes from the text's renderBounds (ink), so descenders never sit on
  the border. `packBox(box, topPad, gap)` does this for a whole box and
  compacts its rows — the tool for "紧凑一些" requests; box height = its
  return value.
- Order matters: text final → packBox → resize box → THEN arrows (arrow
  endpoints read live geometry). A text edit invalidates heights: re-run
  packBox on that box and re-lay its arrows.
- **Stale-metrics trap: text edits and packing must be in SEPARATE calls.**
  After changing `fontSize` or `characters`, the node's `.height` and
  `absoluteRenderBounds` are NOT recomputed within the same execution — a
  pack or lint run in the same call uses pre-edit metrics and reports clean
  while the canvas actually overlaps (caught on the one-row training figure:
  same-call lint said [] with two real text collisions on screen). Edit text
  in one call, pack + lint in the next.
- auditFigure's overflow/collision/textOverlap checks are the gate that
  proves it worked — run them only in a call that made no text edits.

## Look, then say what changed (the VISTA loop)

Borrowed from VISTA (Han, Hu, Qiu, Wu, He 2026), the harness that took a multimodal model to a
perfect ARC-AGI-3 score with three habits: state what you expect to see before acting, state
every visible change afterwards, and keep a lossless memory you can revisit instead of trusting
recall. The lib gives each habit one call:

- `await inspect(art, question, region?, scale?)` — a print-scale view (default 8×) of the
  artboard, or of `{x, y, w, h}` in artboard pt, returned with the tool result; `question` is
  what the view must answer and is echoed back so the transcript keeps it. A region view is cut
  from a scaled clone inside a clipping frame that is removed before the call returns. Use it
  where `get_screenshot` cannot: a 0.5 pt gap is 4 px at 8×.
- `snapshot(art)` at the top of a mutating call, `diffLayout(before, snapshot(art))` in the
  return: added / removed / moved / resized / re-fonted / recoloured nodes, listed by the canvas.
  Write the expected change in the call's `description` first; the diff then confirms or
  contradicts it, and a change you did not predict is the first thing to look at.
- `guideTable(art)` — the artboard as a markdown table for `figs/<figure>/GUIDE.md`. Keep the
  decisions under it. A `use_figma` context resets every call and the conversation is compacted
  without warning; the GUIDE is the one place the layout survives.
- Renders go to `renders/<figure>_v<NN>.png`, one per review, never overwritten: the user's
  "that was better before" is answerable in one diff.

## Consistency discipline (the "细看全是问题" killer)

- One `STYLE` token table per figure (line weight, font-size ramp, radius, dash);
  every element reads tokens — no inline magic numbers.
- Same-kind blocks come from one data table + one loop, never hand-placed one by one.
- Before declaring done run `auditFigure(art)` — structured lint returning
  `{findings, errors, warnings, consistency}`. Checks: text below 6pt (WARN),
  text INK outside its parent frame (ERROR; judged on renderBounds, so an
  oversized-but-empty text node is not flagged), text ink touching a block that
  is NOT its ancestor (ERROR; catches an annotation whose lower line lands on a
  sibling chip's border — it fits its parent column, so the parent-overflow
  check alone misses it), partial overlap of sibling blocks (ERROR; full
  containment = layering, OK), an arrow segment crossing a block interior
  (ERROR; tail/head endpoints exempt, interior corner vertices NOT — a corner
  inside a block means the route goes through it), arrow head buried >3pt
  inside a block (WARN). Fix every ERROR before user review.
- Grouping frames arrows may legitimately cross must be named `*-stack`,
  `*-group`, `*-region`, `*-panel` or `*-container` (or passed via
  `auditFigure(art, {passThrough: ['name']})`) — they are exempt from the
  arrow and overlap checks.
- Style drift: `auditConsistency` (also embedded in the auditFigure result) —
  distinct strokeWeights beyond plan = drift. Known trap it catches: SVG symbols
  change stroke weight under `rescale` (a 1.2 stroke at 0.55 scale becomes 0.66)
  — after rescaling an injected SVG, reset its vectors' strokeWeight to STYLE.line.

## Error → fix table

| Error | Fix |
|---|---|
| `Cannot write to node with unloaded font` | `await FONTS()` (or load the exact family/style) before the text op |
| `in set_layoutSizingHorizontal: ...` | you touched Auto Layout — banned; use absolute x/y |
| `Expected 'FIXED' \| 'AUTO'...` | same — Auto Layout property, banned |
| `Setting figma.currentPage is not supported` | use `await figma.setCurrentPageAsync(page)` |
| `no such property 'createPage'` | you are in FigJam/Slides — this skill targets /design/ files only |
| colour out of range | you passed 0-255; divide by 255 or use HEX() |
| `The node with id X does not exist` | stale id from a previous call — re-fetch, or the node was removed |
| text shows but width 0 / vertical thread | missing `textAutoResize='HEIGHT'` + `resize(w, h)` |
