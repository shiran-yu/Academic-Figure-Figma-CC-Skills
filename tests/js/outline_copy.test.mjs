import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const LIBRARY = new URL('../../academic-figure-figma/scripts/figma_lib.js', import.meta.url);

// Minimal fake of the Figma sandbox: nodes with parent/children, clone, findAll and flatten.
function build(options = {}) {
  const log = [];
  const mixed = Symbol('mixed');
  let counter = 0;
  const make = (type, props = {}) => {
    const node = { id: `n${++counter}`, type, name: type, x: 0, y: 0, width: 10, height: 10, children: [], parent: null, ...props };
    node.findAll = test => { const out = []; const walk = n => { for (const c of n.children) { if (test(c)) out.push(c); walk(c); } }; walk(node); return out; };
    node.remove = () => { log.push(`remove ${node.name}`); node.parent.children.splice(node.parent.children.indexOf(node), 1); };
    const deepCopy = () => {
      // const copy = make(node.type, { name: node.name, x: node.x, y: node.y, width: node.width, height: node.height, segments: node.segments, fontName: node.fontName });
      const copy = make(node.type, { name: node.name, x: node.x, y: node.y, width: node.width, height: node.height, segments: node.segments, fontName: node.fontName, layoutMode: node.layoutMode });
      for (const c of node.children) { const k = c.deepCopy(); k.parent = copy; copy.children.push(k); }
      return copy;
    };
    node.deepCopy = deepCopy;
    // Like Figma, a clone is a sibling of the original.
    node.clone = () => { const copy = deepCopy(); copy.parent = node.parent; node.parent.children.push(copy); return copy; };
    node.getStyledTextSegments = () => node.segments;
    return node;
  };
  const add = (parent, node) => { node.parent = parent; parent.children.push(node); return node; };
  const page = make('PAGE');
  const artboard = add(page, make('FRAME', { name: 'Fig', x: 100, y: 50, width: 600, height: 300 }));
  // const group = add(artboard, make('FRAME', { name: 'group' }));
  const group = add(artboard, make('FRAME', { name: 'group', layoutMode: 'VERTICAL' }));
  add(artboard, make('RECTANGLE', { name: 'bar' }));
  add(group, make('TEXT', { name: 'plain', segments: [{ fontName: { family: 'Inter', style: 'Regular' } }], fontName: { family: 'Inter', style: 'Regular' } }));
  add(artboard, make('TEXT', { name: 'styled', segments: [{ fontName: { family: 'Inter', style: 'Bold' } }, { fontName: { family: 'Inter', style: 'Italic' } }, { fontName: { family: 'Inter', style: 'Bold' } }], fontName: mixed }));
  const loaded = new Set();
  const figma = {
    mixed,
    loadFontAsync: async font => {
      if (font === mixed) throw new Error('mixed font');
      await Promise.resolve();
      loaded.add(`${font.family}|${font.style}`); log.push(`load ${font.family}|${font.style}`);
    },
    flatten: (nodes, parent, index) => {
      const [text] = nodes;
      if (parent.layoutMode && parent.layoutMode !== 'NONE') throw new Error('flatten inside Auto Layout: ' + parent.name);
      for (const key of ['Inter|Regular', 'Inter|Bold', 'Inter|Italic']) if (!loaded.has(key)) throw new Error('font not loaded before flatten: ' + key);
      const vector = make('VECTOR', { name: text.name });
      text.parent.children.splice(text.parent.children.indexOf(text), 1);
      vector.parent = parent; parent.children.splice(index, 0, vector);
      log.push(`flatten ${text.name}@${index}`);
      return vector;
    },
  };
  const context = vm.createContext({ figma, console });
  vm.runInContext(fs.readFileSync(LIBRARY, 'utf8'), context);
  return { context, artboard, page, group, log, make, add };
}

test('outline_copy_is_named_and_placed_400_points_right_of_the_original', async () => {
  const { context, artboard } = build();
  const result = await context.outlineCopy(artboard);
  assert.equal(result.copy.name, 'Fig (outlined)');
  assert.equal(result.copy.x, artboard.x + artboard.width + 400);
  assert.equal(result.copy.y, artboard.y);
  const named = await context.outlineCopy(artboard, 'Export');
  assert.equal(named.copy.name, 'Export');
});

test('outline_copy_removes_an_existing_copy_of_that_name_first', async () => {
  const { context, artboard, page, add, make, log } = build();
  add(page, make('FRAME', { name: 'Fig (outlined)' }));
  add(page, make('FRAME', { name: 'Fig (outlined)' }));
  const { copy } = await context.outlineCopy(artboard);
  assert.equal(page.children.filter(n => n.name === 'Fig (outlined)').length, 1);
  assert.ok(page.children.includes(copy));
  assert.equal(log.filter(entry => entry === 'remove Fig (outlined)').length, 2);
});

test('outline_copy_given_the_original_name_keeps_the_original', async () => {
  const { context, artboard, page } = build();
  const { copy } = await context.outlineCopy(artboard, artboard.name);
  assert.ok(page.children.includes(artboard));
  assert.ok(page.children.includes(copy));
});

test('outline_copy_loads_every_font_of_every_styled_segment_before_the_first_flatten', async () => {
  const { context, artboard, log } = build();
  await context.outlineCopy(artboard);
  const firstFlatten = log.findIndex(entry => entry.startsWith('flatten'));
  const loads = log.slice(0, firstFlatten).filter(entry => entry.startsWith('load'));
  assert.deepEqual([...loads].sort(), ['load Inter|Bold', 'load Inter|Italic', 'load Inter|Regular']);
});

test('outline_copy_turns_each_text_into_a_vector_at_its_own_index_in_its_own_parent', async () => {
  const { context, artboard } = build();
  const { copy } = await context.outlineCopy(artboard);
  assert.deepEqual(copy.children.map(n => n.type), ['FRAME', 'RECTANGLE', 'VECTOR']);
  assert.deepEqual(copy.children[0].children.map(n => n.type), ['VECTOR']);
  assert.equal(copy.children[2].name, 'styled');
});

test('outline_copy_leaves_the_original_untouched', async () => {
  const { context, artboard } = build();
  await context.outlineCopy(artboard);
  assert.equal(artboard.findAll(n => n.type === 'TEXT').length, 2);
  assert.equal(artboard.findAll(n => n.type === 'VECTOR').length, 0);
  assert.equal(artboard.x, 100);
});

test('outline_copy_returns_the_flattened_and_remaining_counts', async () => {
  const { context, artboard } = build();
  const result = await context.outlineCopy(artboard);
  assert.equal(result.flattened, 2);
  assert.equal(result.remaining, 0);
});

test('outline_copy_freezes_auto_layout_on_the_copy_and_not_on_the_original', async () => {
  const { context, artboard, group } = build();
  const { copy } = await context.outlineCopy(artboard);
  assert.equal(copy.children[0].layoutMode, 'NONE');
  assert.equal(group.layoutMode, 'VERTICAL');
});
