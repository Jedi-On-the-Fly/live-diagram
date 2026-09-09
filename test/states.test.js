import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStates, styleFor, DEFAULT_STATES } from '../src/states.js';

test('a partial override keeps the rest of the default vocabulary', () => {
  const states = normalizeStates({ running: { style: 'fill:#f00' } });
  assert.equal(states.running.style, 'fill:#f00');
  assert.equal(states.success.style, DEFAULT_STATES.success.style, 'untouched states survive');
  assert.equal(states.running.icon, DEFAULT_STATES.running.icon, 'unspecified keys survive within a state');
});

test('extend:false starts from an empty vocabulary', () => {
  const states = normalizeStates({ up: { style: 'fill:#0f0' } }, { extend: false });
  assert.deepEqual(Object.keys(states), ['up']);
});

test('a bare string is shorthand for a style', () => {
  assert.equal(normalizeStates({ hot: 'fill:#f00' }).hot.style, 'fill:#f00');
});

test('darkStyle falls back to style, so a one-palette config still works', () => {
  const states = normalizeStates({ hot: { style: 'fill:#f00' } });
  assert.equal(styleFor(states, 'hot', 'dark'), 'fill:#f00');
});

test('styleFor picks the theme variant and tolerates unknown states', () => {
  const states = normalizeStates();
  assert.equal(styleFor(states, 'success', 'dark'), DEFAULT_STATES.success.darkStyle);
  assert.equal(styleFor(states, 'success', 'light'), DEFAULT_STATES.success.style);
  assert.equal(styleFor(states, 'nonsense', 'light'), '');
});

test('every default state defines both themes and a label', () => {
  const states = normalizeStates();
  for (const [name, entry] of Object.entries(states)) {
    assert.ok(entry.style, `${name} has a light style`);
    assert.ok(entry.darkStyle, `${name} has a dark style`);
    assert.ok(entry.label, `${name} has a label`);
  }
});

test('functional colours are rewritten to hex, which Mermaid can parse', () => {
  const states = normalizeStates({ hot: { style: 'fill:rgba(255,0,0,0.5),stroke:rgb(0,128,0)' } });
  assert.equal(states.hot.style, 'fill:#ff000080,stroke:#008000');
  assert.equal(states.hot.edgeStyle, 'stroke:#008000', 'the derived edge stroke sees the hex form');
});

test('hsl converts too, and anything unconvertible is left exactly as written', () => {
  const states = normalizeStates({
    cool: { style: 'fill:hsl(120,100%,25%)' },
    odd: { style: 'fill:hsl(0.5turn,50%,50%),stroke:var(--x)' }
  });
  assert.equal(states.cool.style, 'fill:#008000');
  assert.equal(states.odd.style, 'fill:hsl(0.5turn,50%,50%),stroke:var(--x)');
});

test('explicit edge styles are converted like node styles', () => {
  const states = normalizeStates({ hot: { style: 'fill:#fff', edgeStyle: 'stroke:rgba(255,0,0,.5)' } });
  assert.equal(states.hot.edgeStyle, 'stroke:#ff000080');
});
