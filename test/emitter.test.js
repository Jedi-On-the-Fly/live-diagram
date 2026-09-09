import test from 'node:test';
import assert from 'node:assert/strict';
import { Emitter } from '../src/emitter.js';

test('on returns an unsubscribe function', () => {
  const e = new Emitter();
  const seen = [];
  const off = e.on('x', (v) => seen.push(v));
  e.emit('x', 1);
  off();
  e.emit('x', 2);
  assert.deepEqual(seen, [1]);
});

test('once fires exactly once', () => {
  const e = new Emitter();
  let calls = 0;
  e.once('x', () => calls++);
  e.emit('x'); e.emit('x');
  assert.equal(calls, 1);
});

test('a throwing handler does not break the emit loop', () => {
  const e = new Emitter();
  const seen = [];
  e.on('x', () => { throw new Error('bad handler'); });
  e.on('x', () => seen.push('second handler still ran'));
  const errors = [];
  e.on('error', (err) => errors.push(err));
  e.emit('x');
  assert.equal(seen.length, 1);
  assert.equal(errors[0].source, 'handler:x');
});

test('a throwing error handler cannot recurse forever', () => {
  const e = new Emitter();
  e.on('error', () => { throw new Error('error handler is broken too'); });
  assert.doesNotThrow(() => e.emit('error', { source: 'test' }));
});

test('off with no handler drops the whole event', () => {
  const e = new Emitter();
  e.on('x', () => { throw new Error('should not run'); });
  e.off('x');
  assert.equal(e.emit('x'), 0);
});

test('on rejects a non-function loudly', () => {
  assert.throws(() => new Emitter().on('x', 'nope'), TypeError);
});
