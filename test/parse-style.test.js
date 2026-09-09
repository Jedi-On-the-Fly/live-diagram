/**
 * parseStyle feeds the repaint fast path and the legend. Its one subtlety is
 * that a comma can be a separator or part of a value, and only the string
 * itself can say which.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStyle } from '../src/live-diagram.js';

test('splits declarations on top-level commas', () => {
  assert.deepEqual(parseStyle('fill:#fff,stroke:#000,stroke-width:2px'),
    { fill: '#fff', stroke: '#000', 'stroke-width': '2px' });
});

test('commas inside a colour function belong to the value', () => {
  assert.deepEqual(parseStyle('fill:rgba(0,0,0,0.5),stroke:hsl(120,50%,40%)'),
    { fill: 'rgba(0,0,0,0.5)', stroke: 'hsl(120,50%,40%)' });
});

test('quoted values keep their commas and their brackets', () => {
  assert.deepEqual(parseStyle('fill:url("a,(b).png"),stroke:#000'),
    { fill: 'url("a,(b).png")', stroke: '#000' });
});

test('tolerates junk: empty input, missing colons, stray separators', () => {
  assert.deepEqual(parseStyle(''), {});
  assert.deepEqual(parseStyle(null), {});
  assert.deepEqual(parseStyle('nonsense,,fill:#fff,'), { fill: '#fff' });
});
