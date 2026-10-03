// figma_lib.js — battle-tested helpers for paper figures.
// USAGE: make `//@figma_lib` the first line of every use_figma `code` string (the plugin's
// PreToolUse hook expands it into this file); do not paste it. Write only composition logic
// below it. Context resets between calls, so the marker is needed in each call.
// All functions assume fonts are already loaded via FONTS() (call it first).

const S = (r, g, b) => ({ type: 'SOLID', color: { r, g, b } });
const HEX = h => { const n = parseInt(h.replace('#',''), 16);
  return S(((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255); };

// Low-saturation academic palette: [line, fill] per stage hue.
// Measured 2026-09-16 off twelve flagship single-column figures: coloured area 0.3-4.7 % of the
// frame, one or two designed hues, never three. A pale tint and its own saturated line share one
// hue (claim); one further accent hue carries the correction. A tint above S 0.5 reads as plastic.
const PAL = {
  claim:  [HEX('#2E7EB8'), HEX('#D6E6F2')],   // hue 205/207: loss and other saturated lines, and THE claim tint
  accent: [HEX('#E2822F'), HEX('#F7E6D6')],   // hue 22, the orange MAE and FlowDPS use; <= 3 marks per figure
  grey:   [HEX('#6C6D70'), HEX('#EAEAEB')],   // connectors and a region that carries no gradient
  // the old six-hue set, kept so an existing script still reads: never use more than two of these in one figure
  amber:  [HEX('#D98D0D'), HEX('#FEF6DE')],
  blue:   [HEX('#3373D9'), HEX('#E5F0FD')],
  orange: [HEX('#DE5C1A'), HEX('#FEF0E0')],
  green:  [HEX('#1A8C4D'), HEX('#E5F7EB')],
  purple: [HEX('#7340CC'), HEX('#F0EBFD')],
};
const INK = HEX('#212226'), MUT = HEX('#6B7280');

// Load the Times-substitute family once per call. Await this before any txt().
async function FONTS() {
  for (const style of ['Regular', 'Bold', 'Italic'])
    try { await figma.loadFontAsync({ family: 'Tinos', style }); } catch (e) {}
}

// Wrapping text node. width is mandatory (default autoresize collapses the node).
function txt(parent, x, y, w, str, size, bold, colour, align) {
  const t = figma.createText();
  t.fontName = { family: 'Tinos', style: bold ? 'Bold' : 'Regular' };
  t.fontSize = size; t.characters = str; t.fills = [colour || INK];
  // t.textAutoResize = 'HEIGHT'; t.resize(w, 10); t.x = x; t.y = y;
  t.resize(w, 10); t.textAutoResize = 'HEIGHT'; t.x = x; t.y = y;   // resize() resets textAutoResize to NONE, so HEIGHT goes after it
  t.lineHeight = { unit: 'PIXELS', value: size * 1.28 };
  if (align) t.textAlignHorizontal = align;
  parent.appendChild(t); return t;
}

// Rounded content chip inside a column/box.
function chip(parent, x, y, w, h, hue) {
  const f = figma.createFrame();
  f.x = x; f.y = y; f.resize(w, h); f.cornerRadius = 3;
  f.fills = [PAL[hue][1]]; f.strokes = [PAL[hue][0]]; f.strokeWeight = 0.6;
  parent.appendChild(f); return f;
}

// Stage column with a tinted header band. Returns the column frame.
function stageColumn(parent, x, y, w, h, hue, title, titleSize) {
  const box = figma.createFrame();
  box.x = x; box.y = y; box.resize(w, h); box.cornerRadius = 4;
  box.fills = [S(1,1,1)]; box.strokes = [PAL[hue][0]]; box.strokeWeight = 0.9;
  parent.appendChild(box);
  const hdr = figma.createFrame();
  hdr.name = 'header'; hdr.x = 0; hdr.y = 0; hdr.resize(w, 24);
  hdr.fills = [PAL[hue][1]]; hdr.cornerRadius = 4;
  box.appendChild(hdr);
  const t = txt(hdr, 4, 5, w - 8, title, titleSize || 7.2, true, PAL[hue][0], 'CENTER');
  t.lineHeight = { unit: 'PIXELS', value: (titleSize || 7.2) * 1.15 };
  return box;
}

// ---- arrows: ALWAYS single-node, end-to-end (vectorNetwork per-vertex caps) ----
// One arrow = ONE Vector node the user can drag as a unit. Never assemble arrows
// from line+polygon fragments: they are uneditable and drift apart.
// STYLE tokens: define once per figure; every helper reads them. Override before use.
const STYLE = { line: 0.7, blockStroke: 0.7, dash: [2, 2], radius: 2.5 };

// arrow(parent, [[x,y],...], opts) -> single Vector. Straight (2 pts) or elbow (n pts).
// opts: {dashed, noHead, name, curve:{tangentStart:{x,y}, tangentEnd:{x,y}}} (curve: 2 pts only)
async function arrow(parent, pts, opts) {
  const o = opts || {};
  const v = figma.createVector(); parent.appendChild(v);
  const verts = pts.map((q, i) => ({ x: q[0], y: q[1],
    strokeCap: (i === pts.length - 1 && !o.noHead) ? 'ARROW_EQUILATERAL' : 'NONE' }));
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const g = { start: i, end: i + 1 };
    if (o.curve && pts.length === 2) { g.tangentStart = o.curve.tangentStart; g.tangentEnd = o.curve.tangentEnd; }
    segs.push(g);
  }
  await v.setVectorNetworkAsync({ vertices: verts, segments: segs, regions: [] });
  v.strokes = [o.colour || INK]; v.strokeWeight = STYLE.line;
  if (o.dashed) v.dashPattern = STYLE.dash;
  v.x = Math.min(...pts.map(q => q[0])); v.y = Math.min(...pts.map(q => q[1]));
  v.name = o.name || 'arrow';
  return v;
}

// Convenience wrappers (all async now)
async function arrowH(parent, x, y, len, colour, dashed) {
  return arrow(parent, [[x, y], [x + len, y]], { colour, dashed });
}
async function arrowV(parent, x, y, len, colour) {
  return arrow(parent, [[x, y], [x, y + len]], { colour });
}
async function elbowArrow(parent, pts, colour, dashed) {
  return arrow(parent, pts, { colour, dashed, name: 'elbow' });
}
async function curveArrow(parent, x1, y1, x2, y2, bend, colour, dashed) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * bend, ny = dx / len * bend;
  return arrow(parent, [[x1, y1], [x2, y2]],
    { colour, dashed, name: 'curve',
      curve: { tangentStart: { x: dx * 0.3 + nx, y: dy * 0.3 + ny },
               tangentEnd:   { x: -dx * 0.3 + nx, y: -dy * 0.3 + ny } } });
}
async function selfLoop(parent, x, y, w, rise, colour) {
  return curveArrow(parent, x + w, y, x, y, (rise || 12), colour, true);
}

// Re-geometry an existing arrow without touching its stroke, colour or head kind:
// pts[0] is the tail, pts[last] the head. `resize` on an arrow stretches the head — never use it.
async function reroute(v, pts) {
  const old = v.vectorNetwork, cap = old.vertices[old.vertices.length - 1].strokeCap || 'NONE';
  const minx = Math.min(...pts.map(p => p[0])), miny = Math.min(...pts.map(p => p[1]));
  await v.setVectorNetworkAsync({
    vertices: pts.map((q, i) => ({ x: q[0] - minx, y: q[1] - miny, strokeCap: i === pts.length - 1 ? cap : 'NONE' })),
    segments: pts.slice(1).map((_, i) => ({ start: i, end: i + 1 })), regions: [] });
  v.x = minx; v.y = miny; return v;
}

// ---- typeset symbols at 1:1 ----
// A latex2svg.py SVG (fontset cm, fontsize in pt) imports with 1 unit = 1 px, so on a print-size
// artboard the symbol IS its font size: never rescale it. The glyphs sit in the group `text_1`;
// `patch_1` is matplotlib's invisible bounding box. Anchor: 'center' (ink centre at x,y),
// 'left' / 'right' (ink edge at x, ink centre at y), 'baseline' (glyph baseline at y, ink centre at x).
// The baseline is read from the group's transform="translate(x baseline)". Returns the node.
function symbol(parent, svg, x, y, anchor, name, colour) {
  const node = figma.createNodeFromSvg(svg); parent.appendChild(node); node.name = name || 'sym';
  if (colour) for (const v of node.findAll(n => 'fills' in n && Array.isArray(n.fills) && n.fills.length)) v.fills = [colour];
  const t = node.findOne(n => n.name === 'text_1') || node;
  const nb = node.absoluteBoundingBox, tb = t.absoluteRenderBounds || t.absoluteBoundingBox;
  const ox = tb.x - nb.x, oy = tb.y - nb.y;                      // ink offset inside the node
  const m = /translate\(([-\d.]+)\s+([-\d.]+)\)/.exec(svg), base = m ? parseFloat(m[2]) : oy + tb.height;
  const a = anchor || 'center';
  node.x = a === 'left' ? x - ox : a === 'right' ? x - ox - tb.width : x - ox - tb.width / 2;
  node.y = a === 'baseline' ? y - base : y - oy - tb.height / 2;
  return node;
}

// ---- look at print scale, state the question, keep the log (after VISTA, He et al. 2026) ----
// inspect(): a print-scale view of the artboard, or of one region of it, returned with the tool
// result. `question` is what this view must answer and is echoed back so the transcript keeps it.
// `region` = {x, y, w, h} in artboard pt. Scale 8 shows a 0.5 pt gap as 4 px. A region view is cut
// from a scaled clone inside a clipping frame that is removed before the call returns.
async function inspect(art, question, region, scale) {
  const s = scale || 8;
  if (!region) { await art.screenshot({ scale: s }); return { question, view: art.name, scale: s }; }
  const tmp = figma.createFrame(); tmp.name = 'inspect-tmp'; art.parent.appendChild(tmp);
  tmp.x = art.x + art.width + 400; tmp.y = art.y; tmp.resize(region.w * s, region.h * s);
  tmp.fills = [S(1, 1, 1)]; tmp.clipsContent = true;
  const c = art.clone(); tmp.appendChild(c); c.rescale(s); c.x = -region.x * s; c.y = -region.y * s;
  await tmp.screenshot({ scale: 1 });
  tmp.remove();
  return { question, view: art.name + ' ' + JSON.stringify(region), scale: s };
}
// snapshot(): one row per direct child of the artboard. Take one at the top of a mutating call and
// one at the end, and return diffLayout(before, after): every visible change is then listed by the
// canvas, not recalled from memory (the VISTA rule: say what you expect, then say what changed).
function snapshot(art) {
  const hex = p => !p ? '' : p.type === 'SOLID' ? '#' + [p.color.r, p.color.g, p.color.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase() : p.type;
  return art.children.map(n => ({ id: n.id, name: n.name, type: n.type, x: +n.x.toFixed(2), y: +n.y.toFixed(2), w: +n.width.toFixed(2), h: +n.height.toFixed(2),
    text: n.type === 'TEXT' ? n.characters : undefined,
    font: n.type === 'TEXT' && n.fontName !== figma.mixed ? n.fontName.family + ' ' + n.fontSize : undefined,
    fill: Array.isArray(n.fills) && n.fills.length && n.fills[0].visible !== false ? hex(n.fills[0]) : undefined,
    stroke: Array.isArray(n.strokes) && n.strokes.length ? hex(n.strokes[0]) + ' ' + n.strokeWeight : undefined }));
}
function diffLayout(before, after) {
  const A = new Map(before.map(r => [r.id, r])), B = new Map(after.map(r => [r.id, r])), out = [];
  for (const r of after) {
    const o = A.get(r.id);
    if (!o) { out.push(`+ ${r.name} (${r.id}) at ${r.x},${r.y} ${r.w}x${r.h}`); continue; }
    const d = [];
    if (Math.abs(o.x - r.x) > 0.05 || Math.abs(o.y - r.y) > 0.05) d.push(`moved ${o.x},${o.y} -> ${r.x},${r.y}`);
    if (Math.abs(o.w - r.w) > 0.05 || Math.abs(o.h - r.h) > 0.05) d.push(`resized ${o.w}x${o.h} -> ${r.w}x${r.h}`);
    if (o.text !== r.text) d.push(`text "${o.text}" -> "${r.text}"`);
    if (o.font !== r.font) d.push(`font ${o.font} -> ${r.font}`);
    if (o.fill !== r.fill) d.push(`fill ${o.fill} -> ${r.fill}`);
    if (o.stroke !== r.stroke) d.push(`stroke ${o.stroke} -> ${r.stroke}`);
    if (d.length) out.push(`~ ${r.name} (${r.id}): ${d.join('; ')}`);
  }
  for (const r of before) if (!B.has(r.id)) out.push(`- ${r.name} (${r.id})`);
  return out;
}
// guideTable(): the artboard as a markdown table for figs/<figure>/GUIDE.md. Paste it after every
// wave: a fresh context (after compaction, or tomorrow) resumes from ids and coordinates, not memory.
function guideTable(art) {
  const rows = snapshot(art).map(r => `| ${r.id} | ${r.name} | ${r.type} | ${r.x} | ${r.y} | ${r.w} | ${r.h} | ${r.text !== undefined ? '"' + r.text + '" ' + (r.font || '') : (r.fill || '')}${r.stroke ? ' / ' + r.stroke : ''} |`);
  return [`## ${art.name} — ${art.width}×${art.height} pt (${art.id})`, '', '| id | name | type | x | y | w | h | text · font / fill / stroke |',
          '| --- | --- | --- | ---: | ---: | ---: | ---: | --- |', ...rows].join('\n');
}

// ---- export (Route B) ----
// outlineCopy(node, name): a copy of node 400 pt to its right with every text flattened to outlines.
// Download the copy (PDF, scale 1), then remove it in a later call. A sibling already named `name` is removed first.
async function outlineCopy(node, name) {
  const copyName = name || node.name + ' (outlined)';
  // for (const sibling of node.parent.children.filter(n => n.name === copyName)) sibling.remove();
  for (const sibling of node.parent.children.filter(n => n !== node && n.name === copyName)) sibling.remove();  // never the original
  const copy = node.clone();
  copy.name = copyName;
  copy.x = node.x + node.width + 400;
  copy.y = node.y;
  // Freeze Auto Layout on the copy: a flattened text is its ink box, so a laid-out parent would reflow.
  for (const frame of [copy, ...copy.findAll(n => n.type === 'FRAME')]) if (frame.type === 'FRAME' && frame.layoutMode && frame.layoutMode !== 'NONE') frame.layoutMode = 'NONE';
  const texts = copy.findAll(n => n.type === 'TEXT');
  // A styled text has fontName = figma.mixed, so load the font of every segment instead.
  const fonts = new Map();
  for (const t of texts) for (const seg of t.getStyledTextSegments(['fontName'])) fonts.set(seg.fontName.family + '|' + seg.fontName.style, seg.fontName);
  await Promise.all([...fonts.values()].map(f => figma.loadFontAsync(f)));
  for (const text of texts) { const parent = text.parent; figma.flatten([text], parent, parent.children.indexOf(text)); }
  return { copy, flattened: texts.length, remaining: copy.findAll(n => n.type === 'TEXT').length };
}

// Ink-to-edge padding of every text / symbol frame (use-*) inside a filled block of `root`.
// A label whose ink reaches the block edge passes every overflow check and still reads as crammed.
function padReport(root, minPad) {
  const box = n => { const b = n.absoluteRenderBounds || n.absoluteBoundingBox; return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  const inside = (a, b) => b.x >= a.x - 0.3 && b.y >= a.y - 0.3 && b.x + b.w <= a.x + a.w + 0.3 && b.y + b.h <= a.y + a.h + 0.3;
  const blocks = root.children.filter(n => n.type === 'FRAME' && Array.isArray(n.fills) && n.fills.length &&
    n.fills[0].type === 'SOLID' && n.fills[0].visible !== false && !/^use-/.test(n.name));
  const out = [];
  for (const n of root.children) if (n.type === 'TEXT' || (/^use-/.test(n.name) && n.children && n.children.length)) {
    const ink = box(n.type === 'TEXT' ? n : n.children[0]);
    for (const b of blocks) {
      const r = box(b); if (!inside(r, ink)) continue;
      const pad = [ink.x - r.x, r.x + r.w - ink.x - ink.w, ink.y - r.y, r.y + r.h - ink.y - ink.h];
      if (Math.min(...pad) < (minPad === undefined ? 2 : minPad))
        out.push(n.name + ' in ' + b.name + ': L' + pad[0].toFixed(1) + ' R' + pad[1].toFixed(1) + ' T' + pad[2].toFixed(1) + ' B' + pad[3].toFixed(1));
    }
  }
  return out;
}

// Consistency audit: distinct style values across a subtree. Run before declaring
// done; more than the expected count of any list = style drift to fix.
function auditConsistency(root) {
  const sw = new Set(), fs = new Set();
  for (const n of root.findAll(() => true)) {
    if ('strokeWeight' in n && Array.isArray(n.strokes) && n.strokes.length)
      sw.add(Math.round(n.strokeWeight * 100) / 100);
    if (n.type === 'TEXT' && typeof n.fontSize === 'number') fs.add(n.fontSize);
  }
  return { strokeWeights: [...sw].sort(), fontSizes: [...fs].sort(),
           arrowNodes: root.findAll(n => n.type === 'VECTOR').length };
}

// ---- auditFigure: structured lint (canvas-tested). Run at end of every session;
// fix every ERROR before asking the user to review. Checks: font floor, text ink
// overflowing its parent, partial block overlap, arrow segment through a block,
// arrow head buried deep inside a block, plus auditConsistency style drift.
// Grouping frames named *-stack/-group/-region/-panel/-container (or listed in
// opts.passThrough) are exempt: arrows may legitimately cross background groups.
function _bb(n) { const b = n.absoluteBoundingBox; return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null; }
function _ink(n) { const b = n.absoluteRenderBounds || n.absoluteBoundingBox; return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null; }
function _inRect(px, py, r, m) { return px >= r.x - m && px <= r.x + r.w + m && py >= r.y - m && py <= r.y + r.h + m; }
function _clipSeg(x1, y1, x2, y2, r) {   // Liang-Barsky; null = no intersection
  let t0 = 0, t1 = 1; const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy], q = [x1 - r.x, r.x + r.w - x1, y1 - r.y, r.y + r.h - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; }
    else { const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
      else { if (t < t0) return null; if (t < t1) t1 = t; } }
  }
  return [t0, t1];
}
function _isAncestor(a, n) { let p = n.parent; while (p) { if (p === a) return true; p = p.parent; } return false; }
function auditFigure(root, opts) {
  const o = Object.assign({ minFontPt: 6, headDepth: 3, overlapTol: 0.5, throughLen: 2, passThrough: [] }, opts || {});
  const skip = n => /-(stack|group|region|panel|container)$/i.test(n.name) || o.passThrough.indexOf(n.name) >= 0;
  const out = [];
  const texts = root.findAll(n => n.type === 'TEXT');
  const vecs = root.findAll(n => n.type === 'VECTOR');
  const blocks = root.findAll(n => n.type === 'FRAME' && !skip(n) &&
    Array.isArray(n.fills) && n.fills.length && Array.isArray(n.strokes) && n.strokes.length);
  const small = {};
  for (const t of texts) if (typeof t.fontSize === 'number' && t.fontSize < o.minFontPt) {
    const k = Math.round(t.fontSize * 10) / 10; small[k] = (small[k] || 0) + 1; }
  for (const k in small) out.push({ level: 'WARN', check: 'fontFloor', node: small[k] + ' text nodes', detail: k + 'pt < ' + o.minFontPt + 'pt floor' });
  // overflow judged on rendered INK (renderBounds), not the node box: an oversized
  // but empty text node is not a defect the reader can see
  for (const t of texts) {
    const p = t.parent; if (!p || p.type !== 'FRAME') continue;
    const tb = _ink(t), pb = _bb(p); if (!tb || !pb) continue;
    const ov = Math.max(pb.x - tb.x, tb.x + tb.w - (pb.x + pb.w), pb.y - tb.y, tb.y + tb.h - (pb.y + pb.h));
    if (ov > 0.5) out.push({ level: 'ERROR', check: 'textOverflow', node: JSON.stringify(t.characters.slice(0, 24)), detail: 'ink exceeds ' + p.name + ' by ' + ov.toFixed(1) + 'pt' });
  }
  // text ink colliding with a block that is NOT its ancestor (annotation-over-chip
  // case: text fits its parent column yet lands on a sibling block's border)
  for (const t of texts) {
    const tb = _ink(t); if (!tb) continue;
    for (const b of blocks) {
      if (_isAncestor(b, t)) continue;
      const r = _bb(b); if (!r) continue;
      const ix = Math.min(tb.x + tb.w, r.x + r.w) - Math.max(tb.x, r.x);
      const iy = Math.min(tb.y + tb.h, r.y + r.h) - Math.max(tb.y, r.y);
      if (ix > 0.3 && iy > 0.3)
        out.push({ level: 'ERROR', check: 'textBlockCollision', node: JSON.stringify(t.characters.slice(0, 24)) + ' × ' + b.name, detail: Math.min(ix, iy).toFixed(1) + 'pt penetration' });
    }
  }
  // text ink overlapping another text's ink (stacked captions drifting together)
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = _ink(texts[i]), b = _ink(texts[j]); if (!a || !b) continue;
    const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ix > 0.3 && iy > 0.3)
      out.push({ level: 'ERROR', check: 'textOverlap', node: JSON.stringify(texts[i].characters.slice(0, 14)) + ' × ' + JSON.stringify(texts[j].characters.slice(0, 14)), detail: Math.min(ix, iy).toFixed(1) + 'pt' });
  }
  // partial overlap between sibling blocks; full containment = layering, OK
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const A = blocks[i], B = blocks[j]; if (A.parent !== B.parent) continue;
    const a = _bb(A), b = _bb(B); if (!a || !b) continue;
    const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ix > o.overlapTol && iy > o.overlapTol) {
      const aInB = a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
      const bInA = b.x >= a.x - 1 && b.y >= a.y - 1 && b.x + b.w <= a.x + a.w + 1 && b.y + b.h <= a.y + a.h + 1;
      if (!aInB && !bInA) out.push({ level: 'ERROR', check: 'blockOverlap', node: A.name + ' × ' + B.name, detail: ix.toFixed(1) + '×' + iy.toFixed(1) + 'pt' });
    }
  }
  // tail/head endpoints may sit on a block (arrows start/end there); an interior
  // CORNER vertex inside a block = the arrow is routed through it
  for (const v of vecs) {
    const net = v.vectorNetwork; if (!net || !net.vertices.length) continue;
    const m = v.absoluteTransform;
    const abs = net.vertices.map(q => ({ x: m[0][0] * q.x + m[0][1] * q.y + m[0][2], y: m[1][0] * q.x + m[1][1] * q.y + m[1][2] }));
    const last = net.vertices.length - 1;
    for (const b of blocks) {
      if (_isAncestor(b, v)) continue;
      const r = _bb(b); if (!r) continue;
      const rIn = { x: r.x + 0.5, y: r.y + 0.5, w: r.w - 1, h: r.h - 1 };
      for (const s of net.segments) {
        const p1 = abs[s.start], p2 = abs[s.end];
        const c = _clipSeg(p1.x, p1.y, p2.x, p2.y, rIn); if (!c) continue;
        const clipLen = (c[1] - c[0]) * Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const e1ok = s.start === 0 && _inRect(p1.x, p1.y, r, 0.5);
        const e2ok = s.end === last && _inRect(p2.x, p2.y, r, 0.5);
        if (clipLen > o.throughLen && !e1ok && !e2ok)
          out.push({ level: 'ERROR', check: 'arrowThroughBlock', node: v.name + ' × ' + b.name, detail: clipLen.toFixed(1) + 'pt inside' });
      }
      const hv = net.vertices[last];
      if (hv.strokeCap === 'ARROW_EQUILATERAL') {
        const h = abs[last];
        if (h.x > r.x && h.x < r.x + r.w && h.y > r.y && h.y < r.y + r.h) {
          const depth = Math.min(h.x - r.x, r.x + r.w - h.x, h.y - r.y, r.y + r.h - h.y);
          if (depth > o.headDepth) out.push({ level: 'WARN', check: 'buriedHead', node: v.name + ' in ' + b.name, detail: depth.toFixed(1) + 'pt deep' });
        }
      }
    }
  }
  return { findings: out, errors: out.filter(f => f.level === 'ERROR').length,
           warnings: out.filter(f => f.level === 'WARN').length, consistency: auditConsistency(root) };
}

// Flow-type legend, laid out 2xN. items = [[label, colourPaint, dashed], ...]
function legendRow(parent, x, y, w, items, textSize) {
  const box = figma.createFrame();
  box.x = x; box.y = y; box.resize(w, 12 + Math.ceil(items.length / 2) * 11);
  box.cornerRadius = 3; box.fills = [S(1,1,1)];
  box.strokes = [HEX('#B3B9C2')]; box.strokeWeight = 0.7;
  parent.appendChild(box);
  items.forEach(([label, colour, dashed], i) => {
    const cx = 6 + (i % 2) * (w / 2 - 4), cy = 6 + Math.floor(i / 2) * 11;
    const ln = figma.createLine();
    ln.x = cx; ln.y = cy + 3; ln.resize(11, 0);
    ln.strokes = [colour]; ln.strokeWeight = 1;
    if (dashed) ln.dashPattern = [2, 2];
    box.appendChild(ln);
    txt(box, cx + 15, cy - 0.5, w / 2 - 22, label, textSize || 5, false, MUT);
  });
  return box;
}

// Vertically centre a column's body between regionTop and the box bottom.
// Excludes the header band and any node ids listed in pinnedIds.
function balanceColumn(box, regionTop, pinnedIds) {
  const pinned = pinnedIds || [];
  const body = box.children.filter(n => n.name !== 'header' && !pinned.includes(n.id));
  if (!body.length) return 0;
  const top = Math.min(...body.map(n => n.y));
  const bot = Math.max(...body.map(n => n.y + n.height));
  const d = Math.round(((box.height - 8) - regionTop - (bot - top)) / 2 + (regionTop - top));
  body.forEach(n => { n.y += d; });
  return d;
}

// ---- text fitting: text must NEVER overflow or be occluded by its chip ----
// Size a chip from its text INK (renderBounds: includes descenders and AA),
// not the node box and never a hand-guessed height. Canvas-proven on the
// GeoAT-LM figures: fixed heights overflowed, node-box heights still left
// 1-2pt border strikes, ink-fit linted clean.
function fitChipToInk(chip, slack) {
  const t = chip.children.find(c => c.type === 'TEXT');
  if (!t) return chip.height;
  const rb = t.absoluteRenderBounds, ab = t.absoluteBoundingBox;
  const inkH = rb ? rb.height : t.height, inkOff = rb ? rb.y - ab.y : 0;
  const h = Math.max(Math.ceil(inkH) + (slack === undefined ? 6 : slack), 10);
  chip.resize(chip.width, h);
  t.y = (h - inkH) / 2 - inkOff;
  const ic = chip.children.find(c => c.type === 'FRAME' && /^icon/.test(c.name));
  if (ic) ic.y = (h - ic.height) / 2;
  return h;
}

// Compact a box: cluster children into rows by their current y, ink-fit every
// chip, stack rows with `gap`, return content height (incl. bottom pad).
// Corner icons/logos (names icon*/logo*) stay pinned. Re-run after ANY text
// change, then resize the box to the returned height.
function packBox(box, topPad, gap) {
  const skip = n => /^(icon|logo)/.test(n.name);
  const kids = box.children.filter(n => !skip(n)).sort((a, b) => a.y - b.y);
  const rows = []; let cur = null, curY = -999;
  for (const k of kids) {
    if (Math.abs(k.y - curY) > 5) { cur = [k]; rows.push(cur); curY = k.y; }
    else cur.push(k);
  }
  let y = topPad;
  // bare TEXT rows have no chip to fit: lay them out by INK height, not node
  // height, or their descenders land on the box's bottom border (found on the
  // GeoAT-LM Model input body text: 1.2pt border strike)
  const effH = m => (m.type === 'TEXT' && m.absoluteRenderBounds)
    ? Math.max(m.height, Math.ceil(m.absoluteRenderBounds.height) + 2) : m.height;
  for (const row of rows) {
    for (const m of row) if (m.type === 'FRAME') fitChipToInk(m);
    const rowH = Math.max(...row.map(effH));
    for (const m of row) m.y = y + (rowH - m.height) / 2;
    y += rowH + gap;
  }
  return Math.ceil(y - gap + 6);
}

// Inject a cleaned SVG string as a true vector. colour replaces currentColor.
function placeSvg(parent, svg, colour, x, y, size, name) {
  const node = figma.createNodeFromSvg(colour ? svg.split('currentColor').join(colour) : svg);
  node.name = name || 'icon';
  parent.appendChild(node);
  node.rescale(size / node.width); node.x = x; node.y = y;
  return node;
}

// ---------- extended shapes (v0.3) — all SVG-template based ----------

// Solid/tinted ellipse node (e.g. state, dataset bubble).
function ellipse(parent, x, y, w, h, hue) {
  const e = figma.createEllipse();
  e.x = x; e.y = y; e.resize(w, h);
  e.fills = [PAL[hue][1]]; e.strokes = [PAL[hue][0]]; e.strokeWeight = 0.8;
  parent.appendChild(e); return e;
}

const _hex = p => { const c = p.color;
  return '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join(''); };




// Curly brace spanning `len` pt. side: 'left'|'right'|'top'|'bottom' (tip points away).
// After rotating a node, its x/y no longer mean its visual top-left.
// placeAt fixes that using bounding boxes (works inside any parent frame).
function placeAt(node, parent, x, y) {
  const nb = node.absoluteBoundingBox, pb = parent.absoluteBoundingBox;
  if (nb && pb) { node.x += x - (nb.x - pb.x); node.y += y - (nb.y - pb.y); }
}

function brace(parent, x, y, len, side, colour) {
  const t = 4;   // tip depth
  const d = `M 0 0 C ${t} ${len*0.12} ${t*0.4} ${len*0.38} ${t} ${len/2} C ${t*0.4} ${len*0.62} ${t} ${len*0.88} 0 ${len}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t+1} ${len}">` +
    `<path d="${d}" fill="none" stroke="${_hex(colour)}" stroke-width="${STYLE.line}" stroke-linecap="round"/></svg>`;
  const node = figma.createNodeFromSvg(svg);
  node.name = 'brace'; parent.appendChild(node);
  if (side === 'left')  node.rotation = 180;
  if (side === 'top')   node.rotation = -90;
  if (side === 'bottom') node.rotation = 90;
  placeAt(node, parent, x, y);
  return node;
}

// Dashed grouping container with a small corner label. Content goes on top of it.
function dashedGroup(parent, x, y, w, h, label, hue, labelSize) {
  const f = figma.createFrame();
  f.x = x; f.y = y; f.resize(w, h); f.cornerRadius = 4;
  f.fills = []; f.strokes = [PAL[hue][0]]; f.strokeWeight = 0.7;
  f.dashPattern = [3, 3]; f.clipsContent = false;
  parent.appendChild(f);
  if (label) {
    const tag = figma.createFrame();
    tag.x = 6; tag.y = -5; tag.resize(4 + label.length * (labelSize || 5) * 0.55, 10);
    tag.fills = [S(1, 1, 1)]; tag.cornerRadius = 2;
    f.appendChild(tag);
    txt(tag, 2, 1, tag.width - 3, label, labelSize || 5, true, PAL[hue][0]);
  }
  return f;
}

// Small capsule badge (xN markers, dataset sizes, tags).
function badge(parent, x, y, label, hue, size) {
  const s = size || 4.8;
  const b = figma.createFrame();
  b.x = x; b.y = y; b.resize(6 + label.length * s * 0.55, s + 4.5);
  b.cornerRadius = (s + 4.5) / 2;
  b.fills = [PAL[hue][1]]; b.strokes = [PAL[hue][0]]; b.strokeWeight = 0.5;
  parent.appendChild(b);
  txt(b, 3, 2, b.width - 4, label, s, true, PAL[hue][0], 'CENTER');
  return b;
}

// Rotated text for y-axis style labels (reads bottom-to-top).
function rotText(parent, x, y, w, str, size, colour) {
  const t = txt(parent, 0, 0, w, str, size, false, colour, 'CENTER');
  t.rotation = 90; placeAt(t, parent, x, y);
  return t;
}

// Grid cell coordinates (pure math, no nodes): returns [[x,y],...] row-major.
function gridCells(x, y, cols, rows, cellW, cellH, gap) {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    out.push([x + c * (cellW + gap), y + r * (cellH + gap)]);
  return out;
}

// Unicode sub/superscripts for simple math in labels: mathText("x_1 y^2 W_k")
function mathText(s) {
  const sub = {'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','k':'ₖ','i':'ᵢ','j':'ⱼ','n':'ₙ','t':'ₜ'};
  const sup = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','n':'ⁿ','i':'ⁱ'};
  return s.replace(/_([0-9a-z])/g, (m, c) => sub[c] || m)
          .replace(/\^([0-9a-z])/g, (m, c) => sup[c] || m);
}
