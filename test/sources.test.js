import test from 'node:test';
import assert from 'node:assert/strict';
import { webSocketSource, eventSourceSource, pollSource } from '../src/sources.js';

class FakeSocket {
  static last = null;
  constructor(url) { this.url = url; this.handlers = {}; this.closed = false; FakeSocket.last = this; }
  addEventListener(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); }
  close() { this.closed = true; this.fire('close', {}); }
  fire(name, payload) { (this.handlers[name] || []).forEach((fn) => fn(payload)); }
  message(data) { this.fire('message', { data: typeof data === 'string' ? data : JSON.stringify(data) }); }
}

test('webSocketSource parses JSON and forwards patches', () => {
  globalThis.WebSocket = FakeSocket;
  const patches = [];
  const src = webSocketSource('ws://x', { retryMs: 0 });
  src.start((p) => patches.push(p));
  FakeSocket.last.message({ build: 'running' });
  assert.deepEqual(patches, [{ build: 'running' }]);
  src.stop();
});

test('webSocketSource lets `parse` drop uninteresting messages', () => {
  globalThis.WebSocket = FakeSocket;
  const patches = [];
  const src = webSocketSource('ws://x', {
    retryMs: 0,
    parse: (msg) => (msg.type === 'node_status' ? { [msg.nodeId]: msg.status } : null)
  });
  src.start((p) => patches.push(p));
  FakeSocket.last.message({ type: 'log', line: 'noise' });
  FakeSocket.last.message({ type: 'node_status', nodeId: 'a', status: 'success' });
  assert.deepEqual(patches, [{ a: 'success' }]);
  src.stop();
});

test('webSocketSource survives a non-JSON payload', () => {
  globalThis.WebSocket = FakeSocket;
  const patches = [];
  const src = webSocketSource('ws://x', { retryMs: 0, parse: (msg) => (typeof msg === 'string' ? null : msg) });
  src.start((p) => patches.push(p));
  FakeSocket.last.message('not json at all');
  assert.deepEqual(patches, []);
  src.stop();
});

test('webSocketSource reconnects, and stop() means stop', async () => {
  globalThis.WebSocket = FakeSocket;
  const src = webSocketSource('ws://x', { retryMs: 5 });
  src.start(() => {});
  const first = FakeSocket.last;
  first.fire('close', {});
  await new Promise((r) => setTimeout(r, 20));
  assert.notEqual(FakeSocket.last, first, 'reconnected');
  src.stop();
  const afterStop = FakeSocket.last;
  afterStop.fire('close', {});
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(FakeSocket.last, afterStop, 'no reconnection after stop');
});

test('eventSourceSource subscribes to the named events', () => {
  const listeners = {};
  globalThis.EventSource = class {
    constructor(url) { this.url = url; }
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); }
    close() { this.closed = true; }
  };
  const patches = [];
  const src = eventSourceSource('/stream', { events: ['status'] });
  src.start((p) => patches.push(p));
  listeners.status[0]({ data: '{"a":"running"}' });
  assert.deepEqual(patches, [{ a: 'running' }]);
  src.stop();
});

test('pollSource polls, chains rather than stacks, and stops clean', async () => {
  let calls = 0;
  const src = pollSource(async () => { calls++; return { a: calls === 1 ? 'running' : 'success' }; }, { interval: 10 });
  const patches = [];
  src.start((p) => patches.push(p));
  await new Promise((r) => setTimeout(r, 45));
  src.stop();
  const seen = calls;
  assert.ok(calls >= 3, `polled repeatedly (got ${calls})`);
  assert.deepEqual(patches[0], { a: 'running' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, seen, 'no polling after stop');
});

test('a poll that throws is reported, not fatal', async () => {
  const problems = [];
  const src = pollSource(async () => { throw new Error('boom'); }, { interval: 5 });
  src.start(() => {}, (kind, detail) => problems.push([kind, detail.message]));
  await new Promise((r) => setTimeout(r, 20));
  src.stop();
  assert.equal(problems[0][0], 'error');
  assert.equal(problems[0][1], 'boom');
});

test('immediate:false waits one interval before the first poll', async () => {
  let calls = 0;
  const src = pollSource(async () => { calls++; return null; }, { interval: 30, immediate: false });
  src.start(() => {});
  assert.equal(calls, 0);
  await new Promise((r) => setTimeout(r, 45));
  src.stop();
  assert.equal(calls, 1);
});
