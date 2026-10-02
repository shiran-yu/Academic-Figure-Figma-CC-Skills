---
name: academic-figure-figma
description: >-
  Use when the user wants a paper figure (framework, pipeline, architecture,
  method overview) drawn, rebuilt, or refined as an editable vector in Figma
  via Claude Code — including reproducing a candidate/reference image
  (e.g. studio-pro C01-C04) at exact print size. Also use when the user needs
  to set up or fix the Claude Code-Figma connection: installing the Figma MCP
  plugin, OAuth/authentication (incl. remote sessions), seat or quota problems,
  "figma 连不上/怎么配置", or a first-run guided setup.
---

# Academic Figure in Figma (Claude Code)

Land a sketch, candidate image, or text description as an **editable, paper-exact
vector figure in Figma**, drawn directly through the Figma MCP server.

**Draw from this skill alone.** `references/figma-api-cheatsheet.md` +
`scripts/figma_lib.js` contain the complete verified API subset — do NOT load the
official figma-use skill, the Plugin API typings, or explore the API by trial: that
is the slow path this skill replaces. Icons come from the local cache first
(`scripts/assets/icons/icons.json`, pre-cleaned, injection-ready).

## Hard rules

1. **Correctness before aesthetics.** Grep the paper for every number, term, metric
   name, and section reference the figure will carry; show the audit table before
   drawing. Fix the reference image's errors, never reproduce them. Terminology must
   match the paper canon verbatim; when the paper is inconsistent, ask the user to
   pick. Never hard-code section numbers into a figure.
   **This binds the notation too.** Grep the live source for every symbol before drawing
   it: the paper that writes `x^\ast` 31 times and `x^\star` never must not get a star in
   its figure, and a symbol the paper never uses (`x_1` where it always writes `\hat x_1`
   or `\hat x`) is an error even though it looks right. An algorithm's local name is fair
   game when the prose symbol will not fit — label the panel `d` and gloss
   `d=\operatorname{diag}(A^\top A)` in the caption — but only if the paper itself uses `d`.
2. **Measure the render, never the node tree.** Gutters, ink coverage and font size are
   properties of pixels, and every taste argument is settled by
   `uv run --with pymupdf --with pillow --with numpy python scripts/measure_figure.py <fig.pdf>`,
   which also measures a reference paper's figure with `--figure N`. A number read off a
   caption's text block, a node's bounding box or a 1x screenshot is not a measurement:
   one such reading put a 19 pt gutter into the style contract and left four figures
   visibly inset until the user caught it by eye. Run it on every figure before handing
   it over, and on two reference figures whenever a new rule is being set.
3. **Basic building blocks only.** Frame, Text, Line, Polygon, SVG import, absolute
   x/y, plus the component-reuse subset (createComponentFromNode / createInstance).
   Auto Layout, variant sets, Variables, Styles are banned (cheatsheet §Allowed).
4. **Design at final print size** (references/paper-canvas-specs.md). Never draw big
   and shrink — fonts fall below the 6pt floor.
5. **Figure grammar** (references/figure-grammar.md): evidence for every arrow, no
   false relays, variables on edges not boxes, operation chains not just outcomes,
   repeated entities compressed, mainline centred, restrained palette.
6. **Logo semantics + eye check.** Base-model logos on the backbone block only; never
   a brand mark on the proposed-model block. Screenshot every fetched logo before use
   — CDNs mislabel (cache manifest records which marks are already verified).
7. **Say what you expect, change it, then let the canvas say what changed** (the VISTA
   loop, cheatsheet §Look, then say what changed). Before a mutating call, one line of
   expected outcome in the `description`. Inside the call: `const before = snapshot(art)`
   first, `diffLayout(before, snapshot(art))` in the return value, and
   `await inspect(art, question, region?)` — a print-scale (8×) view of the artboard or
   of one region, with the visual question it must answer. `get_screenshot` never
   upscales, and a 1× render of a 236 pt figure hides every collision and padding defect
   the reader will see (cheatsheet §Core facts). Check: text overflow, single-headed
   arrows pointing with the flow, whitespace balance, terminology.
8. **One element, one node; one figure, one style table.** Arrows are single
   vectorNetwork nodes (never line+polygon fragments). Same-kind elements are
   generated from one data table with STYLE tokens; end every session with
   `auditFigure()` — structured lint for font floor, ink overflow, block
   overlap, arrow-through-block, buried heads and style drift — and fix every
   ERROR before asking the user to review.
   **Chip heights are outputs, not inputs.** Size every chip from its text ink
   via `fitChipToInk()` / `packBox()` (lib) so text can never overflow or be
   occluded; hand-guessed fixed heights are banned, and any text change means
   re-running `packBox` on that box before re-laying arrows — **in a fresh
   call**: text metrics are stale within the call that edited the text, so
   same-call packing and linting silently pass on real overlaps
   (cheatsheet §Text fitting, stale-metrics trap).
9. **Two faces, fixed: words in Arimo 6.5 pt, symbols in Computer Modern 8 pt at 1:1.**
   Every symbol — `x_t`, a fraction, a norm, a tick numeral — goes through
   `latex2svg.py` (fontset `cm`, the body's maths font) and is placed with `symbol()`
   or cloned from the `masters-cm` frame, never rescaled (cheatsheet §Formulas,
   style-contract §Type: measured on MoCo, MAE, iMF, JiT, BNF). `mathText()` only for
   plain sub/superscripts inside a prose label. User-made formula components are
   reused via `findAll` + `createInstance`, never redrawn.
10. **Show the method's own data, not named rectangles.** Where a quantity in the
   figure is an image, put the real one there: `use_figma` cannot create a bitmap,
   so the panels are frames whose fills arrive through the `upload_assets` MCP tool
   (cheatsheet §Raster panels). Render each panel natively from the source script,
   crop to the frame's aspect before upload, and upsample to `4.2 × pt` pixels —
   NEAREST for masks, LANCZOS for everything else.
11. **Draw to the measured contract, and clone every symbol.** `references/style-contract.md`
   holds the numbers accepted figures actually use: one 6.5 pt prose size, stroke weights
   0.3 / 0.5 / 0.9 and nothing between, no stroke on a fill that sits on white, ink spanning
   the 236 pt frame with gutters of at most 10 pt, coverage 20-40 %, at most two tinted
   blocks. A typeset `sym-<key>` is a single
   layer, so park the uploads once in a `masters-typeset` frame and place `master.clone()`
   every time — `appendChild` on the master moves it, which silently strips the label from
   whichever figure held it before.
12. **Reference colours are measured, not guessed.** When a reference image exists,
   read component colours with `scripts/extract_palette.py` (cheatsheet
   §Reference colours): crop mode returns one component's fill/stroke/text trio,
   probe mode the exact colour at a point. Override the lib `PAL` with the
   measured hexes before drawing; same-role components share one measured colour.
13. **The figure's memory lives on disk, not in the conversation.** After every wave
   write `guideTable(art)` (lib) into `figs/<figure>/GUIDE.md` — ids, names, coordinates,
   fonts, fills — together with the decisions taken (why a label sits where it sits,
   what the user rejected), and save every render as `renders/<figure>_v<NN>.png`,
   never overwriting. A compacted context, or tomorrow's session, resumes from that
   file in one read instead of re-deriving the layout from the canvas.

## Workflow

**First run / connection problems — guided setup.** If Figma MCP tools are missing,
auth fails, or whoami shows a View seat, switch to the five-step tutorial in
references/figma-mcp-setup.md (§Tutorial): Claude leads, verifies each step, and
returns here when drawing-ready.

**Step 0 — Preflight.** `whoami` (quota-exempt) → seat must be Full with a paid or
education plan, else run the setup tutorial first (references/figma-mcp-setup.md). Pick canvas width
from the venue (references/paper-canvas-specs.md). Produce the Step-0 correctness
audit table (rule 1) and the figure-grammar plan (rule 5). Read
`scripts/figma_lib.js` and the icon cache manifest now — every later call starts with the
single line `//@figma_lib`, which the plugin's PreToolUse hook expands into the lib before
the call runs; never paste the lib. The hook also denies, with the reason, a call that uses
Auto Layout, assigns `figma.currentPage`, calls `console.log`, or creates text before
`await FONTS()`. If a call fails because the marker reached Figma unexpanded (`FONTS is not
defined`), the hook is not loaded: paste the lib as before.

**Step 1 — Skeleton (1 call).** Artboard at print width + all stage/panel containers
via `stageColumn()`; panel titles, dashed divider. Return every container id.

**Step 2 — Parallel fill (N calls, one message).** One call per container, following
references/parallel-drawing.md: `//@figma_lib`, `await FONTS()`, fill chips/text/icons for
that container only (`chip()`, `txt()`, `placeSvg()` with cached icons). Fan out all
containers simultaneously; never touch siblings or globals.

**Step 3 — Assembly (1 call).** Arrows between stages (`arrowH`/`arrowV`, colour per
flow type), legend (`legendRow`), per-column balance (`balanceColumn`), artboard trim.
Keep the returned arrow ids for later adjustments — never re-find arrows by type.

**Step 4 — Review loop.** Screenshot at 2.5-3x AND re-read the reference image
side-by-side (structure being right is not enough — compare density, spacing,
line routing against the original). Run rule 7, `auditConsistency()`, plus the
error vocabulary at the end of references/figure-grammar.md. Independent fixes may fan out again.
Stop when clean; ask the user to review in Figma at 100% zoom; user exports PDF — run the
font-compliance check (references/build-workflow.md §Venue font compliance) before handing it over.

## References

| File | Load when |
|---|---|
| references/figma-api-cheatsheet.md | before writing the first use_figma call (always) |
| references/parallel-drawing.md | at Step 2 |
| references/paper-canvas-specs.md | at Step 0 (canvas + fonts + palette numbers) |
| references/figure-grammar.md | at Step 0 planning and Step 4 review |
| references/figure-styles.md | picking or switching a figure's style/palette: named presets, construction rules, sampler-board + hex-map workflow |
| references/style-contract.md | at Step 0 for the numbers (palette, type, strokes, spacing, banned tells) and at Step 4 as the checklist; measured from five He Kaiming figures and three flagship inverse-problem papers |
| references/icon-sourcing.md | only when an icon is NOT in the local cache |
| references/figma-mcp-setup.md | connection/quota problems only |
| references/build-workflow.md | deep dives: balancing math, pitfalls, export + venue font compliance |
