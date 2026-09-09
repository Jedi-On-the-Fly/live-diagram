/**
 * Mermaid state diagram source → a graph spec.
 *
 * A state diagram is the one Mermaid diagram type whose whole subject is the
 * thing this library animates. Refusing it would have been a strange gap: the
 * shapes differ, the semantics do not.
 *
 * Supported: transitions with labels, `[*]` start and stop markers (per scope),
 * `state "Label" as id`, `id : description`, composite states as groups, and
 * the `<<choice>>` / `<<fork>>` / `<<join>>` markers. Notes are read and
 * discarded — they are annotation, not structure.
 */

import { makeIdMapper, stripComments } from './parse-common.js';

const HEADER_LINE = /^stateDiagram(-v2)?\s*$/i;
const DIRECTION_LINE = /^direction\s+(TB|TD|BT|LR|RL)\s*$/i;
const ALIAS_LINE = /^state\s+"([^"]*)"\s+as\s+(\S+)\s*$/i;
const MARKER_LINE = /^state\s+(\S+)\s*<<(choice|fork|join|end)>>\s*$/i;
const COMPOSITE_LINE = /^state\s+(?:"([^"]*)"\s+as\s+)?(\S+?)\s*\{$/i;
const NOTE_LINE = /^note\s+/i;
const IGNORED_LINE = /^(classDef|class|click|style|link)\b/i;
const TRANSITION = /-->/;

const MARKER_SHAPES = { choice: 'diamond', fork: 'rect', join: 'rect', end: 'circle' };

/**
 * @param {string} source
 * @param {object} [options]
 * @param {boolean} [options.strict=false]
 * @returns {object} A graph spec: {direction, nodes, edges, groups}
 */
export function parseStateDiagram(source, options) {
  const opts = options || {};
  const text = stripComments(String(source || '')).trim();
  if (!text) throw new Error('live-diagram: empty state diagram');

  const toId = makeIdMapper();
  const nodes = {};
  const edges = [];
  const groups = [];
  const scopes = [{ name: null, group: null }];   // innermost last
  const ignored = [];
  let direction = 'TB';
  let inNote = false;

  const scope = () => scopes[scopes.length - 1];

  /** `[*]` means "the start of THIS scope", so a composite gets its own pair. */
  const terminal = (raw, asSource) => {
    const here = scope().name;
    const base = here ? `${here}_` : '';
    const id = toId(`${base}${asSource ? 'start' : 'stop'}`);
    if (!nodes[id]) {
      nodes[id] = { label: '', shape: 'circle', meta: { terminal: asSource ? 'start' : 'stop', scope: here } };
      attach(id);
    }
    return id;
  };

  const attach = (id) => {
    const group = scope().group;
    if (group && !group.nodes.includes(id)) group.nodes.push(id);
  };

  const ensure = (raw) => {
    const trimmed = String(raw).trim();
    if (trimmed === '[*]') return null;            // handled by the caller, which knows the direction
    const id = toId(trimmed);
    if (!nodes[id]) {
      nodes[id] = { label: trimmed, shape: 'rounded', meta: { mermaidId: trimmed } };
      attach(id);
    }
    return id;
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    if (inNote) { if (/^end\s+note$/i.test(line)) inNote = false; continue; }
    if (HEADER_LINE.test(line)) continue;

    const dir = line.match(DIRECTION_LINE);
    // Only the outermost direction can apply: this library draws one graph.
    if (dir) { if (scopes.length === 1) direction = dir[1].toUpperCase(); continue; }

    if (NOTE_LINE.test(line)) { if (!/:/.test(line)) inNote = true; continue; }
    if (line === '}') { if (scopes.length > 1) scopes.pop(); continue; }
    if (line === '--') continue;                    // concurrency divider: Mermaid's business

    if (IGNORED_LINE.test(line)) {
      ignored.push(line);
      if (opts.strict) throw new Error(`live-diagram: unsupported directive "${line.split(/\s/)[0]}"`);
      continue;
    }

    const composite = line.match(COMPOSITE_LINE);
    if (composite) {
      const id = toId(composite[2]);
      const group = { id, label: composite[1] || composite[2], nodes: [] };
      groups.push(group);
      // A composite is a container, not a state you can also be in.
      delete nodes[id];
      scopes.push({ name: composite[2], group });
      continue;
    }

    const marker = line.match(MARKER_LINE);
    if (marker) {
      const id = toId(marker[1]);
      nodes[id] = {
        label: MARKER_SHAPES[marker[2].toLowerCase()] === 'rect' ? '' : marker[1],
        shape: MARKER_SHAPES[marker[2].toLowerCase()] || 'rounded',
        meta: { kind: marker[2].toLowerCase() }
      };
      attach(id);
      continue;
    }

    const alias = line.match(ALIAS_LINE);
    if (alias) {
      const id = toId(alias[2]);
      nodes[id] = { ...(nodes[id] || { shape: 'rounded', meta: { mermaidId: alias[2] } }), label: alias[1] };
      attach(id);
      continue;
    }

    if (TRANSITION.test(line)) {
      const [left, rest] = splitOnce(line, '-->');
      const [right, label] = splitOnce(rest, ':');
      const fromRaw = left.trim();
      const toRaw = right.trim();
      const from = fromRaw === '[*]' ? terminal(fromRaw, true) : ensure(fromRaw);
      const to = toRaw === '[*]' ? terminal(toRaw, false) : ensure(toRaw);
      if (from && to) edges.push({ from, to, label: (label || '').trim(), condition: 'always' });
      continue;
    }

    // `id : description` — the second line Mermaid draws inside a state.
    const [name, description] = splitOnce(line, ':');
    if (description !== null && name.trim() && !/\s/.test(name.trim())) {
      const id = ensure(name.trim());
      if (id) nodes[id].description = description.trim();
      continue;
    }

    // A state mentioned on its own line, with no transition.
    if (!/\s/.test(line)) { ensure(line); continue; }

    ignored.push(line);
    if (opts.strict) throw new Error(`live-diagram: cannot parse "${line}" in a state diagram`);
  }

  // A transition can name a composite state, which is a container here, not a
  // node — and it may be named before it is declared. Resolving it afterwards
  // handles both orders: entering a composite means entering its start,
  // leaving one means leaving its stop.
  for (const group of groups) {
    if (!group.nodes.length) continue;
    const entry = group.nodes.find((id) => nodes[id] && nodes[id].meta && nodes[id].meta.terminal === 'start') || group.nodes[0];
    const exit = group.nodes.find((id) => nodes[id] && nodes[id].meta && nodes[id].meta.terminal === 'stop') || group.nodes[group.nodes.length - 1];
    delete nodes[group.id];
    for (const edge of edges) {
      if (edge.to === group.id) edge.to = entry;
      if (edge.from === group.id) edge.from = exit;
    }
  }
  const groupIds = new Set(groups.map((g) => g.id));
  const resolved = edges.filter((edge) => edge.from !== edge.to
    && !groupIds.has(edge.from) && !groupIds.has(edge.to)
    && nodes[edge.from] && nodes[edge.to]);

  if (!Object.keys(nodes).length) throw new Error('live-diagram: no states found');

  const spec = { direction, nodes, edges: resolved, groups: groups.filter((g) => g.nodes.length) };
  if (ignored.length) Object.defineProperty(spec, 'ignored', { value: ignored, enumerable: false });
  return spec;
}

/** Splits on the first occurrence only; returns [before, after|null]. */
function splitOnce(text, separator) {
  const at = text.indexOf(separator);
  if (at === -1) return [text, null];
  return [text.slice(0, at), text.slice(at + separator.length)];
}
