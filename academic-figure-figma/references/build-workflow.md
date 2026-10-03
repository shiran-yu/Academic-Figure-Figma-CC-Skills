# Incremental build workflow — details and pitfalls

Companion to SKILL.md steps 1-5. Everything here was learned on a real figure
(GeoAT-LM framework, 516×402 pt, ~30 use_figma calls including reworks; a clean run
takes ~15).

## Correctness audit first (Step 0)

Before drawing, produce this table for every text element that will appear:

| Figure will say | Paper says (line ref) | Verdict |
|---|---|---|
| 11 semantic groups | L167 "11 semantic feature groups" | ok |
| Exact Match | table header L772 | renamed from candidate's "Accuracy" |

Rules of thumb:
- Never hard-code section/figure/table numbers into a figure — they shift.
- Metric names must match the results-table headers verbatim.
- When the paper itself is inconsistent (e.g. "constructed" vs "synthetic rationale"),
  surface it and let the user pick the canonical term — do not pick silently.

## Helper pattern

Define these once per call (context resets between use_figma calls):

```js
const S=(r,g,b)=>({type:'SOLID',color:{r,g,b}});
function txt(p,x,y,w,str,size,bold,colour,align){
  const t=figma.createText();
  t.fontName={family:"Tinos",style:bold?"Bold":"Regular"};
  t.fontSize=size; t.characters=str; t.fills=[colour];
  t.resize(w,10);                      // width first: resize() resets textAutoResize to NONE
  t.textAutoResize="HEIGHT"; t.x=x; t.y=y;   // wrap: explicit width + height-hug
  t.lineHeight={unit:"PIXELS",value:size*1.28};
  if(align)t.textAlignHorizontal=align;
  p.appendChild(t); return t;
}
```

`textAutoResize:"HEIGHT"` + explicit width is mandatory for wrapping text; the default
WIDTH_AND_HEIGHT mode ignores the width and collapses the node into a thread. Set the width with
`resize` first and `textAutoResize` after it: `resize` resets `textAutoResize` to `NONE`, and the
node then keeps the 10 pt height while its text overflows (measured 2026-10-03, poster spike S8).

## Arrows

```js
// shaft
const l=figma.createLine(); l.x=x; l.y=y; l.resize(len,0);
l.strokes=[col]; l.strokeWeight=1; l.strokeCap="NONE";
// head (rightward): 3-point polygon, rotation -90, tip at x+len
const h=figma.createPolygon(); h.pointCount=3; h.resize(3.6,4.6);
h.fills=[col]; h.strokes=[]; h.rotation=-90;
h.x=x+len-3.6; h.y=y-2.3;
// downward: rotation=180, h.x=cx-1.8, h.y=y+len-4.6
```

- `strokeCap:"ARROW_LINES"` on a Line arrows **both ends** — only use for double-headed.
- Keep a written list of arrow node ids. Re-centring by
  `children.filter(n=>n.type==='LINE')` once captured the dashed panel divider too and
  dragged it 112 pt into the panel. Explicit id lists only.

## Balancing multi-column panels

1. Panel height = content bottom of the fullest column + padding.
2. For each other column: `delta = ((H-pad) - regionTop - contentH)/2 + (regionTop - top)`;
   shift body nodes (exclude the header and any pinned tag rows).
3. Re-centre arrow rows to `panelTop + H/2` (by id list).
4. Compact tricks that bought 46 pt on a real figure: merge two single-fact chips into
   one two-line chip; delete a footer that repeats a header tag; tighten chip stack gap
   to 3 pt.

## Screenshot self-review checklist (every stage)

- Text overflow: any line touching/crossing its chip border; any unintended wrap
  (long tokens like `<answer> label set </answer>` need a smaller size or shorter text).
- Arrow heads: one per arrow, pointing with the flow.
- Whitespace: no column with > ~25% empty bottom; no panel gap > 14 pt.
- Terminology: labels vs. paper canon.
- Icons: right mark, right block (base-model logo on backbone only).

## Interplay with candidate generators (studio-pro etc.)

Treat C01-C04/F01-F02 candidates as **layout references only**:
- Steal their narrative structure freely (e.g. a supervision-asymmetry framing that
  makes the figure argue the paper's C1).
- Re-verify every fact against the paper — candidates routinely contain hallucinated
  numbers and stale terminology.
- Their S0 fact sheets (paper-foundation-report.md) speed up the Step-0 audit but the
  paper source stays authoritative.

## Export

User exports from Figma directly (File → Export → PDF, 1x) — the artboard is already
at print size. PNG exports for quick sharing at 2-3x. Keep the artboard free of
off-canvas scratch nodes before export.

### Venue font compliance

AAAI's author kit rejects a PDF containing **Type 3 fonts, even inside an illustration**,
requires **every font embedded — figures included**, and requires fonts needing non-Roman
support (**CID / Identity-H**) to be **converted to outlines or removed, even inside an
embedded graphics file**. Ship figures as **PDF or high-resolution raster, never
EPS/PostScript**. Elsevier and IEEE impose equivalent embedding rules, so run the check
whatever the venue.

**Figma's own PDF export writes Type 3 fonts** — measured, not assumed. Outlining every
text run removes all fonts from the file and satisfies the rule trivially:

- Figma **SVG export outlines text by default** (`svgOutlineText`), so `download_assets`
  with `defaultFormat: "svg"` then SVG→PDF is the source-safe route — it reads the frame,
  never mutates it. Convert with `pymupdf.open("f.svg").convert_to_pdf()`.
- `TextNode.outlineText()` is **not exposed** in the MCP sandbox, but **`figma.flatten([t])`
  is**, and on a TEXT node it returns the glyph outlines. That gives the second route, the one
  to use when the figure contains raster panels: clone the artboard off to the side,
  `for (const t of clone.findAll(n => n.type === 'TEXT')) { await figma.loadFontAsync(t.fontName); figma.flatten([t]); }`,
  then `download_assets` on the **clone** with `defaultFormat: "pdf"`, `defaultScale: 1`.
  Measured on a 236 × 96 pt figure: page exactly 236 × 96 pt, `get_fonts()` empty, the five
  raster panels preserved as embedded images. Figma re-encodes those fills as **JPEG**
  (`DCTDecode`) whatever they were uploaded as, invisible at the ~1900 dpi a 640 px panel
  lands at inside a 24 pt box, but lossy — never round-trip a figure through export to
  re-import it.
- Never outline in place. If a route needs mutation, duplicate to a scratch frame and
  delete it afterwards.
- **Trade-off:** outlined text is no longer selectable, searchable or editable in the PDF.
  The Figma file stays the editable master; re-export after any text change.

Verify before handing the figure over:

```bash
uv run --with pymupdf python -c "import pymupdf; d=pymupdf.open(P); print([(f[3],f[2],f[4]) for p in d for f in p.get_fonts(full=True)])"
```

PASS = empty list (text outlined), or every entry reporting Type 1 / TrueType / OpenType.
FAIL = any `Type3` entry or any `Identity-H` encoding. Also confirm the page size in points
matches the target column width.
