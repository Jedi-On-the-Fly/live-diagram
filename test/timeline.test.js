import test from 'node:test';
import assert from 'node:assert/strict';
import { Timeline, normalizeEvents } from '../src/timeline.js';

const EVENTS = [
  { t: 1000, node: 'a', state: 'running' },
  { t: 1500, node: 'a', state: 'success', badge: '0.5s' },
  { t: 1500, node: 'b', state: 'running' },
  { t: 3000, node: 'b', state: 'error' }
];

function recorder() {
  const applied = [];
  let resets = 0;
  const tl = new Timeline(EVENTS, {
    apply: (patch) => applied.push(patch),
    onReset: () => { resets++; applied.length = 0; }
  });
  return { tl, applied, resets: () => resets };
}

test('events are rebased to zero and sorted', () => {
  const { events, t0, duration } = normalizeEvents([{ t: 500, node: 'b', state: 'x' }, { t: 100, node: 'a', state: 'y' }]);
  assert.equal(t0, 100);
  assert.equal(duration, 400);
  assert.deepEqual(events.map((e) => e.t), [0, 400]);
  assert.deepEqual(events[0].patch, { a: { state: 'y' } });
});

test('the {t, patch} form is accepted alongside {t, node, state}', () => {
  const { events } = normalizeEvents([{ t: 0, patch: { a: 'running', b: 'idle' } }]);
  assert.deepEqual(events[0].patch, { a: 'running', b: 'idle' });
});

test('duration is the last event, and seek clamps to it', () => {
  const { tl } = recorder();
  assert.equal(tl.duration, 2000);
  tl.seek(99999);
  assert.equal(tl.position, 2000);
  assert.equal(tl.index, 4);
});

test('seeking applies every event up to and including t', () => {
  const { tl, applied } = recorder();
  tl.seek(500); // rebased: events at 0, 500, 500, 2000
  assert.equal(applied.length, 3);
  assert.deepEqual(applied[1], { a: { state: 'success', badge: '0.5s' } });
});

test('seeking backwards refolds from zero instead of guessing an inverse', () => {
  const r = recorder();
  r.tl.seek(2000);
  assert.equal(r.applied.length, 4);
  r.tl.seek(0);
  assert.equal(r.resets(), 1, 'a backwards seek must reset');
  assert.equal(r.applied.length, 1, 'only the first event is re-applied');
  assert.equal(r.tl.position, 0);
});

test('seeking forward does not refold — the cursor is reused', () => {
  const r = recorder();
  r.tl.seek(0);
  r.tl.seek(500);
  r.tl.seek(2000);
  assert.equal(r.resets(), 0);
  assert.equal(r.applied.length, 4, 'each event applied exactly once');
});

test('step walks event by event and stops at the end', () => {
  const { tl } = recorder();
  let steps = 0;
  while (tl.step()) steps++;
  assert.equal(steps, 4);
  assert.equal(tl.step(), false);
});

test('reset rewinds without applying anything', () => {
  const r = recorder();
  r.tl.seek(2000);
  r.tl.reset();
  assert.equal(r.tl.position, 0);
  assert.equal(r.tl.index, 0);
  assert.equal(r.applied.length, 0);
});

test('an empty timeline is inert, not a crash', () => {
  const tl = new Timeline([], { apply: () => { throw new Error('must not apply'); } });
  assert.equal(tl.duration, 0);
  assert.equal(tl.length, 0);
  tl.seek(100);
  assert.equal(tl.position, 0);
});

test('play advances and ends, then releases its timer', async () => {
  const seen = [];
  const tl = new Timeline(EVENTS, { apply: (p) => seen.push(p), onEnd: () => seen.push('END') });
  tl.play({ speed: 200, fps: 60 }); // 2000ms of timeline in ~10 frames
  assert.equal(tl.playing, true);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(tl.playing, false, 'playback stops itself at the end');
  assert.equal(seen[seen.length - 1], 'END');
  assert.equal(seen.filter((s) => s !== 'END').length, 4);
  tl.destroy();
});

test('destroy stops playback', () => {
  const tl = new Timeline(EVENTS, { apply: () => {} });
  tl.play({ speed: 1 });
  tl.destroy();
  assert.equal(tl.playing, false);
});
