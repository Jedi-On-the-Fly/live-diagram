/*! live-diagram v0.4.2 — Turn a Mermaid diagram into a live control surface: push state in, get clicks out, replay the whole thing.
 *  https://mistamid.github.io/live-diagram/demo/
 *  MIT licensed. Built by scripts/build.js — do not edit dist/ by hand.
 */
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  factory({}, global);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (exports, global) {
  'use strict';

  // ── src/emitter.js ────────────────────────────────────────────
  /**
   * A ~30-line event emitter. Deliberately not an npm dependency: the whole
   * library is meant to drop into a page with no build step, and one more
   * transitive package is one more reason not to.
   */

  class Emitter {
    constructor() {
      this._handlers = new Map();
    }

    /**
     * Subscribes to an event.
     * @param {string} event
     * @param {function} handler
     * @returns {function(): void} Unsubscribe function.
     */
    on(event, handler) {
      if (typeof handler !== 'function') throw new TypeError('on(event, handler): handler must be a function');
      if (!this._handlers.has(event)) this._handlers.set(event, new Set());
      this._handlers.get(event).add(handler);
      return () => this.off(event, handler);
    }

    /** Subscribes for exactly one delivery. */
    once(event, handler) {
      const off = this.on(event, (payload) => { off(); handler(payload); });
      return off;
    }

    /** Unsubscribes a handler (or every handler for the event). */
    off(event, handler) {
      if (!this._handlers.has(event)) return;
      if (!handler) { this._handlers.delete(event); return; }
      this._handlers.get(event).delete(handler);
    }

    /**
     * Emits an event. A throwing handler never breaks the emit loop or the
     * render that triggered it — it is reported on the `error` channel instead.
     */
    emit(event, payload) {
      const set = this._handlers.get(event);
      if (!set || set.size === 0) return 0;
      let delivered = 0;
      for (const handler of Array.from(set)) {
        try { handler(payload); delivered++; } catch (err) {
          if (event === 'error') continue; // never recurse
          this.emit('error', { source: `handler:${event}`, error: err });
        }
      }
      return delivered;
    }

    /** Drops every subscription. */
    clear() { this._handlers.clear(); }
  }

  // ── src/parse-common.js ───────────────────────────────────────
  /**
   * Pieces both Mermaid parsers need.
   *
   * They live here rather than in one parser importing the other, because the
   * flowchart parser dispatches to the state parser and the bundle allows no
   * cycles — a rule that costs one small file and buys a build that cannot fail
   * at load time.
   */

  // Node ids are bare words in the emitted definition; anything else would need
  // escaping we would then have to reverse when mapping SVG elements back.
  const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

  /**
   * Rewrites source ids into ids this library can emit, remembering the mapping
   * so both ends of every edge follow the same rewrite.
   * @returns {function(string): string}
   */
  function makeIdMapper() {
    const map = new Map();
    const taken = new Set();
    return (raw) => {
      const key = String(raw).trim();
      if (map.has(key)) return map.get(key);
      let id = key.replace(/[^\w]/g, '_').replace(/^_+/, '').replace(/^(\d)/, 'n$1');
      if (!id) id = 'n';
      if (!SAFE_ID.test(id)) id = `n_${id}`;
      let unique = id;
      let n = 2;
      while (taken.has(unique)) unique = `${id}_${n++}`;
      taken.add(unique);
      map.set(key, unique);
      return unique;
    };
  }

  /** Strips `%%` comments and `%%{init}%%` directives without touching quoted text. */
  function stripComments(source) {
    return source
      .replace(/%%\{[\s\S]*?\}%%/g, '')
      .split('\n')
      .map((line) => {
        let quoted = false;
        for (let i = 0; i < line.length - 1; i++) {
          if (line[i] === '"') quoted = !quoted;
          if (!quoted && line[i] === '%' && line[i + 1] === '%') return line.slice(0, i);
        }
        return line;
      })
      .join('\n');
  }

  // ── src/parse-state.js ────────────────────────────────────────
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
  function parseStateDiagram(source, options) {
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

  // ── src/parse-mermaid.js ──────────────────────────────────────
  /**
   * Mermaid flowchart source → a graph spec.
   *
   * The library's own format is JSON, which is right for a program and wrong for
   * a person: anyone who would want a live diagram already has a Mermaid one,
   * written by hand, sitting in a README. Asking them to translate it first is a
   * tax paid before they have seen the thing work.
   *
   * This parses the flowchart subset — nodes, shapes, every edge form, chains,
   * `&` groups and subgraphs — and refuses everything else with a message that
   * says what it got. It is not a Mermaid implementation and does not try to be:
   * layout, styling directives and the other twelve diagram types stay Mermaid's
   * job.
   */

  // Deliberately no import from graph.js: that module imports this one, and the
  // bundle is a single scope with no cycles allowed.



  const DIAGRAM_TYPES = /^(sequenceDiagram|classDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|requirementDiagram|gitGraph|C4Context|sankey(-beta)?|xychart(-beta)?|block(-beta)?|packet(-beta)?|architecture(-beta)?)\b/;
  const STATE_DIAGRAM = /^stateDiagram(-v2)?\b/;
  const HEADER = /^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)?\s*$/i;
  const DIRECTIVE = /^(?:click|style|classDef|class|linkStyle|linkStyle|accTitle|accDescr)\b/;
  const SUBGRAPH = /^subgraph\s+(.*)$/i;

  // Longest wrappers first: `id[["x"]]` must not be read as `id["` + `"x"]]`.
  const SHAPE_WRAPPERS = [
    ['(((', ')))', 'circle'],
    ['((', '))', 'circle'],
    ['([', '])', 'stadium'],
    ['[[', ']]', 'subroutine'],
    ['[(', ')]', 'cylinder'],
    ['{{', '}}', 'hex'],
    ['[', ']', 'rect'],
    ['(', ')', 'rounded'],
    ['{', '}', 'diamond'],
    ['>', ']', 'rect']            // asymmetric shape; drawn as a box
  ];

  // Edge operators, longest first: at a given position `-.->` must win over
  // `-.-`, and `-->` over `--`.
  const OPERATORS = [
    '<-.->', '<-->', '<==>', '-.->', '-.-', '<--', '==>', '===', '-->', '---', '--o', '--x', '==', '--'
  ].sort((a, b) => b.length - a.length);

  /** `id["Label"]` → {id, label, shape}. A bare id keeps its own text as the label. */
  function parseNode(text, toId) {
    const raw = text.trim();
    if (!raw) return null;

    for (const [open, close, shape] of SHAPE_WRAPPERS) {
      const at = raw.indexOf(open);
      if (at <= 0 || !raw.endsWith(close)) continue;
      const id = raw.slice(0, at).trim();
      let label = raw.slice(at + open.length, raw.length - close.length).trim();
      if ((label.startsWith('"') && label.endsWith('"')) || (label.startsWith("'") && label.endsWith("'"))) {
        label = label.slice(1, -1);
      }
      return { id: toId(id), label: label || id, shape, mermaidId: id };
    }

    if (/\s/.test(raw)) {
      throw new Error(`live-diagram: cannot parse "${raw}" — a node id cannot contain spaces; write it as id["${raw}"]`);
    }
    return { id: toId(raw), label: raw, shape: 'rect', mermaidId: raw };
  }

  /**
   * Rewrites the label-in-the-middle edge forms into the pipe form, so the
   * splitter below only has to know one shape:
   *   A -- yes --> B    →   A -->|yes| B
   */
  function normalizeEdgeLabels(line) {
    return line
      .replace(/--\s+([^->|\n]+?)\s+-->/g, '-->|$1|')
      .replace(/--\s+([^->|\n]+?)\s+---/g, '---|$1|')
      .replace(/-\.\s*([^.|\n]+?)\s*\.->/g, '-.->|$1|')
      .replace(/==\s*([^=|\n]+?)\s*==>/g, '==>|$1|');
  }

  /**
   * Splits on a character only where it is not inside quotes or brackets.
   * `a["Build & sign (v2)"] & b` is two segments, not three.
   */
  function splitTop(text, separator) {
    const out = [];
    let depth = 0;
    let quoted = false;
    let current = '';
    for (const ch of String(text)) {
      if (ch === '"') quoted = !quoted;
      if (!quoted) {
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        else if (ch === separator && depth === 0) { out.push(current); current = ''; continue; }
      }
      current += ch;
    }
    out.push(current);
    return out;
  }

  /** The first edge operator at bracket depth zero, outside any quoted label. */
  function findOperator(text) {
    let depth = 0;
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') { quoted = !quoted; continue; }
      if (quoted) continue;
      if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }
      if (depth > 0) continue;
      for (const op of OPERATORS) if (text.startsWith(op, i)) return { at: i, op };
    }
    return null;
  }

  /** Splits a statement into segments and the operators between them. */
  function splitEdges(line) {
    const parts = [];
    const ops = [];
    let rest = line;

    while (rest.length) {
      const best = findOperator(rest);
      if (!best) { parts.push(rest); break; }

      parts.push(rest.slice(0, best.at));
      let after = rest.slice(best.at + best.op.length);
      let label = '';
      const labelled = after.match(/^\s*\|([^|]*)\|/);
      if (labelled) { label = labelled[1].trim(); after = after.slice(labelled[0].length); }
      ops.push({ op: best.op, label });
      rest = after;
    }
    return { parts: parts.map((p) => p.trim()), ops };
  }

  /**
   * Parses Mermaid flowchart source.
   *
   * @param {string} source
   * @param {object} [options]
   * @param {boolean} [options.strict=false] - Throw on directives it ignores
   * @returns {object} A graph spec: {direction, nodes, edges, groups}
   */
  function parseMermaid(source, options) {
    const opts = options || {};
    const text = stripComments(String(source || '')).trim();
    if (!text) throw new Error('live-diagram: empty Mermaid source');

    // A state diagram IS a graph of states, which is what this library renders;
    // it just says so in different syntax.
    if (STATE_DIAGRAM.test(text)) return parseStateDiagram(text, opts);

    const kind = text.match(DIAGRAM_TYPES);
    if (kind) {
      throw new Error(`live-diagram renders flowcharts; this is a ${kind[1]}. Convert it, or pass a graph object instead.`);
    }

    const toId = makeIdMapper();
    const nodes = {};
    const edges = [];
    const groups = [];
    const stack = [];
    const ignored = [];
    let direction = 'TB';
    let sawHeader = false;

    const statements = text
      .split('\n')
      .flatMap((line) => line.split(';'))
      .map((line) => line.trim())
      .filter(Boolean);

    const ensure = (node) => {
      const existing = nodes[node.id];
      if (!existing) {
        nodes[node.id] = { label: node.label, shape: node.shape, meta: { mermaidId: node.mermaidId } };
      } else {
        // A later, richer declaration wins: `a --> b` then `b["Beta"]`.
        if (existing.label === existing.meta.mermaidId && node.label !== node.mermaidId) existing.label = node.label;
        if (existing.shape === 'rect' && node.shape !== 'rect') existing.shape = node.shape;
      }
      if (stack.length) {
        const group = stack[stack.length - 1];
        if (!group.nodes.includes(node.id)) group.nodes.push(node.id);
      }
      return node.id;
    };

    for (const statement of statements) {
      const header = statement.match(HEADER);
      if (header && !sawHeader) {
        sawHeader = true;
        if (header[1]) direction = header[1].toUpperCase();
        continue;
      }

      if (/^end$/i.test(statement)) { stack.pop(); continue; }

      const subgraph = statement.match(SUBGRAPH);
      if (subgraph) {
        const rest = subgraph[1].trim();
        const titled = rest.match(/^(\S+)\s*\[\s*"?(.*?)"?\s*\]$/);
        const id = toId(titled ? titled[1] : rest.replace(/^"|"$/g, ''));
        const label = titled ? titled[2] : rest.replace(/^"|"$/g, '');
        const group = { id, label: label || id, nodes: [] };
        groups.push(group);
        stack.push(group);
        continue;
      }

      if (/^direction\s+/i.test(statement)) continue;   // per-subgraph direction: Mermaid's business

      if (DIRECTIVE.test(statement)) {
        ignored.push(statement);
        if (opts.strict) throw new Error(`live-diagram: unsupported directive "${statement.split(/\s/)[0]}"`);
        continue;
      }

      const { parts, ops } = splitEdges(normalizeEdgeLabels(statement));

      if (!ops.length) {
        // A standalone node declaration.
        for (const piece of splitTop(parts[0], '&')) {
          const node = parseNode(piece, toId);
          if (node) ensure(node);
        }
        continue;
      }

      // A chain: a --> b --> c, where any side may be `x & y`.
      let previous = splitTop(parts[0], '&').map((piece) => ensure(parseNode(piece, toId)));
      for (let i = 0; i < ops.length; i++) {
        const next = splitTop(parts[i + 1] || '', '&').map((piece) => parseNode(piece, toId)).filter(Boolean).map(ensure);
        const dotted = ops[i].op.includes('.');
        for (const from of previous) {
          for (const to of next) {
            edges.push({
              from,
              to,
              label: ops[i].label || '',
              // A dotted arrow in Mermaid is the same "not the default path" idea
              // this library draws dotted, so it survives a round trip.
              condition: dotted ? 'dotted' : 'always'
            });
          }
        }
        previous = next;
      }
    }

    if (!Object.keys(nodes).length) {
      throw new Error('live-diagram: no nodes found — is this a flowchart?');
    }

    const spec = { direction, nodes, edges, groups: groups.filter((g) => g.nodes.length) };
    if (ignored.length) Object.defineProperty(spec, 'ignored', { value: ignored, enumerable: false });
    return spec;
  }

  /** @returns {boolean} Whether a string looks like Mermaid source rather than JSON. */
  function looksLikeMermaid(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
    return /^(flowchart|graph|stateDiagram)\b/i.test(trimmed) || /(-->|---|-\.->|==>)/.test(trimmed);
  }

  // ── src/graph.js ──────────────────────────────────────────────
  /**
   * The graph model: plain data in, validated plain data out.
   *
   * Structure and state are kept apart on purpose. A graph describes what the
   * boxes ARE; it never says how they are doing. That separation is what makes
   * replay, diffing and live streaming fall out of the same code path — the
   * state channel is the only thing that moves.
   */

  /**
   * @typedef {Object} GraphNode
   * @property {string} [label] - Displayed text (defaults to the node id)
   * @property {'rect'|'rounded'|'stadium'|'diamond'|'circle'|'hex'|'subroutine'|'cylinder'} [shape]
   * @property {string} [description] - Rendered as the node's title attribute
   * @property {string} [class] - A Mermaid classDef name
   * @property {object} [meta] - Anything of your own; carried through untouched
   */

  /**
   * @typedef {Object} GraphEdge
   * @property {string} from
   * @property {string} to
   * @property {string} [id] - Defaults to `from->to`; needed only for parallel edges
   * @property {string} [label]
   * @property {string} [condition] - Anything but 'always' draws a dotted edge
   * @property {string} [style]
   */

  /**
   * @typedef {Object} GraphGroup
   * @property {string} id
   * @property {string} [label]
   * @property {Array<string>} nodes
   */

  /**
   * @typedef {Object} GraphSpec
   * @property {'TB'|'TD'|'BT'|'LR'|'RL'} [direction]
   * @property {Object.<string, GraphNode|string>} nodes
   * @property {Array<GraphEdge>} [edges]
   * @property {Array<GraphGroup>} [groups]
   */



  const DIRECTIONS = ['TB', 'TD', 'BT', 'LR', 'RL'];
  const SHAPES = ['rounded', 'stadium', 'rect', 'diamond', 'circle', 'hex', 'subroutine', 'cylinder'];

  // Mermaid ids are bare words in the diagram source; anything else would need
  // escaping we would then have to reverse when mapping SVG elements back to
  // nodes. Rejecting loudly at construction beats a mystery at render time.
  const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

  /** @returns {boolean} Whether an id is safe to emit into a diagram definition. */
  function isValidId(id) {
    return typeof id === 'string' && ID_PATTERN.test(id);
  }

  /**
   * Escapes a label for use inside a quoted Mermaid string.
   * @param {string} label
   */
  function escapeLabel(label) {
    return String(label == null ? '' : label)
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br/>');
  }

  /**
   * Normalizes and validates a graph definition.
   *
   * Mermaid source is accepted directly: anyone who wants a live diagram already
   * has one written by hand, and asking them to translate it into JSON first is a
   * tax paid before they have seen anything work.
   *
   * @param {GraphSpec|string} graph - A graph spec, or Mermaid flowchart source
   * @returns {object} A frozen, normalized graph.
   */
  function normalizeGraph(graph) {
    if (typeof graph === 'string') return normalizeGraph(parseMermaid(graph));
    if (!graph || typeof graph !== 'object') throw new TypeError('graph must be an object or Mermaid source');
    if (!graph.nodes || typeof graph.nodes !== 'object') throw new TypeError('graph.nodes must be an object');

    const direction = DIRECTIONS.includes(graph.direction) ? graph.direction : 'TB';
    const nodes = {};

    for (const id of Object.keys(graph.nodes)) {
      if (!isValidId(id)) {
        throw new Error(`Invalid node id "${id}": ids must match ${ID_PATTERN} (letters, digits, underscore; not starting with a digit)`);
      }
      const raw = graph.nodes[id] || {};
      const node = typeof raw === 'string' ? { label: raw } : raw;
      // Frozen entry by entry, because "the library never mutates your graph" is
      // only checkable when nobody else can either. `meta` is the one exception:
      // it is declared as the caller's own object, carried through untouched, and
      // freezing something they still hold would reach further than the promise.
      nodes[id] = Object.freeze({
        label: node.label == null ? id : String(node.label),
        shape: SHAPES.includes(node.shape) ? node.shape : 'rect',
        description: node.description == null ? '' : String(node.description),
        class: node.class == null ? '' : String(node.class),
        meta: node.meta && typeof node.meta === 'object' ? node.meta : {}
      });
    }

    const ids = new Set(Object.keys(nodes));
    const edgeIds = new Set();
    const edges = (Array.isArray(graph.edges) ? graph.edges : []).map((edge, i) => {
      if (!edge || typeof edge !== 'object') throw new TypeError(`graph.edges[${i}] must be an object`);
      if (!ids.has(edge.from)) throw new Error(`graph.edges[${i}] references unknown node "${edge.from}" as \`from\``);
      if (!ids.has(edge.to)) throw new Error(`graph.edges[${i}] references unknown node "${edge.to}" as \`to\``);
      // Edges are addressable so they can carry state. `build->test` is what a
      // person types; node ids cannot contain `-` or `>`, so it cannot collide
      // with one. Parallel edges get a suffix rather than silently merging.
      let id = edge.id || `${edge.from}->${edge.to}`;
      if (edgeIds.has(id)) {
        let n = 2;
        while (edgeIds.has(`${id}#${n}`)) n++;
        id = `${id}#${n}`;
      }
      edgeIds.add(id);
      return Object.freeze({
        id,
        from: edge.from,
        to: edge.to,
        label: edge.label == null ? '' : String(edge.label),
        // `condition` is free-form and means nothing to this library beyond
        // "not the default path" — anything other than 'always' draws dotted.
        condition: edge.condition == null ? 'always' : String(edge.condition),
        style: edge.style == null ? '' : String(edge.style)
      });
    });

    const groups = (Array.isArray(graph.groups) ? graph.groups : []).map((group, i) => {
      if (!group || !isValidId(group.id)) throw new Error(`graph.groups[${i}].id must be a valid id`);
      const members = (Array.isArray(group.nodes) ? group.nodes : []).filter((n) => ids.has(n));
      return Object.freeze({ id: group.id, label: group.label == null ? group.id : String(group.label), nodes: Object.freeze(members) });
    });

    return Object.freeze({ direction, nodes: Object.freeze(nodes), edges: Object.freeze(edges), groups: Object.freeze(groups) });
  }

  /** @returns {Array<string>} Node ids in declaration order. */
  function nodeIds(graph) {
    return Object.keys(graph.nodes);
  }

  /** @returns {Array<string>} Edge ids in declaration order. */
  function edgeIds(graph) {
    return graph.edges.map((edge) => edge.id);
  }

  // ── src/states.js ─────────────────────────────────────────────
  /**
   * The state vocabulary: a status is a name, and a name maps to a visual
   * treatment. Declaratively, in data — not as a switch statement inside a
   * render function.
   *
   * This is the single idea most worth stealing from this library. Once "how a
   * running node looks" is config, a design change is a config change, a new
   * status is a new key, and the renderer never grows a branch.
   */

  /**
   * A usable default vocabulary, so `new LiveDiagram({graph})` draws something
   * sensible before you have made any decisions. Every entry carries a light and
   * a dark treatment; the renderer picks one.
   */
  const DEFAULT_STATES = {
    idle:    { icon: '○', label: 'Idle',    style: 'fill:#f1f5f9,stroke:#94a3b8,color:#475569',
               darkStyle: 'fill:#1e293b,stroke:#64748b,color:#94a3b8',
               edgeStyle: 'stroke:#94a3b8', darkEdgeStyle: 'stroke:#475569' },
    queued:  { icon: '◌', label: 'Queued',  style: 'fill:#eef2ff,stroke:#a5b4fc,color:#4338ca',
               darkStyle: 'fill:#1e1b4b,stroke:#818cf8,color:#c7d2fe',
               edgeStyle: 'stroke:#a5b4fc', darkEdgeStyle: 'stroke:#818cf8' },
    running: { icon: '▶', label: 'Running', style: 'fill:#fef9c3,stroke:#ca8a04,color:#713f12',
               darkStyle: 'fill:#854d0e,stroke:#facc15,color:#fef9c3',
               edgeStyle: 'stroke:#ca8a04,stroke-width:2px', darkEdgeStyle: 'stroke:#facc15,stroke-width:2px' },
    waiting: { icon: '⏸', label: 'Waiting', style: 'fill:#e0e7ff,stroke:#6366f1,color:#3730a3',
               darkStyle: 'fill:#312e81,stroke:#818cf8,color:#c7d2fe',
               edgeStyle: 'stroke:#6366f1', darkEdgeStyle: 'stroke:#818cf8' },
    success: { icon: '✓', label: 'Success', style: 'fill:#dcfce7,stroke:#16a34a,color:#14532d',
               darkStyle: 'fill:#14532d,stroke:#4ade80,color:#bbf7d0',
               edgeStyle: 'stroke:#16a34a,stroke-width:2px', darkEdgeStyle: 'stroke:#4ade80,stroke-width:2px' },
    error:   { icon: '✗', label: 'Error',   style: 'fill:#fee2e2,stroke:#dc2626,color:#7f1d1d',
               darkStyle: 'fill:#7f1d1d,stroke:#f87171,color:#fecaca',
               edgeStyle: 'stroke:#dc2626,stroke-width:2px', darkEdgeStyle: 'stroke:#f87171,stroke-width:2px' },
    skipped: { icon: '↷', label: 'Skipped', style: 'fill:#f8fafc,stroke:#cbd5e1,color:#94a3b8',
               darkStyle: 'fill:#1e293b,stroke:#475569,color:#64748b',
               edgeStyle: 'stroke:#cbd5e1,stroke-dasharray:3 4', darkEdgeStyle: 'stroke:#475569,stroke-dasharray:3 4' }
  };

  /**
   * Rewrites `rgb()` / `rgba()` / `hsl()` / `hsla()` colours in a style string
   * to hex.
   *
   * Two parsers downstream cannot take the functional forms: Mermaid's style
   * grammar splits declarations on commas and refuses `fill:rgba(255,0,0,.5)`
   * outright (8-digit hex passes), and this library's own repaint path splits
   * the same way. Hex says the same thing and survives both, so the conversion
   * happens once, here, and nothing downstream ever meets a comma inside a
   * colour. A colour that cannot be converted — `var()`, a `turn` hue — is left
   * exactly as written rather than half-translated.
   *
   * @param {?string} style - A comma-separated style string
   * @returns {string}
   */
  function hexifyColors(style) {
    return String(style || '').replace(/\b(rgba?|hsla?)\(([^()]*)\)/gi, (whole, fn, body) => {
      const parts = body.split(/[,\s/]+/).filter((p) => p !== '');
      if (parts.length < 3 || parts.length > 4) return whole;
      const channel = (raw, scale) => {
        const value = raw.endsWith('%') ? (parseFloat(raw) / 100) * scale : parseFloat(raw);
        return Number.isFinite(value) ? Math.min(Math.max(value, 0), scale) : NaN;
      };
      let rgb;
      if (fn.toLowerCase().startsWith('rgb')) {
        rgb = [channel(parts[0], 255), channel(parts[1], 255), channel(parts[2], 255)];
      } else {
        if (/turn|rad/i.test(parts[0])) return whole;   // only degree hues are worth the code
        const h = ((parseFloat(parts[0]) % 360) + 360) % 360;
        const s = channel(parts[1], 100) / 100;
        const l = channel(parts[2], 100) / 100;
        if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return whole;
        const f = (n) => {
          const k = (n + h / 30) % 12;
          return (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
        };
        rgb = [f(0), f(8), f(4)];
      }
      const alpha = parts.length === 4 ? channel(parts[3], 1) : 1;
      if (rgb.some((v) => !Number.isFinite(v)) || !Number.isFinite(alpha)) return whole;
      const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
      return `#${rgb.map(hex).join('')}${alpha < 1 ? hex(alpha * 255) : ''}`;
    });
  }

  /**
   * Merges a caller's vocabulary over the defaults.
   *
   * Passing `{running: {style: '…'}}` overrides one treatment and keeps the rest;
   * passing `{extend: false}` in options starts from an empty vocabulary instead.
   *
   * @param {?object} states
   * @param {object} [options]
   * @param {boolean} [options.extend=true]
   */
  function normalizeStates(states, options) {
    const extend = !options || options.extend !== false;
    const base = extend ? DEFAULT_STATES : {};
    const out = {};
    for (const name of Object.keys(base)) out[name] = { ...base[name] };
    for (const name of Object.keys(states || {})) {
      const raw = states[name] || {};
      const entry = typeof raw === 'string' ? { style: raw } : raw;
      out[name] = { ...(out[name] || {}), ...entry };
    }
    for (const name of Object.keys(out)) {
      const e = out[name];
      e.icon = e.icon == null ? '' : String(e.icon);
      e.label = e.label == null ? name : String(e.label);
      e.style = e.style == null ? '' : hexifyColors(e.style);
      e.class = e.class == null ? '' : String(e.class);
      e.darkStyle = e.darkStyle == null ? e.style : hexifyColors(e.darkStyle);
      // An edge treatment is optional: a vocabulary that only describes nodes
      // borrows the node's stroke, which is the colour a reader already
      // associates with that state. The styles are hex by this point, so the
      // capture cannot stop halfway through an rgba().
      if (e.edgeStyle == null) {
        const stroke = /stroke:\s*([^,;]+)/.exec(e.style);
        e.edgeStyle = stroke ? `stroke:${stroke[1].trim()}` : '';
      } else {
        e.edgeStyle = hexifyColors(e.edgeStyle);
      }
      if (e.darkEdgeStyle == null) {
        const stroke = /stroke:\s*([^,;]+)/.exec(e.darkStyle);
        e.darkEdgeStyle = stroke ? `stroke:${stroke[1].trim()}` : e.edgeStyle;
      } else {
        e.darkEdgeStyle = hexifyColors(e.darkEdgeStyle);
      }
    }
    return out;
  }

  /**
   * Resolves the EDGE style string for a state under a theme.
   * @param {object} states - Normalized vocabulary
   * @param {string} name
   * @param {string} theme - 'light' | 'dark'
   */
  function edgeStyleFor(states, name, theme) {
    const entry = states[name];
    if (!entry) return '';
    return theme === 'dark' ? (entry.darkEdgeStyle || entry.edgeStyle) : entry.edgeStyle;
  }

  /**
   * Resolves the style string for a state under a theme.
   * @param {object} states - Normalized vocabulary
   * @param {string} name
   * @param {string} theme - 'light' | 'dark'
   */
  function styleFor(states, name, theme) {
    const entry = states[name];
    if (!entry) return '';
    return theme === 'dark' ? (entry.darkStyle || entry.style) : entry.style;
  }

  // ── src/state.js ──────────────────────────────────────────────
  /**
   * The state channel.
   *
   * Everything that changes about a diagram after it is drawn goes through
   * `patch()`. There is no second path — no direct mutation, no "just set this
   * one node". One entry point is what makes the timeline, live streaming and
   * two-run diffing the same feature wearing different hats.
   *
   * A patch reports whether it was STRUCTURAL (a node changed state, so the
   * diagram definition must be rebuilt) or merely decorative (a badge or a data
   * payload changed, so the overlay is enough). Re-parsing a diagram to move a
   * "42s" label is the kind of waste that makes people write their own.
   */

  /**
   * @typedef {Object} PatchEntry
   * @property {string} [state] - The new state name
   * @property {?string} [badge] - Chip text; null clears it
   * @property {?object} [data] - Payload carried on the node; null clears it
   * @property {boolean} [merge] - Layer `data` onto the previous payload
   */

  /**
   * A patch: node id to a state name, or to a PatchEntry.
   * @typedef {Object.<string, string|PatchEntry>} StatePatch
   */

  /**
   * @param {object} options
   * @param {Array<string>} options.nodes - Known node ids
   * @param {Array<string>} [options.edges] - Known edge ids
   * @param {string} [options.defaultState='idle']
   * @param {boolean} [options.strict=false] - Throw instead of reporting unknown ids
   */
  class StateStore {
    constructor(options) {
      const opts = options || {};
      this.defaultState = opts.defaultState || 'idle';
      this.strict = opts.strict === true;
      this.known = new Set(opts.nodes || []);
      this.knownEdges = new Set(opts.edges || []);
      this.states = {};
      this.badges = {};
      this.data = {};
      // Edges live in their own maps rather than sharing `states`: a snapshot has
      // to stay a map of NODE states, or every consumer of one (restore, diff,
      // the legend's counts) would silently start counting edges too.
      this.edges = {};
      this.edgeData = {};
      for (const id of this.known) this.states[id] = this.defaultState;
      for (const id of this.knownEdges) this.edges[id] = this.defaultState;
    }

    /** Replaces the set of known edges (after a graph swap). */
    setEdges(edges) {
      const next = new Set(edges || []);
      for (const id of Array.from(this.knownEdges)) {
        if (!next.has(id)) { delete this.edges[id]; delete this.edgeData[id]; }
      }
      for (const id of next) if (!(id in this.edges)) this.edges[id] = this.defaultState;
      this.knownEdges = next;
    }

    /** @returns {{state: string, data: ?object}} */
    getEdge(id) {
      return {
        state: this.edges[id] || this.defaultState,
        data: Object.prototype.hasOwnProperty.call(this.edgeData, id) ? this.edgeData[id] : null
      };
    }

    /** Replaces the set of known nodes (after a graph swap), keeping what still applies. */
    setNodes(nodes) {
      const next = new Set(nodes || []);
      for (const id of Array.from(this.known)) {
        if (!next.has(id)) { delete this.states[id]; delete this.badges[id]; delete this.data[id]; }
      }
      for (const id of next) {
        if (!(id in this.states)) this.states[id] = this.defaultState;
      }
      this.known = next;
    }

    /** @returns {{state: string, badge: ?string, data: ?object}} */
    get(id) {
      return {
        state: this.states[id] || this.defaultState,
        badge: Object.prototype.hasOwnProperty.call(this.badges, id) ? this.badges[id] : null,
        data: Object.prototype.hasOwnProperty.call(this.data, id) ? this.data[id] : null
      };
    }

    /** @returns {object} A deep-enough copy: safe to keep, safe to hand to a listener. */
    snapshot() {
      return {
        states: { ...this.states },
        badges: { ...this.badges },
        data: { ...this.data },
        edges: { ...this.edges },
        edgeData: { ...this.edgeData }
      };
    }

    /**
     * Applies a patch.
     *
     * Accepted forms, mixable in one call:
     *   { build: 'running' }
     *   { build: { state: 'success', badge: '42s', data: {...} } }
     *   { build: { badge: null } }            // clears the badge
     *
     * Edge ids (`build->test`) are accepted in the same patch as node ids: one
     * door for state, whatever the state is about.
     *
     * @param {StatePatch} patch
     * @returns {{changed: Array<string>, edgesChanged: Array<string>, structural: boolean, unknown: Array<string>}}
     */
    apply(patch) {
      const result = { changed: [], edgesChanged: [], structural: false, unknown: [] };
      if (!patch || typeof patch !== 'object') return result;

      for (const id of Object.keys(patch)) {
        if (this.knownEdges.has(id)) {
          const raw = patch[id];
          const entry = (typeof raw === 'string' || raw == null) ? { state: raw } : raw;
          let touched = false;
          if ('state' in entry && entry.state != null) {
            const next = String(entry.state);
            if (this.edges[id] !== next) { this.edges[id] = next; touched = true; }
          }
          if ('data' in entry) {
            if (entry.data == null) {
              if (Object.prototype.hasOwnProperty.call(this.edgeData, id)) { delete this.edgeData[id]; touched = true; }
            } else {
              this.edgeData[id] = entry.merge ? { ...(this.edgeData[id] || {}), ...entry.data } : entry.data;
              touched = true;
            }
          }
          if (touched) result.edgesChanged.push(id);
          continue;
        }
        if (!this.known.has(id)) {
          if (this.strict) throw new Error(`patch references unknown node "${id}"`);
          result.unknown.push(id);
          continue;
        }
        const raw = patch[id];
        const entry = (typeof raw === 'string' || raw == null) ? { state: raw } : raw;
        let touched = false;

        if ('state' in entry && entry.state != null) {
          const next = String(entry.state);
          if (this.states[id] !== next) {
            this.states[id] = next;
            result.structural = true;
            touched = true;
          }
        }

        if ('badge' in entry) {
          const next = entry.badge == null ? null : String(entry.badge);
          const had = Object.prototype.hasOwnProperty.call(this.badges, id) ? this.badges[id] : null;
          if (had !== next) {
            if (next == null) delete this.badges[id]; else this.badges[id] = next;
            touched = true;
          }
        }

        if ('data' in entry) {
          if (entry.data == null) {
            if (Object.prototype.hasOwnProperty.call(this.data, id)) { delete this.data[id]; touched = true; }
          } else {
            // `merge: true` keeps the previous payload and layers on top — the
            // usual shape when a stream reports one field at a time.
            this.data[id] = entry.merge ? { ...(this.data[id] || {}), ...entry.data } : entry.data;
            touched = true;
          }
        }

        if (touched && !result.changed.includes(id)) result.changed.push(id);
      }
      return result;
    }

    /**
     * Replaces the whole state at once (used by seek/replay).
     * @param {?object} snapshot - {states, badges, data}; null resets to defaults.
     */
    reset(snapshot) {
      const snap = snapshot || {};
      const states = snap.states || {};
      const edges = snap.edges || {};
      this.states = {};
      for (const id of this.known) this.states[id] = states[id] || this.defaultState;
      this.edges = {};
      for (const id of this.knownEdges) this.edges[id] = edges[id] || this.defaultState;
      this.badges = { ...(snap.badges || {}) };
      this.data = { ...(snap.data || {}) };
      this.edgeData = { ...(snap.edgeData || {}) };
      return this.snapshot();
    }

    /** Every node back to the default state, badges and data cleared. */
    clear() { return this.reset(null); }
  }

  /**
   * Compares two snapshots — the primitive behind "diff two runs".
   * @returns {Array<{node, from, to}>}
   */
  function diffSnapshots(a, b) {
    const left = (a && a.states) || {};
    const right = (b && b.states) || {};
    const ids = new Set([...Object.keys(left), ...Object.keys(right)]);
    const out = [];
    for (const id of ids) {
      if (left[id] !== right[id]) out.push({ node: id, from: left[id] || null, to: right[id] || null });
    }
    return out;
  }

  // ── src/timeline.js ───────────────────────────────────────────
  /**
   * The timeline — the piece nothing else in this space has.
   *
   * Because state only ever arrives as an ordered stream of patches, the exact
   * component that renders "now" can render any earlier moment: fold the events
   * up to time t and you have the diagram as it stood. Replay, scrubbing and
   * "what did this look like when it broke" are the same three lines of code.
   *
   * Folding from the start on every seek is O(n) per seek. For a run of a few
   * thousand events that is microseconds, and it keeps seeking backwards exactly
   * as correct as seeking forwards — which a running incremental cursor is not.
   * Forward seeks do reuse the cursor; backward seeks refold.
   */

  /**
   * Normalizes a raw event list.
   *
   * Accepted event shapes:
   *   { t, node, state, badge?, data? }
   *   { t, patch: { nodeId: 'state' | {...} } }
   *
   * `t` may be an absolute timestamp (epoch ms) or already relative; the
   * timeline rebases to 0 either way and keeps the original as `at`.
   *
   * @param {Array<object>} events
   * @returns {{events: Array<object>, t0: number, duration: number}}
   */
  function normalizeEvents(events) {
    const list = (Array.isArray(events) ? events : [])
      .filter((e) => e && typeof e === 'object')
      .map((e) => {
        const at = Number(e.t != null ? e.t : e.time != null ? e.time : e.timestamp);
        const patch = e.patch && typeof e.patch === 'object'
          ? e.patch
          : (e.node ? { [e.node]: pick(e) } : {});
        return { at: Number.isFinite(at) ? at : 0, patch, label: e.label == null ? '' : String(e.label), raw: e };
      })
      .sort((a, b) => a.at - b.at);

    const t0 = list.length ? list[0].at : 0;
    for (const e of list) e.t = e.at - t0;
    const duration = list.length ? list[list.length - 1].t : 0;
    return { events: list, t0, duration };
  }

  function pick(e) {
    const entry = {};
    if ('state' in e && e.state != null) entry.state = e.state;
    if ('badge' in e) entry.badge = e.badge;
    if ('data' in e) entry.data = e.data;
    if ('merge' in e) entry.merge = e.merge;
    return entry;
  }

  class Timeline {
    /**
     * @param {Array<object>} events
     * @param {object} handlers
     * @param {function(object, object): void} handlers.apply - apply(patch, {index, t, reset})
     * @param {function(): void} [handlers.onReset] - Called before a backwards fold
     * @param {function(object): void} [handlers.onTick] - Called after each seek/step
     * @param {function(): void} [handlers.onEnd]
     */
    constructor(events, handlers) {
      const normalized = normalizeEvents(events);
      this.events = normalized.events;
      this.t0 = normalized.t0;
      this.duration = normalized.duration;
      this._handlers = handlers || {};
      this._cursor = 0;     // number of events already applied
      this._position = 0;   // ms into the timeline
      this._timer = null;
      this._speed = 1;
    }

    get length() { return this.events.length; }
    get position() { return this._position; }
    get index() { return this._cursor; }
    get playing() { return this._timer !== null; }

    /**
     * Moves to time `t` (ms from the start of the timeline) and applies
     * everything up to it.
     * @param {number} t
     */
    seek(t) {
      const target = Math.max(0, Math.min(this.duration, Number(t) || 0));
      if (target < this._position) {
        // Backwards: refold from zero. Correctness beats cleverness here — an
        // "undo" path would have to invert arbitrary data payloads.
        if (this._handlers.onReset) this._handlers.onReset();
        this._cursor = 0;
      }
      while (this._cursor < this.events.length && this.events[this._cursor].t <= target) {
        const event = this.events[this._cursor];
        this._cursor++;
        if (this._handlers.apply) this._handlers.apply(event.patch, { index: this._cursor - 1, t: event.t, event });
      }
      this._position = target;
      if (this._handlers.onTick) this._handlers.onTick({ position: target, index: this._cursor, duration: this.duration });
      return this;
    }

    /**
     * Applies exactly ONE event and moves the position onto it.
     *
     * Deliberately not `seek(next.t)`: several events can share a timestamp, and
     * a "next" button that sometimes advances by three is a confusing button.
     * @returns {boolean} False when there is nothing left.
     */
    step() {
      if (this._cursor >= this.events.length) return false;
      const event = this.events[this._cursor];
      this._cursor++;
      if (this._handlers.apply) this._handlers.apply(event.patch, { index: this._cursor - 1, t: event.t, event });
      this._position = event.t;
      if (this._handlers.onTick) this._handlers.onTick({ position: event.t, index: this._cursor, duration: this.duration });
      return true;
    }

    /** Rewinds to the beginning (an empty diagram). */
    reset() {
      if (this._handlers.onReset) this._handlers.onReset();
      this._cursor = 0;
      this._position = 0;
      if (this._handlers.onTick) this._handlers.onTick({ position: 0, index: 0, duration: this.duration });
      return this;
    }

    /**
     * Plays from the current position.
     * @param {object} [options]
     * @param {number} [options.speed=1] - Wall-clock multiplier
     * @param {number} [options.fps=30]
     * @param {boolean} [options.loop=false]
     */
    play(options) {
      const opts = options || {};
      this._speed = Number(opts.speed) > 0 ? Number(opts.speed) : 1;
      const fps = Number(opts.fps) > 0 ? Number(opts.fps) : 30;
      const stepMs = 1000 / fps;
      if (this._position >= this.duration) this.reset();
      this.pause();
      this._timer = setInterval(() => {
        const next = this._position + stepMs * this._speed;
        this.seek(next);
        if (this._position >= this.duration) {
          this.pause();
          if (opts.loop) { this.reset(); this.play(opts); return; }
          if (this._handlers.onEnd) this._handlers.onEnd();
        }
      }, stepMs);
      // Never hold a Node process open for a replay animation.
      if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
      return this;
    }

    /** Stops playback, keeping the position. */
    pause() {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      return this;
    }

    /** Stops playback and rewinds. */
    stop() { return this.pause().reset(); }

    /** Releases the timer. */
    destroy() { this.pause(); this._handlers = {}; this.events = []; }
  }

  // ── src/viewport.js ───────────────────────────────────────────
  /**
   * Zoom, fit and drag-to-pan.
   *
   * Small, boring, and rewritten by hand in every project that puts a diagram on
   * a page. That is precisely why it belongs in the library.
   *
   * Scaling resizes the SVG's element box (width, from the viewBox) rather than
   * transforming it — a transform scales pixels but not the layout box, so
   * centering and scrollbars work on the wrong size. Renders replace the SVG;
   * `resync()` re-projects `_scale` onto the new one.
   */

  class Viewport {
    /**
     * @param {object} args
     * @param {Element} args.scroller - The overflow:auto element
     * @param {Element} args.content - The element that gets scaled
     * @param {object} [args.options]
     * @param {number} [args.options.min=0.3]
     * @param {number} [args.options.max=3]
     * @param {number} [args.options.step=0.15]
     * @param {boolean} [args.options.pan=true]
     * @param {boolean} [args.options.wheelZoom=true] - Ctrl/⌘ + wheel
     * @param {number} [args.options.maxFitScale=1.75] - How far fit() may upscale
     * @param {function(number, string=): void} [args.onChange] - Called with the
     *   new scale and its cause, 'zoom' or 'fit'. Never called by `resync()`.
     */
    constructor(args) {
      this.scroller = args.scroller;
      this.content = args.content;
      const o = args.options || {};
      this.min = o.min || 0.3;
      this.max = o.max || 3;
      this.step = o.step || 0.15;
      this.maxFitScale = o.maxFitScale == null ? 1.75 : Number(o.maxFitScale);
      this.onChange = args.onChange || (() => {});
      this._scale = 1;
      this._teardown = [];

      if (o.pan !== false) this._enablePan();
      if (o.wheelZoom !== false) this._enableWheelZoom();
    }

    get scale() { return this._scale; }

    /** Writes the scale onto the mounted SVG's element box. Projection only. */
    _project(scale) {
      if (this.content.style.transform) this.content.style.transform = '';
      const svg = this.content.querySelector('svg');
      const vb = svg && svg.viewBox && svg.viewBox.baseVal;
      if (!vb || !vb.width) return;
      svg.style.width = `${vb.width * scale}px`;
    }

    /**
     * Re-projects the scale onto the SVG a full render just replaced. Silent
     * (no `onChange`) and unclamped — fit() may have stored a below-`min` value.
     */
    resync() {
      this._project(this._scale);
      return this._scale;
    }

    /** Sets the zoom level, clamped. */
    zoom(scale) {
      const next = Math.max(this.min, Math.min(this.max, Number(scale) || 1));
      if (next === this._scale) return this._scale;
      this._scale = next;
      this._project(next);
      this.onChange(next, 'zoom');
      return next;
    }

    zoomIn() { return this.zoom(this._scale + this.step); }
    zoomOut() { return this.zoom(this._scale - this.step); }
    reset() { this.scroller.scrollLeft = 0; this.scroller.scrollTop = 0; return this.zoom(1); }

    /**
     * Scales the diagram to fill the scroller.
     *
     * Upscaling is allowed but capped (`maxFitScale`, 1.75 by default): a
     * four-node diagram stretched across a widescreen looks like a mistake,
     * while leaving it postage-stamp-sized in the corner looks like a bug.
     * Not floored at `min` (that bounds interactive zoom): fit's contract is
     * fitting, so it skips `zoom()` and fires `onChange` (cause 'fit') itself.
     */
    fit(padding) {
      const svg = this.content.querySelector('svg');
      const vb = svg && svg.viewBox && svg.viewBox.baseVal;
      if (!vb || !vb.width || !vb.height) return this._fitTo(1);
      const pad = padding == null ? 24 : padding;
      const scale = Math.min(
        (this.scroller.clientWidth - pad) / vb.width,
        (this.scroller.clientHeight - pad) / vb.height,
        this.maxFitScale
      );
      // A collapsed or hidden scroller has nothing to fit to. Change nothing:
      // snapping a hidden diagram to scale 1 is wrong, and emitting 'zoom' here
      // read as a hand zoom and permanently cancelled autoFit observation.
      if (!isFinite(scale) || scale <= 0) return this._scale;
      this.scroller.scrollLeft = 0;
      this.scroller.scrollTop = 0;
      return this._fitTo(scale);
    }

    /** The loud half of fit(): cause 'fit', silent when nothing changes. */
    _fitTo(scale) {
      if (scale === this._scale) return this._scale;
      this._scale = scale;
      this._project(scale);
      this.onChange(scale, 'fit');
      return scale;
    }

    _enablePan() {
      const onDown = (e) => {
        if (e.button !== 0) return;
        // Let a click on a node be a click, not the start of a drag.
        if (e.target && e.target.closest && e.target.closest('[data-ld-node]')) return;
        const startX = e.clientX, startY = e.clientY;
        const sl = this.scroller.scrollLeft, st = this.scroller.scrollTop;
        const move = (ev) => {
          this.scroller.scrollLeft = sl - (ev.clientX - startX);
          this.scroller.scrollTop = st - (ev.clientY - startY);
        };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          this.scroller.classList.remove('is-panning');
        };
        this.scroller.classList.add('is-panning');
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      };
      this.scroller.addEventListener('mousedown', onDown);
      this._teardown.push(() => this.scroller.removeEventListener('mousedown', onDown));
    }

    _enableWheelZoom() {
      const onWheel = (e) => {
        if (!e.ctrlKey && !e.metaKey) return; // plain wheel keeps scrolling the page
        e.preventDefault();
        this.zoom(this._scale + (e.deltaY < 0 ? this.step : -this.step));
      };
      this.scroller.addEventListener('wheel', onWheel, { passive: false });
      this._teardown.push(() => this.scroller.removeEventListener('wheel', onWheel));
    }

    destroy() {
      this._teardown.forEach((fn) => fn());
      this._teardown = [];
    }
  }

  // ── src/overlay.js ────────────────────────────────────────────
  /**
   * The overlay layer: HTML anchored to nodes.
   *
   * Badges live here rather than in node labels for two practical reasons: a
   * label change means re-parsing and re-laying-out the whole diagram (nodes jump
   * around when a duration counter ticks), and text inside an SVG cannot be
   * styled by your stylesheet the way a div can.
   *
   * Once that machinery exists, a badge is just the smallest thing you can hang
   * on a node. `overlay()` opens it up: a progress bar, a sparkline, an avatar, a
   * retry button, a line of streaming output — anything you can put in a div,
   * positioned against a node and kept there through re-renders and zooms. The
   * library positions your element and never draws its contents.
   */

  /** Anchor points, as fractions of the node's box. */
  const ANCHORS = {
    'top-left': [0, 0],
    top: [0.5, 0],
    'top-right': [1, 0],
    left: [0, 0.5],
    center: [0.5, 0.5],
    right: [1, 0.5],
    'bottom-left': [0, 1],
    bottom: [0.5, 1],
    'bottom-right': [1, 1]
  };

  class Overlay {
    /**
     * @param {Element} layer - Absolutely positioned element inside the scroller
     * @param {Element} scroller
     */
    constructor(layer, scroller) {
      this.layer = layer;
      this.scroller = scroller;
      this.chips = new Map();
      this.items = new Map();
    }

    /**
     * Anchors an element to a node. Returns the element, because the caller
     * usually wants to keep updating it (a progress bar is not a one-shot).
     *
     * @param {string} id - Node id
     * @param {Element|string|null} content - Element, HTML string, or null to remove
     * @param {object} [options]
     * @param {string} [options.position='top-right'] - See ANCHORS
     * @param {Array<number>} [options.offset=[0,0]] - Extra pixels, [x, y]
     * @param {string} [options.className]
     * @param {boolean} [options.interactive=true] - Whether it receives pointer events
     * @returns {?Element}
     */
    set(id, content, options) {
      const existing = this.items.get(id);
      if (content == null) {
        if (existing) { existing.el.remove(); this.items.delete(id); }
        return null;
      }
      const opts = options || {};
      let el = content;
      if (typeof content === 'string') {
        el = this.layer.ownerDocument.createElement('div');
        el.innerHTML = content;
      }
      if (existing && existing.el !== el) existing.el.remove();

      el.classList.add('ld-overlay-item');
      if (opts.className) el.classList.add(...String(opts.className).split(/\s+/).filter(Boolean));
      el.setAttribute('data-ld-overlay-for', id);
      // The layer ignores pointer events so the diagram underneath stays
      // clickable; an overlay opts back in, which is what makes buttons work.
      el.style.pointerEvents = opts.interactive === false ? 'none' : 'auto';
      if (!el.parentNode) this.layer.appendChild(el);

      this.items.set(id, { el, position: ANCHORS[opts.position] ? opts.position : 'top-right', offset: opts.offset || [0, 0] });
      return el;
    }

    /** @returns {?Element} */
    get(id) {
      const entry = this.items.get(id);
      return entry ? entry.el : null;
    }

    /** Removes every custom overlay, leaving badges alone. */
    clearItems() {
      for (const entry of this.items.values()) entry.el.remove();
      this.items.clear();
    }

    /**
     * Repositions and rewrites every chip. Called after a render and after a
     * zoom; cheap enough to do wholesale for the node counts diagrams have.
     *
     * @param {Map<string, Element>} nodes
     * @param {object} badges - nodeId -> text
     */
    sync(nodes, badges) {
      const wanted = new Set(Object.keys(badges || {}));

      for (const [id, chip] of Array.from(this.chips)) {
        if (!wanted.has(id)) { chip.remove(); this.chips.delete(id); }
      }
      if (!wanted.size && !this.items.size) return;

      const base = this.scroller.getBoundingClientRect();

      // Custom overlays: same geometry, arbitrary content, chosen anchor.
      for (const [id, entry] of this.items) {
        const el = nodes.get(id);
        if (!el) { entry.el.style.display = 'none'; continue; }
        entry.el.style.display = '';
        const rect = el.getBoundingClientRect();
        const [fx, fy] = ANCHORS[entry.position];
        const x = rect.left + rect.width * fx - base.left + (this.scroller.scrollLeft || 0) + entry.offset[0];
        const y = rect.top + rect.height * fy - base.top + (this.scroller.scrollTop || 0) + entry.offset[1];
        entry.el.style.left = `${Math.round(x)}px`;
        entry.el.style.top = `${Math.round(y)}px`;
      }

      for (const id of wanted) {
        const el = nodes.get(id);
        if (!el) continue;
        let chip = this.chips.get(id);
        if (!chip) {
          chip = this.layer.ownerDocument.createElement('span');
          chip.className = 'ld-badge';
          chip.setAttribute('data-ld-badge-for', id);
          this.layer.appendChild(chip);
          this.chips.set(id, chip);
        }
        chip.textContent = badges[id];
        const rect = el.getBoundingClientRect();
        // `scroller` is the host element in bare mode, where scroll offsets are 0.
        const x = rect.right - base.left + (this.scroller.scrollLeft || 0);
        const y = rect.top - base.top + (this.scroller.scrollTop || 0);
        chip.style.left = `${Math.round(x - 6)}px`;
        chip.style.top = `${Math.round(y - 6)}px`;
      }
    }

    clear() {
      for (const chip of this.chips.values()) chip.remove();
      this.chips.clear();
      this.clearItems();
    }
  }

  // ── src/styles.js ─────────────────────────────────────────────
  /**
   * The library's own stylesheet, injected once per document.
   *
   * Everything is namespaced under `.ld` and defined with CSS custom properties,
   * so overriding it is a variable, not a `!important`.
   */

  const CSS = `
  .ld { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%;
        background: var(--ld-bg, transparent);
        --ld-badge-bg: #0f172a; --ld-badge-fg: #f8fafc; --ld-focus: #6366f1;
        --ld-control-bg: rgba(255,255,255,.9); --ld-control-fg: #0f172a; --ld-control-border: #cbd5e1; }
  .ld[data-theme="dark"] { --ld-badge-bg: #e2e8f0; --ld-badge-fg: #0f172a;
        --ld-control-bg: rgba(15,23,42,.9); --ld-control-fg: #e2e8f0; --ld-control-border: #334155; }
  .ld[data-chrome="none"] { display: block; height: auto; }
  .ld-viewport { position: relative; flex: 1; min-height: 0; overflow: auto; cursor: grab;
    display: grid; place-items: safe center;
    /* Room for badge chips, which sit half outside the node's bounding box and
       would otherwise be clipped against the top edge. */
    padding: 12px; }
  .ld-viewport.is-panning { cursor: grabbing; user-select: none; }
  .ld-canvas { display: inline-block; }
  .ld-canvas svg { display: block; max-width: none !important; height: auto; }
  .ld-overlay { position: absolute; inset: 0; pointer-events: none; }
  .ld-badge { position: absolute; transform: translate(-50%, -50%); pointer-events: none;
    background: var(--ld-badge-bg); color: var(--ld-badge-fg); border-radius: 999px;
    font: 600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 2px 7px;
    white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
  /* A diagram whose source has gone away says so, rather than showing an old
     run as if it were current. Override --ld-stale-opacity to taste. */
  .ld[data-ld-connection="stale"] .ld-canvas,
  .ld[data-ld-connection="stale"] .ld-overlay { opacity: var(--ld-stale-opacity, .55); filter: saturate(.65); }
  .ld[data-ld-connection="stale"]::after {
    content: attr(data-ld-stale-label); position: absolute; top: 8px; left: 50%;
    transform: translateX(-50%); z-index: 3; pointer-events: none;
    background: var(--ld-badge-bg); color: var(--ld-badge-fg); border-radius: 999px;
    font: 600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 3px 10px;
  }
  .ld-overlay-item { position: absolute; transform: translate(-50%, -50%); }
  .ld-node { cursor: pointer; }
  .ld-edge { transition: stroke .18s ease; }
  .ld-edge[data-ld-edge-state="running"] { stroke-dasharray: 6 5; animation: ld-flow .9s linear infinite; }
  @keyframes ld-flow { to { stroke-dashoffset: -22; } }
  @media (prefers-reduced-motion: reduce) { .ld-edge { animation: none !important; } }
  .ld-node:focus { outline: none; }
  .ld-node:focus-visible > :first-child { outline: 2px solid var(--ld-focus); outline-offset: 3px; }
  .ld-node:hover { filter: brightness(1.06); }
  .ld-controls { position: absolute; right: 10px; bottom: 10px; display: flex; gap: 4px; z-index: 2; }
  .ld-controls button { width: 28px; height: 28px; border-radius: 6px; cursor: pointer;
    background: var(--ld-control-bg); color: var(--ld-control-fg);
    border: 1px solid var(--ld-control-border); font: 600 13px/1 system-ui, sans-serif; }
  .ld-controls button:hover { filter: brightness(1.1); }
  @media (prefers-reduced-motion: no-preference) {
    .ld-node > :first-child { transition: fill .18s ease, stroke .18s ease; }
  }

  /* ── kit ─────────────────────────────────────────────────────────────────── */
  .ld-legend, .ld-inspector, .ld-transport {
    font: 13px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: var(--ld-kit-fg, inherit);
  }
  .ld-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
  .ld-legend__item { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; }
  .ld-legend__swatch { width: 11px; height: 11px; border-radius: 3px; border: 1.5px solid; display: inline-block; }
  .ld-legend__item b { font-variant-numeric: tabular-nums; opacity: .65; font-weight: 600; }

  .ld-inspector { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 0; align-items: baseline; }
  /* The display:grid above beats the browser's own [hidden] rule, so a hidden
     tooltip would sit visible and empty in a corner. It did. */
  .ld-inspector[hidden] { display: none !important; }
  .ld-inspector dt { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; opacity: .6; }
  .ld-inspector dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; overflow-wrap: anywhere; }
  .ld-inspector--tooltip {
    position: absolute; z-index: 3; pointer-events: none; max-width: 280px;
    padding: 8px 10px; border-radius: 8px;
    background: var(--ld-badge-bg); color: var(--ld-badge-fg);
    box-shadow: 0 2px 10px rgba(0,0,0,.28);
  }
  .ld-inspector--tooltip dt { opacity: .7; }

  .ld-transport { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .ld-transport__button {
    min-width: 30px; height: 28px; border-radius: 7px; cursor: pointer;
    background: var(--ld-control-bg); color: var(--ld-control-fg);
    border: 1px solid var(--ld-control-border); font-size: 13px; line-height: 1;
  }
  .ld-transport__button:hover { filter: brightness(1.1); }
  .ld-transport__scrub { flex: 1; min-width: 110px; }
  .ld-transport__clock { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; opacity: .7; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ld-transport__speed {
    height: 28px; border-radius: 7px; font-size: 12px; padding: 0 4px;
    background: var(--ld-control-bg); color: var(--ld-control-fg); border: 1px solid var(--ld-control-border);
  }
  `;

  const STYLE_MARK = 'data-live-diagram-styles';

  /** Injects the stylesheet once per document. */
  function ensureStyles(doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || d.querySelector(`style[${STYLE_MARK}]`)) return;
    const style = d.createElement('style');
    style.setAttribute(STYLE_MARK, '');
    style.textContent = CSS;
    d.head.appendChild(style);
  }

  // ── src/renderers/mermaid-def.js ──────────────────────────────
  /**
   * graph + state -> a Mermaid flowchart definition. A pure function, which is
   * why it can be unit-tested in Node with no browser, no DOM and no Mermaid
   * installed. Everything that could be pure here is.
   */




  /**
   * Mermaid's default cluster fill is a pale yellow that fights every palette it
   * is put next to. Groups are structure, not status, so they get a neutral box
   * unless the caller says otherwise.
   */
  const GROUP_STYLE = {
    light: 'fill:#f8fafc,stroke:#cbd5e1,color:#475569',
    dark: 'fill:#0f172a,stroke:#334155,color:#94a3b8'
  };

  const SHAPE_SYNTAX = {
    rounded:    (id, label) => `${id}("${label}")`,
    stadium:    (id, label) => `${id}(["${label}"])`,
    rect:       (id, label) => `${id}["${label}"]`,
    diamond:    (id, label) => `${id}{"${label}"}`,
    circle:     (id, label) => `${id}(("${label}"))`,
    hex:        (id, label) => `${id}{{"${label}"}}`,
    subroutine: (id, label) => `${id}[["${label}"]]`,
    cylinder:   (id, label) => `${id}[("${label}")]`
  };

  /**
   * @param {string} shape
   * @param {string} id
   * @param {string} label - Already escaped
   */
  function nodeSyntax(shape, id, label) {
    const fn = SHAPE_SYNTAX[shape] || SHAPE_SYNTAX.rect;
    return fn(id, label);
  }

  /**
   * Builds a complete flowchart definition.
   *
   * @param {object} args
   * @param {object} args.graph - Normalized graph
   * @param {object} args.snapshot - {states, badges, data}
   * @param {object} args.states - Normalized state vocabulary
   * @param {object} [args.options]
   * @param {boolean} [args.options.showIcons=false] - Prefix labels with the state icon
   * @param {string} [args.options.theme='light']
   * @param {string} [args.options.defaultState='idle']
   * @param {string} [args.options.groupStyle] - Style line for subgraph boxes
   * @returns {string}
   */
  function buildDefinition(args) {
    const { graph, snapshot, states } = args;
    const options = args.options || {};
    const theme = options.theme === 'dark' ? 'dark' : 'light';
    const nodeStates = (snapshot && snapshot.states) || {};
    const defaultState = options.defaultState || 'idle';

    const lines = [`flowchart ${graph.direction}`];
    const edgeLines = [];
    const grouped = new Set();
    for (const group of graph.groups) for (const id of group.nodes) grouped.add(id);

    const declare = (id) => {
      const node = graph.nodes[id];
      const state = nodeStates[id] || defaultState;
      const icon = options.showIcons && states[state] ? states[state].icon : '';
      // Mermaid cannot parse an empty label — `a(("")))` is a syntax error — and
      // deliberately blank nodes are real: a state diagram's start dot, a fork
      // bar. A space is the smallest thing that parses and still draws nothing.
      const label = escapeLabel(icon ? `${icon} ${node.label}` : node.label) || ' ';
      return `  ${nodeSyntax(node.shape, id, label)}`;
    };

    for (const id of Object.keys(graph.nodes)) {
      if (!grouped.has(id)) lines.push(declare(id));
    }

    for (const group of graph.groups) {
      lines.push(`  subgraph ${group.id} ["${escapeLabel(group.label)}"]`);
      for (const id of group.nodes) lines.push(`  ${declare(id)}`);
      lines.push('  end');
    }

    const groupStyle = options.groupStyle === undefined ? GROUP_STYLE[theme] : options.groupStyle;
    if (groupStyle) {
      for (const group of graph.groups) lines.push(`  style ${group.id} ${groupStyle}`);
    }

    const edgeStates = (snapshot && snapshot.edges) || {};
    graph.edges.forEach((edge, index) => {
      // A conditional edge is drawn dotted. The library takes no position on
      // what the condition MEANS — only that it is not the default path.
      const arrow = edge.condition === 'always' ? '-->' : '-.->';
      const label = edge.label ? `|${escapeLabel(edge.label)}|` : '';
      lines.push(`  ${edge.from} ${arrow}${label} ${edge.to}`);
      // linkStyle addresses an edge by its position in this definition, which is
      // why the emitted order is the graph's order and nothing sorts it.
      const state = edgeStates[edge.id];
      const style = state ? edgeStyleFor(states, state, theme) : '';
      if (style && state !== defaultState) edgeLines.push(`  linkStyle ${index} ${style}`);
    });

    for (const id of Object.keys(graph.nodes)) {
      const style = styleFor(states, nodeStates[id] || defaultState, theme);
      if (style) lines.push(`  style ${id} ${style}`);
      const cls = graph.nodes[id].class;
      if (cls) lines.push(`  class ${id} ${cls}`);
    }

    return lines.concat(edgeLines).join('\n');
  }

  // ── src/renderers/mermaid.js ──────────────────────────────────
  /**
   * The Mermaid renderer adapter.
   *
   * Mermaid is a peer, not a dependency, and it is reachable only from this
   * file. The core knows nothing about it — which is the point: the state model,
   * the timeline, the viewport and the event routing survive a renderer swap.
   */



  // A shared id would make Mermaid tear the OTHER container's SVG out of the
  // document — two diagrams on one page, or a dashboard plus an editor preview,
  // and one of them silently vanishes. Learned the hard way; never share the id.
  let renderSeq = 0;

  /** Resolves 'auto' against the document, so a page-level theme just works. */
  function resolveTheme(preference) {
    if (preference === 'dark' || preference === 'light') return preference;
    if (typeof document !== 'undefined') {
      const attr = document.documentElement.getAttribute('data-theme');
      if (attr === 'dark' || attr === 'light') return attr;
    }
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
      } catch (_) { /* jsdom and friends */ }
    }
    return 'light';
  }

  /**
   * Maps rendered SVG groups back to node ids and tags them with
   * `data-ld-node`. Everything downstream — click delegation, badges, focus
   * rings, your own CSS — hangs off that one attribute rather than off
   * Mermaid's internal id scheme, which has changed between majors before.
   *
   * @param {Element} container
   * @param {Array<string>} ids
   * @param {object} graph
   * @returns {Map<string, Element>}
   */
  function tagNodes(container, ids, graph) {
    const map = new Map();
    const known = new Set(ids);
    const elements = Array.from(container.querySelectorAll('g.node'));

    for (const el of elements) {
      const raw = el.id || '';
      // Mermaid v10/v11 emit ids like `flowchart-build-12`.
      const stripped = raw.replace(/^(?:flowchart|graph|statediagram)-/, '').replace(/-\d+$/, '');
      const candidate = known.has(stripped) ? stripped : (known.has(raw) ? raw : null);
      if (candidate && !map.has(candidate)) map.set(candidate, el);
    }

    // Fallback: match on the rendered label. Only reached if Mermaid changes its
    // id scheme again, but it keeps clicks working when it does.
    if (map.size < known.size && graph) {
      for (const id of known) {
        if (map.has(id)) continue;
        const label = String(graph.nodes[id] && graph.nodes[id].label || '').trim();
        if (!label) continue;
        const hit = elements.find((el) => !Array.from(map.values()).includes(el)
          && (el.textContent || '').trim().replace(/^\S+\s/, '') === label.replace(/^\S+\s/, ''));
        if (hit) map.set(id, hit);
      }
    }

    for (const [id, el] of map) {
      el.setAttribute('data-ld-node', id);
      el.classList.add('ld-node');
    }
    return map;
  }

  /**
   * Maps rendered edge paths back to edge ids and tags them `data-ld-edge`.
   *
   * Mermaid names an edge path `L_<from>_<to>_<index>`, which is ambiguous to
   * split when node ids contain underscores — but the trailing index is the
   * edge's position in the definition, and that order is ours. Document order
   * inside `.edgePaths` is the fallback.
   *
   * @param {Element} container
   * @param {object} graph - Normalized graph
   * @returns {Map<string, Element>}
   */
  function tagEdges(container, graph) {
    const map = new Map();
    const paths = Array.from(container.querySelectorAll('.edgePaths > path, path.flowchart-link'));
    const edges = graph.edges || [];

    paths.forEach((path, position) => {
      const fromId = /_(\d+)$/.exec(path.id || '');
      const index = fromId ? Number(fromId[1]) : position;
      const edge = edges[index];
      if (!edge || map.has(edge.id)) return;
      map.set(edge.id, path);
      path.setAttribute('data-ld-edge', edge.id);
      path.classList.add('ld-edge');
    });
    return map;
  }

  /**
   * Creates a Mermaid renderer.
   *
   * @param {object} [options]
   * @param {object} [options.mermaid] - Mermaid module (defaults to globalThis.mermaid)
   * @param {object} [options.config] - Extra config passed to mermaid.initialize
   * @param {boolean} [options.showIcons=false] - Prefix node labels with state icons
   * @param {object} [options.flowchart] - Shorthand for config.flowchart
   * @param {boolean} [options.svgLabels=false] - Draw labels as SVG text instead of HTML.
   *   Required for PNG export, and a Mermaid trap in its own right: the setting has
   *   to be given at BOTH the top level and under `flowchart`, or it is ignored.
   */
  function mermaidRenderer(options) {
    const opts = options || {};
    let initializedTheme = null;

    const lib = () => {
      const m = opts.mermaid || (typeof globalThis !== 'undefined' ? globalThis.mermaid : null);
      if (!m || typeof m.render !== 'function') {
        throw new Error('mermaidRenderer: Mermaid is not available. Load mermaid before LiveDiagram, or pass it as mermaidRenderer({ mermaid }).');
      }
      return m;
    };

    return {
      name: 'mermaid',

      /** Builds the definition without touching the DOM — useful for export and tests. */
      definition(args) {
        return buildDefinition({
          graph: args.graph,
          snapshot: args.snapshot,
          states: args.states,
          options: { showIcons: opts.showIcons === true, theme: resolveTheme(args.theme), defaultState: args.defaultState }
        });
      },

      /**
       * @returns {Promise<{svg: string, nodes: Map<string, Element>, definition: string}>}
       */
      async render(args) {
        const mermaid = lib();
        const theme = resolveTheme(args.theme);
        if (initializedTheme !== theme) {
          const config = {
            startOnLoad: false,
            // `click` directives are not used — clicks are delegated from the
            // container — but loose keeps user-supplied labels rendering as
            // written rather than being re-encoded.
            securityLevel: 'loose',
            theme: theme === 'dark' ? 'dark' : 'default',
            ...(opts.config || {}),
            ...(opts.flowchart ? { flowchart: opts.flowchart } : {})
          };
          if (opts.svgLabels) {
            config.htmlLabels = false;
            config.flowchart = { ...(config.flowchart || {}), htmlLabels: false };
          }
          mermaid.initialize(config);
          initializedTheme = theme;
        }

        const definition = this.definition({ ...args, theme });
        const renderId = `ld-${(renderSeq++).toString(36)}`;
        const result = await mermaid.render(renderId, definition);
        const svg = typeof result === 'string' ? result : result.svg;

        args.container.innerHTML = svg;
        // Mermaid emits width="100%", which a shrink-wrapped inline-block
        // resolves to the CSS replaced-element default of 300px. Pin the box to
        // the drawing's own size; the viewport rescales this width to zoom.
        const rootSvg = args.container.querySelector('svg');
        if (rootSvg && rootSvg.viewBox && rootSvg.viewBox.baseVal && rootSvg.viewBox.baseVal.width) {
          rootSvg.style.width = `${rootSvg.viewBox.baseVal.width}px`;
        }
        if (result && typeof result.bindFunctions === 'function') {
          try { result.bindFunctions(args.container); } catch (_) { /* no click directives to bind */ }
        }

        const nodes = tagNodes(args.container, Object.keys(args.graph.nodes), args.graph);
        const edges = tagEdges(args.container, args.graph);
        return { svg, nodes, edges, definition };
      },

      destroy() { initializedTheme = null; }
    };
  }

  // ── src/live-diagram.js ───────────────────────────────────────
  /**
   * LiveDiagram — a diagram you can push state into and get events out of.
   *
   * The contract is two sentences long:
   *   1. `patch()` is the only way state changes.
   *   2. The library never mutates the graph you gave it.
   *
   * Replay, live streaming, run diffing and "click a node to do something" all
   * fall out of those two rules, which is why the API is small enough to read in
   * one sitting.
   */











  const CONTROL_BUTTONS = [
    { action: 'zoomIn', glyph: '+', title: 'Zoom in' },
    { action: 'zoomOut', glyph: '−', title: 'Zoom out' },
    { action: 'fit', glyph: '⤢', title: 'Fit to view' }
  ];

  class LiveDiagram extends Emitter {
    /**
     * @param {object} options
     * @param {Element|string} options.mount - Element or selector to render into
     * @param {import('./graph.js').GraphSpec} options.graph - Structure: nodes, edges, groups
     * @param {object} [options.states] - State vocabulary, merged over the defaults
     * @param {object} [options.initial] - Initial state patch
     * @param {object} [options.renderer] - Renderer adapter (defaults to Mermaid)
     * @param {string} [options.theme='auto'] - 'light' | 'dark' | 'auto'
     * @param {string} [options.defaultState='idle']
     * @param {boolean} [options.showIcons=false] - Prefix labels with state icons
     * @param {boolean} [options.controls=false] - Render the built-in zoom buttons
     * @param {boolean|'observe'} [options.autoFit=true] - Fit once after the
     *   first render; 'observe' keeps refitting as the container resizes, until
     *   the user zooms by hand; false never fits
     * @param {boolean} [options.strict=false] - Throw on patches for unknown nodes
     * @param {object|false} [options.viewport] - Viewport options (min, max, step,
     *   pan, wheelZoom, maxFitScale), or `false` for bare mode: no scroller and no
     *   chrome, for hosts that already own scrolling and zooming (see setGraph docs)
     */
    constructor(options) {
      super();
      const opts = options || {};
      this.options = opts;

      this.graph = normalizeGraph(opts.graph);
      this.states = normalizeStates(opts.states, { extend: opts.extendStates !== false });
      this.defaultState = opts.defaultState || 'idle';
      this.showIcons = opts.showIcons === true;
      this.theme = opts.theme || 'auto';
      this.renderer = opts.renderer || mermaidRenderer({ showIcons: this.showIcons });

      this.store = new StateStore({
        nodes: Object.keys(this.graph.nodes),
        edges: edgeIds(this.graph),
        defaultState: this.defaultState,
        strict: opts.strict === true
      });

      this._nodes = new Map();
      this._edges = new Map();
      this._rendering = false;
      this._pending = null;       // 'full' | 'restyle'
      this._destroyed = false;
      this._sources = [];
      this._timelines = [];
      this._didAutoFit = false;
      this._connection = 'none';
      this._lastUpdate = null;
      this._staleTimer = null;

      this._mountDom(opts.mount);
      if (opts.initial) this.store.apply(opts.initial);
      this.render();
    }

    // ---------------------------------------------------------------- mounting

    _mountDom(mount) {
      const el = typeof mount === 'string'
        ? (typeof document !== 'undefined' ? document.querySelector(mount) : null)
        : mount;
      if (!el) throw new Error(`LiveDiagram: mount target ${JSON.stringify(mount)} not found`);

      ensureStyles(el.ownerDocument);
      const doc = el.ownerDocument;

      // Bare mode: the host already has a scroller and its own zoom, and just
      // wants the diagram. Embedding a second scroll container inside one that
      // already scrolls is how nested-scrollbar bugs are born.
      const bare = this.options.viewport === false;

      this.root = doc.createElement('div');
      this.root.className = 'ld';
      this.root.setAttribute('data-theme', resolveTheme(this.theme));
      this.root.setAttribute('data-ld-connection', this._connection);
      this.root.setAttribute('data-ld-stale-label', this.options.staleLabel || 'disconnected — last known state');
      if (bare) this.root.setAttribute('data-chrome', 'none');

      this.canvas = doc.createElement('div');
      this.canvas.className = 'ld-canvas';

      this.overlayLayer = doc.createElement('div');
      this.overlayLayer.className = 'ld-overlay';

      if (bare) {
        this.scroller = this.root;
        this.root.appendChild(this.canvas);
        this.root.appendChild(this.overlayLayer);
      } else {
        this.scroller = doc.createElement('div');
        this.scroller.className = 'ld-viewport';
        this.scroller.appendChild(this.canvas);
        this.scroller.appendChild(this.overlayLayer);
        this.root.appendChild(this.scroller);
      }
      el.appendChild(this.root);

      this.overlays = new Overlay(this.overlayLayer, this.scroller);
      this.viewport = new Viewport({
        scroller: this.scroller,
        content: this.canvas,
        options: bare ? { pan: false, wheelZoom: false } : (this.options.viewport || {}),
        onChange: (scale, cause) => {
          this.overlays.sync(this._nodes, this.store.badges);
          // A hand zoom means the user has taken over; observing would fight them.
          if (cause === 'zoom') this._stopObserving();
          this.emit('zoom', { scale, cause });
        }
      });

      if (this.options.controls) this._mountControls(doc);
      this._bindInteractions();
    }

    _mountControls(doc) {
      const bar = doc.createElement('div');
      bar.className = 'ld-controls';
      for (const spec of CONTROL_BUTTONS) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = spec.glyph;
        button.title = spec.title;
        button.setAttribute('aria-label', spec.title);
        button.addEventListener('click', () => this[spec.action]());
        bar.appendChild(button);
      }
      this.root.appendChild(bar);
    }

    _bindInteractions() {
      // Delegation, not Mermaid `click` directives: it survives re-renders, needs
      // no global callback name, and is unaffected by securityLevel.
      this._onClick = (event) => {
        if (!event.target.closest) return;
        const node = event.target.closest('[data-ld-node]');
        if (node) { this.emit('nodeClick', this._nodePayload(node.getAttribute('data-ld-node'), event)); return; }
        const edge = event.target.closest('[data-ld-edge]');
        if (edge) this.emit('edgeClick', this._edgePayload(edge.getAttribute('data-ld-edge'), event));
      };
      this._onKey = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const target = event.target.closest && event.target.closest('[data-ld-node]');
        if (!target) return;
        event.preventDefault();
        this.emit('nodeClick', this._nodePayload(target.getAttribute('data-ld-node'), event));
      };
      this._onOver = (event) => {
        const target = event.target.closest && event.target.closest('[data-ld-node]');
        if (!target) return;
        const id = target.getAttribute('data-ld-node');
        if (id === this._hovered) return;
        this._hovered = id;
        this.emit('nodeHover', this._nodePayload(id, event));
      };
      this._onOut = (event) => {
        if (event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest('[data-ld-node]')) return;
        if (this._hovered == null) return;
        this._hovered = null;
        this.emit('nodeHover', null);
      };

      this.canvas.addEventListener('click', this._onClick);
      this.canvas.addEventListener('keydown', this._onKey);
      this.canvas.addEventListener('mouseover', this._onOver);
      this.canvas.addEventListener('mouseout', this._onOut);
    }

    _edgePayload(id, event) {
      const entry = this.store.getEdge(id);
      const edge = this.graph.edges.find((e) => e.id === id) || null;
      return {
        id,
        edge,
        from: edge && edge.from,
        to: edge && edge.to,
        state: entry.state,
        data: entry.data,
        element: this._edges.get(id) || null,
        originalEvent: event || null
      };
    }

    _nodePayload(id, event) {
      const entry = this.store.get(id);
      return {
        id,
        node: this.graph.nodes[id],
        state: entry.state,
        badge: entry.badge,
        data: entry.data,
        element: this._nodes.get(id) || null,
        originalEvent: event || null
      };
    }

    // ----------------------------------------------------------------- state in

    /**
     * The one way state changes.
     *
     * @param {import('./state.js').StatePatch} patch - {nodeId: 'state'} or {nodeId: {state, badge, data, merge}}
     * @returns {LiveDiagram}
     */
    patch(patch) {
      const result = this.store.apply(patch);
      if (result.unknown.length) {
        this.emit('warning', { type: 'unknown-nodes', nodes: result.unknown });
      }
      if (result.changed.length || result.edgesChanged.length) {
        this.emit('change', {
          changed: result.changed,
          edgesChanged: result.edgesChanged,
          structural: result.structural,
          snapshot: this.store.snapshot()
        });
        // A state change repaints; a label change re-lays-out. Only the second
        // needs Mermaid again.
        this._schedule(result.structural && this.showIcons ? 'full' : 'restyle');
      }
      return this;
    }

    /**
     * Shorthand for a single node's state.
     * @param {string} id
     * @param {string} state
     */
    setState(id, state) { return this.patch({ [id]: state }); }

    /** Sets (or clears, with null) a node's badge. */
    badge(id, text) { return this.patch({ [id]: { badge: text } }); }

    /** Attaches an arbitrary payload to a node; `merge` layers onto the previous. */
    data(id, payload, merge) { return this.patch({ [id]: { data: payload, merge: merge === true } }); }

    /**
     * Anchors HTML to a node: a progress bar, a sparkline, a retry button, a line
     * of streaming output. It rides the same layer as badges, so it survives
     * re-renders and follows zoom and pan.
     *
     * Unlike the state methods this returns the ELEMENT, not the diagram: the
     * whole point of an overlay is that you keep updating it.
     *
     * @param {string} id - Node id
     * @param {Element|string|null} content - Element, HTML, or null to remove
     * @param {object} [options] - {position, offset, className, interactive}
     * @returns {?Element}
     */
    overlay(id, content, options) {
      const el = this.overlayLayer ? this.overlays.set(id, content, options) : null;
      this.overlays.sync(this._nodes, this.store.badges);
      return el;
    }

    /** Removes every custom overlay (badges are state, and stay). */
    clearOverlays() {
      this.overlays.clearItems();
      return this;
    }

    /** Every node back to the default state. */
    clear() {
      this.store.clear();
      this.emit('change', { changed: Object.keys(this.graph.nodes), structural: true, snapshot: this.store.snapshot() });
      this._schedule(this.showIcons ? 'full' : 'restyle');
      return this;
    }

    /** @returns {object} {states, badges, data} — safe to keep. */
    snapshot() { return this.store.snapshot(); }

    /** @returns {{state, badge, data}} */
    get(id) { return this.store.get(id); }

    /**
     * An edge's state. Edges are addressed as `from->to` (see `graph.edges[].id`).
     * @returns {{state, data}}
     */
    getEdge(id) { return this.store.getEdge(id); }

    /** Restores a snapshot wholesale (the primitive behind seek and diff). */
    restore(snapshot) {
      this.store.reset(snapshot);
      this.emit('change', { changed: Object.keys(this.graph.nodes), structural: true, snapshot: this.store.snapshot() });
      this._schedule(this.showIcons ? 'full' : 'restyle');
      return this;
    }

    // ---------------------------------------------------------------- structure

    /** Swaps the graph, keeping the state of nodes that still exist. */
    setGraph(graph) {
      this.graph = normalizeGraph(graph);
      this.store.setNodes(Object.keys(this.graph.nodes));
      this.store.setEdges(edgeIds(this.graph));
      this._didAutoFit = false;
      this._schedule('full');
      return this;
    }

    /** Swaps or extends the state vocabulary. */
    setStates(states, options) {
      this.states = normalizeStates(states, options || { extend: this.options.extendStates !== false });
      this._schedule('full');
      return this;
    }

    /** @param {string} theme - 'light' | 'dark' | 'auto' */
    setTheme(theme) {
      this.theme = theme || 'auto';
      this.root.setAttribute('data-theme', resolveTheme(this.theme));
      this._schedule('full');
      return this;
    }

    // ----------------------------------------------------------------- viewport

    zoom(scale) { this.viewport.zoom(scale); return this; }
    zoomIn() { this.viewport.zoomIn(); return this; }
    zoomOut() { this.viewport.zoomOut(); return this; }
    fit(padding) { this.viewport.fit(padding); return this; }
    resetView() { this.viewport.reset(); return this; }

    // ----------------------------------------------------------------- timeline

    /**
     * Builds a replay controller over a recorded event list.
     *
     * @param {Array<object>} events - [{t, node, state, badge?, data?}] or [{t, patch}]
     * @returns {Timeline}
     */
    timeline(events) {
      const tl = new Timeline(events, {
        apply: (patch) => this.patch(patch),
        onReset: () => { this.store.clear(); this._schedule(this.showIcons ? 'full' : 'restyle'); },
        onTick: (info) => this.emit('tick', info)
      });
      this._timelines.push(tl);
      return tl;
    }

    // ------------------------------------------------------------------ sources

    /**
     * Attaches a state source.
     *
     * A dropped connection is the failure mode that matters here. A socket that
     * reconnects does not bring back the events it missed, so a diagram that
     * simply keeps rendering is now confidently WRONG — showing a run that
     * finished ten minutes ago as still running. Two answers, both opt-in but
     * both cheap:
     *
     *   backfill  — asked for the truth on every (re)connect
     *   staleness — until the truth arrives, the diagram SAYS it is out of date
     *
     * @param {object|function} source - {start(emit, notify), stop()} or a start function
     * @param {object} [options]
     * @param {function(): Promise<object>} [options.backfill] - Resolves to a snapshot
     *   ({states, …} — applied with restore) or a patch (applied with patch)
     * @param {boolean} [options.markStale=true] - Show disconnection instead of hiding it
     * @param {number} [options.staleAfter] - Also go stale after this many ms with no
     *   update, for sources that fail silently rather than closing
     * @returns {function(): void} Detach.
     */
    connect(source, options) {
      const opts = options || {};
      const src = typeof source === 'function' ? { name: 'fn', start: source, stop: () => {} } : source;
      const markStale = opts.markStale !== false;
      let opened = false;

      const emit = (patch) => {
        this._lastUpdate = Date.now();
        if (this._connection !== 'live') this._setConnection('live', src);
        this._armStaleTimer(opts.staleAfter);
        this.patch(patch);
      };

      const runBackfill = async () => {
        if (typeof opts.backfill !== 'function') return;
        try {
          const truth = await opts.backfill();
          if (!truth) return;
          // A snapshot replaces everything (that is the point of asking for it);
          // anything else is treated as an ordinary patch.
          if (truth.states || truth.edges) this.restore(truth); else this.patch(truth);
          this.emit('backfill', { source: src.name, snapshot: this.store.snapshot() });
        } catch (error) {
          this.emit('error', { source: `backfill:${src.name}`, error });
        }
      };

      const notify = (kind, detail) => {
        if (kind === 'open') {
          const reconnected = opened;
          opened = true;
          this._setConnection('live', src);
          this._armStaleTimer(opts.staleAfter);
          this.emit('connection', { source: src.name, connected: true, reconnected });
          runBackfill();
        } else if (kind === 'close' || kind === 'error') {
          if (markStale) this._setConnection('stale', src);
          this.emit('connection', { source: src.name, connected: false, reconnected: false, detail });
        }
        this.emit(kind === 'error' ? 'error' : 'source', { source: src.name, kind, detail });
      };

      src.start(emit, notify);
      this._sources.push(src);
      // A source that never notifies (a plain function, a poll) still counts as
      // connected the moment it is attached.
      if (this._connection === 'none') this._setConnection('live', src);
      this._armStaleTimer(opts.staleAfter);

      return () => {
        src.stop();
        this._sources = this._sources.filter((s) => s !== src);
        // Detaching the last source leaves the diagram showing state nobody is
        // maintaining any more. Whether the socket dropped or you unplugged it
        // deliberately, what is on screen is now old — so it says so.
        if (!this._sources.length) this._setConnection(this._everLive ? 'stale' : 'none', src);
      };
    }

    /**
     * 'live' | 'stale' | 'none'. Reflected on the root as `data-ld-connection`,
     * so a stale diagram can be dimmed in CSS without any JavaScript of yours.
     */
    get connection() { return this._connection; }

    /** @returns {?number} When state last arrived, epoch ms. */
    get lastUpdate() { return this._lastUpdate || null; }

    _setConnection(next, src) {
      if (this._connection === next) return;
      if (next === 'live') this._everLive = true;
      this._connection = next;
      if (this.root) this.root.setAttribute('data-ld-connection', next);
      this.emit('stale', { stale: next === 'stale', source: src && src.name, since: this._lastUpdate || null });
    }

    _armStaleTimer(staleAfter) {
      if (this._staleTimer) { clearTimeout(this._staleTimer); this._staleTimer = null; }
      const after = Number(staleAfter);
      if (!Number.isFinite(after) || after <= 0) return;
      this._staleTimer = setTimeout(() => this._setConnection('stale', { name: 'timeout' }), after);
      if (this._staleTimer && typeof this._staleTimer.unref === 'function') this._staleTimer.unref();
    }

    // ------------------------------------------------------------------ drawing

    /** @returns {string} The current renderer definition (handy for export/debug). */
    definition() {
      if (typeof this.renderer.definition !== 'function') return '';
      return this.renderer.definition({
        graph: this.graph,
        snapshot: this.store.snapshot(),
        states: this.states,
        theme: this.theme,
        defaultState: this.defaultState
      });
    }

    /** @returns {string} The current SVG markup. */
    svg() {
      const el = this.canvas.querySelector('svg');
      return el ? el.outerHTML : '';
    }

    _schedule(kind) {
      if (this._destroyed) return;
      if (kind === 'full' || this._pending === 'full') this._pending = 'full';
      else this._pending = this._pending || kind;
      if (this._scheduled) return;
      this._scheduled = true;
      const run = () => {
        this._scheduled = false;
        const next = this._pending;
        this._pending = null;
        if (next === 'full') this.render();
        else this._restyle();
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
      else setTimeout(run, 0);
    }

    /**
     * Full re-render: re-parses and re-lays-out the diagram.
     *
     * Renders are serialised through a promise chain. Mermaid's render is async,
     * and two overlapping renders on one container race to write innerHTML — the
     * loser's node map then points at elements that are no longer in the
     * document. Awaiting this resolves when the diagram on screen is yours.
     *
     * @returns {Promise<LiveDiagram>}
     */
    render() {
      if (this._destroyed) return Promise.resolve(this);
      this._chain = (this._chain || Promise.resolve()).then(() => this._renderNow());
      return this._chain.then(() => this);
    }

    async _renderNow() {
      if (this._destroyed) return this;
      this._rendering = true;
      try {
        const result = await this.renderer.render({
          container: this.canvas,
          graph: this.graph,
          snapshot: this.store.snapshot(),
          states: this.states,
          theme: this.theme,
          defaultState: this.defaultState
        });
        this._nodes = result.nodes || new Map();
        this._edges = result.edges || new Map();
        this._decorate();
        // The render replaced the SVG and its projected zoom width; re-project
        // before overlays measure anything.
        this.viewport.resync();
        this.overlays.sync(this._nodes, this.store.badges);
        if (this.options.autoFit !== false && !this._didAutoFit) {
          this._didAutoFit = true;
          this.viewport.fit();
          // Not in bare mode: there the scroller IS the content-sized root, so
          // every refit resizes the thing being observed — a ratchet.
          if (this.options.autoFit === 'observe' && this.options.viewport !== false) this._observeResize();
        }
        this.emit('render', { nodes: this._nodes, definition: result.definition });
      } catch (err) {
        this.emit('error', { source: 'render', error: err });
      } finally {
        this._rendering = false;
      }
      return this;
    }

    /**
     * The fast path: repaint node styles on the existing SVG.
     *
     * Layout does not change when a node goes from running to success, so
     * re-parsing the whole diagram to recolour one box is waste — and worse, it
     * makes the canvas flash and drops the user's selection. Falls back to a
     * full render if the SVG is not there yet.
     */
    _restyle() {
      if (this._destroyed) return this;
      if (!this._nodes.size || !this.canvas.querySelector('svg')) return this.render();
      const theme = resolveTheme(this.theme);
      for (const [id, el] of this._nodes) {
        const entry = this.store.get(id);
        const declarations = parseStyle(styleFor(this.states, entry.state, theme));
        const shape = el.querySelector('rect, circle, ellipse, polygon, path');
        if (shape) {
          if (declarations.fill) shape.style.fill = declarations.fill;
          if (declarations.stroke) shape.style.stroke = declarations.stroke;
          if (declarations['stroke-width']) shape.style.strokeWidth = declarations['stroke-width'];
        }
        if (declarations.color) {
          el.querySelectorAll('.nodeLabel, .label, foreignObject div, text, tspan')
            .forEach((label) => { label.style.color = declarations.color; label.style.fill = declarations.color; });
        }
        el.setAttribute('data-ld-state', entry.state);
        const stateLabel = (this.states[entry.state] && this.states[entry.state].label) || entry.state;
        el.setAttribute('aria-label', `${this.graph.nodes[id].label}: ${stateLabel}`);
      }
      for (const [id, path] of this._edges) {
        const entry = this.store.getEdge(id);
        const declarations = parseStyle(edgeStyleFor(this.states, entry.state, theme));
        // Mermaid ships `#<id> .flowchart-link { stroke: … }`; an inline style
        // outranks it. Note that `.ld-edge` transitions `stroke`, so the computed
        // value only equals the target once the transition has finished.
        const set = (prop, value) => {
          path.style.removeProperty(prop);
          if (value) path.style.setProperty(prop, value);
        };
        set('stroke', declarations.stroke);
        set('stroke-width', declarations['stroke-width']);
        // Cleared explicitly: a state that dashes an edge must not leave the next
        // state dashed too.
        set('stroke-dasharray', declarations['stroke-dasharray']);
        path.setAttribute('data-ld-edge-state', entry.state);
      }
      this.overlays.sync(this._nodes, this.store.badges);
      this.emit('restyle', { nodes: this._nodes, edges: this._edges });
      return this;
    }

    /** Makes rendered nodes focusable, labelled and queryable from CSS. */
    _decorate() {
      for (const [id, path] of this._edges) {
        path.setAttribute('data-ld-edge-state', this.store.getEdge(id).state);
      }
      for (const [id, el] of this._nodes) {
        const entry = this.store.get(id);
        const node = this.graph.nodes[id];
        const stateLabel = (this.states[entry.state] && this.states[entry.state].label) || entry.state;
        el.setAttribute('data-ld-state', entry.state);
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', `${node.label}: ${stateLabel}`);
        if (node.description) el.setAttribute('title', node.description);
      }
    }

    /**
     * autoFit 'observe': debounced refit on container resize. Stopped forever by
     * the first hand zoom (see `onChange`); without ResizeObserver, fit-once.
     * fit() is silent when the scale is unchanged, so the refit's own scrollbar
     * wiggle cannot loop back through here.
     */
    _observeResize() {
      if (this._resizeObserver || typeof ResizeObserver === 'undefined') return;
      this._resizeObserver = new ResizeObserver(() => {
        if (this._resizeTimer) clearTimeout(this._resizeTimer);
        this._resizeTimer = setTimeout(() => {
          this._resizeTimer = null;
          if (!this._destroyed) this.viewport.fit();
        }, 150);
      });
      this._resizeObserver.observe(this.scroller);
    }

    _stopObserving() {
      if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
      if (this._resizeTimer) { clearTimeout(this._resizeTimer); this._resizeTimer = null; }
    }

    // ------------------------------------------------------------------ cleanup

    /** Detaches sources, timers, listeners and DOM. Safe to call twice. */
    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      for (const src of this._sources) { try { src.stop(); } catch (_) { /* already stopped */ } }
      this._sources = [];
      if (this._staleTimer) { clearTimeout(this._staleTimer); this._staleTimer = null; }
      for (const tl of this._timelines) tl.destroy();
      this._timelines = [];
      this.canvas.removeEventListener('click', this._onClick);
      this.canvas.removeEventListener('keydown', this._onKey);
      this.canvas.removeEventListener('mouseover', this._onOver);
      this.canvas.removeEventListener('mouseout', this._onOut);
      this._stopObserving();
      this.viewport.destroy();
      this.overlays.clear();
      if (typeof this.renderer.destroy === 'function') this.renderer.destroy();
      if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
      this.clear = () => this;
      this.emit('destroy', {});
      super.clear();
    }
  }

  /**
   * `fill:#fff,stroke:#000` -> {fill: '#fff', stroke: '#000'}.
   *
   * Splits only at top level: the commas inside `fill:rgba(0,0,0,.5)` or
   * `url("a,b")` belong to the value and stay in it. (A vocabulary never gets
   * this far with a functional colour — normalizeStates rewrites them to hex —
   * but this is a public export and takes arbitrary strings.)
   */
  function parseStyle(style) {
    const out = {};
    const parts = [];
    let current = '';
    let depth = 0;
    let quote = '';
    for (const ch of String(style || '')) {
      if (quote) { if (ch === quote) quote = ''; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
      current += ch;
    }
    parts.push(current);
    for (const part of parts) {
      const idx = part.indexOf(':');
      if (idx === -1) continue;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (key) out[key] = value;
    }
    return out;
  }

  // ── src/sources.js ────────────────────────────────────────────
  /**
   * State sources.
   *
   * A source is anything with `start(emit)` and `stop()`. That is the entire
   * interface, and it is small on purpose: the library must not care whether
   * your state arrives over a socket, an SSE stream, a poll, or a function you
   * call by hand. Three adapters ship because they cover most of it; a fourth is
   * fifteen lines of your own code.
   */

  /**
   * @param {string} url
   * @param {object} [options]
   * @param {function(any): ?object} [options.parse] - message -> patch (return null to ignore)
   * @param {Array<string>} [options.protocols]
   * @param {number} [options.retryMs=2000] - 0 disables reconnection
   */
  function webSocketSource(url, options) {
    const opts = options || {};
    const parse = opts.parse || ((msg) => msg);
    const retryMs = opts.retryMs == null ? 2000 : Number(opts.retryMs);
    let socket = null;
    let retry = null;
    let stopped = false;

    return {
      name: 'websocket',
      start(emit, notify) {
        stopped = false;
        const open = () => {
          if (stopped) return;
          socket = new WebSocket(url, opts.protocols);
          socket.addEventListener('open', () => notify && notify('open'));
          socket.addEventListener('message', (event) => {
            let payload = event.data;
            try { payload = JSON.parse(event.data); } catch (_) { /* plain text is allowed */ }
            const patch = parse(payload);
            if (patch) emit(patch);
          });
          socket.addEventListener('close', () => {
            notify && notify('close');
            if (!stopped && retryMs > 0) retry = setTimeout(open, retryMs);
          });
          socket.addEventListener('error', (err) => notify && notify('error', err));
        };
        open();
      },
      stop() {
        stopped = true;
        if (retry) { clearTimeout(retry); retry = null; }
        if (socket) { try { socket.close(); } catch (_) { /* already gone */ } socket = null; }
      }
    };
  }

  /**
   * Server-Sent Events.
   * @param {string} url
   * @param {object} [options]
   * @param {function(any): ?object} [options.parse]
   * @param {Array<string>} [options.events=['message']]
   */
  function eventSourceSource(url, options) {
    const opts = options || {};
    const parse = opts.parse || ((msg) => msg);
    const names = opts.events || ['message'];
    let es = null;

    return {
      name: 'eventsource',
      start(emit, notify) {
        es = new EventSource(url);
        for (const name of names) {
          es.addEventListener(name, (event) => {
            let payload = event.data;
            try { payload = JSON.parse(event.data); } catch (_) { /* plain text is allowed */ }
            const patch = parse(payload);
            if (patch) emit(patch);
          });
        }
        es.addEventListener('open', () => notify && notify('open'));
        es.addEventListener('error', (err) => notify && notify('error', err));
      },
      stop() { if (es) { es.close(); es = null; } }
    };
  }

  /**
   * Polls an async function. The honest choice for health checks and for any
   * backend that has no push channel.
   *
   * @param {function(): Promise<?object>} fn - Resolves to a patch
   * @param {object} [options]
   * @param {number} [options.interval=5000]
   * @param {boolean} [options.immediate=true]
   */
  function pollSource(fn, options) {
    const opts = options || {};
    const interval = Number(opts.interval) > 0 ? Number(opts.interval) : 5000;
    let timer = null;
    let stopped = false;

    return {
      name: 'poll',
      start(emit, notify) {
        stopped = false;
        const tick = async () => {
          if (stopped) return;
          try {
            const patch = await fn();
            if (patch) emit(patch);
          } catch (err) {
            notify && notify('error', err);
          }
          // Chained timeout, not setInterval: a slow poll must not stack.
          if (!stopped) timer = setTimeout(tick, interval);
        };
        if (opts.immediate === false) timer = setTimeout(tick, interval); else tick();
      },
      stop() { stopped = true; if (timer) { clearTimeout(timer); timer = null; } }
    };
  }

  // ── src/adapters/logs.js ──────────────────────────────────────
  /**
   * Log adapters — turning rows you already have into a timeline.
   *
   * Most systems that run things already write a row per state change: a JSONL
   * run log, a CI API response, a `status_history` table. The shape differs
   * every time, but the content is always the same three fields, so mapping is a
   * naming exercise rather than a parsing one.
   */

  /**
   * Maps arbitrary rows onto timeline events.
   *
   * @param {Array<object>} rows
   * @param {object} [mapping]
   * @param {string|function} [mapping.time='timestamp'] - Field name or accessor
   * @param {string|function} [mapping.node='nodeId']
   * @param {string|function} [mapping.state='status']
   * @param {function(object): (string|undefined)} [mapping.badge] - Return undefined to omit
   * @param {function(object): (object|undefined)} [mapping.data]
   * @returns {Array<object>} Events accepted by `diagram.timeline()`
   *
   * @example
   * const events = toTimelineEvents(rows, {
   *   time: 'ts', node: 'step', state: 'phase',
   *   badge: (row) => (row.ms ? `${(row.ms / 1000).toFixed(1)}s` : undefined)
   * });
   */
  function toTimelineEvents(rows, mapping) {
    const map = mapping || {};
    const read = (row, key, fallback) => {
      const accessor = map[key] || fallback;
      return typeof accessor === 'function' ? accessor(row) : row[accessor];
    };
    return (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const node = read(row, 'node', 'nodeId');
        const state = read(row, 'state', 'status');
        // A row that names no node or no state is not a state change — log lines
        // and heartbeats live in the same stream and must not become events.
        if (!node || !state) return null;
        const event = { t: Number(read(row, 'time', 'timestamp')) || 0, node, state };
        if (typeof map.badge === 'function') {
          const badge = map.badge(row);
          if (badge !== undefined) event.badge = badge;
        }
        if (typeof map.data === 'function') {
          const data = map.data(row);
          if (data !== undefined) event.data = data;
        }
        return event;
      })
      .filter(Boolean);
  }

  /**
   * Builds a graph from the rows themselves, for when you have a log but no
   * declared structure: nodes in first-seen order, chained in that order.
   *
   * A chain is a guess, and a deliberately visible one — pass a real graph
   * whenever you have one. It exists so that "I have a log" is enough to see
   * something.
   *
   * @param {Array<object>} events - Output of toTimelineEvents
   * @param {object} [options]
   * @param {'TB'|'LR'} [options.direction='LR']
   * @param {boolean} [options.chain=true] - Link nodes in first-seen order
   * @returns {object} A graph spec
   */
  function graphFromEvents(events, options) {
    const opts = options || {};
    const order = [];
    const seen = new Set();
    for (const event of events || []) {
      if (event && event.node && !seen.has(event.node)) { seen.add(event.node); order.push(event.node); }
    }
    const nodes = {};
    for (const id of order) nodes[id] = { label: id };
    const edges = opts.chain === false ? []
      : order.slice(1).map((to, i) => ({ from: order[i], to }));
    return { direction: opts.direction || 'LR', nodes, edges };
  }

  // ── src/adapters/github-actions.js ────────────────────────────
  /**
   * GitHub Actions adapter.
   *
   * `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs` returns everything
   * needed to draw a workflow run as a live diagram — except the one thing you
   * would most like: the `needs:` graph, which lives in the workflow YAML and is
   * not exposed by that endpoint. So this adapter takes it either way:
   *
   *   fromGitHubActions(payload)                       // infers stages from timing
   *   fromGitHubActions(payload, { needs: {…} })       // exact, from your YAML
   *
   * The inferred form groups jobs into stages by when they started, which is
   * what a reader of a CI dashboard actually wants to see, and never invents an
   * edge it cannot justify (see `linkStages`).
   */

  /** GitHub's own vocabulary, mapped to states this library will style. */
  const CONCLUSION_STATES = {
    success: 'success',
    failure: 'error',
    timed_out: 'error',
    startup_failure: 'error',
    cancelled: 'cancelled',
    skipped: 'skipped',
    neutral: 'skipped',
    stale: 'skipped',
    action_required: 'waiting'
  };

  const STATUS_STATES = {
    queued: 'queued',
    waiting: 'waiting',
    pending: 'queued',
    requested: 'queued',
    in_progress: 'running',
    completed: 'success'
  };

  /** `cancelled` is not in the default vocabulary; everything else already is. */
  const GITHUB_STATES = {
    cancelled: {
      label: 'cancelled', icon: '⊘',
      style: 'fill:#f1f5f9,stroke:#94a3b8,color:#475569',
      darkStyle: 'fill:#1e293b,stroke:#64748b,color:#94a3b8'
    }
  };

  /** @returns {string} The state a job or step is in right now. */
  function stateOf(item) {
    if (!item) return 'idle';
    if (item.status === 'completed') return CONCLUSION_STATES[item.conclusion] || 'success';
    return STATUS_STATES[item.status] || 'idle';
  }

  /** Job names are free text; node ids are not. */
  function toId(name, taken) {
    let id = String(name || 'job')
      .normalize('NFKD').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 'j$1') || 'job';
    if (!taken) return id;
    let unique = id;
    let n = 2;
    while (taken.has(unique)) unique = `${id}_${n++}`;
    taken.add(unique);
    return unique;
  }

  function ms(from, to) {
    const a = from ? Date.parse(from) : NaN;
    const b = to ? Date.parse(to) : NaN;
    return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : null;
  }

  function duration(item) {
    const took = ms(item.started_at, item.completed_at);
    if (took == null) return null;
    return took >= 60000 ? `${Math.floor(took / 60000)}m ${Math.round((took % 60000) / 1000)}s` : `${(took / 1000).toFixed(1)}s`;
  }

  /**
   * Groups jobs into stages by start time: everything that started within
   * `gapMs` of the stage's first job belongs to that stage. Matches how people
   * read a pipeline — "these three ran together" — without pretending to know
   * dependencies GitHub did not tell us about.
   */
  function toStages(jobs, gapMs) {
    const gap = Number.isFinite(gapMs) ? gapMs : 5000;
    const sorted = jobs.slice().sort((a, b) => Date.parse(a.started_at || 0) - Date.parse(b.started_at || 0));
    const stages = [];
    for (const job of sorted) {
      const at = Date.parse(job.started_at || 0) || 0;
      const stage = stages[stages.length - 1];
      if (stage && at - stage.at <= gap) stage.jobs.push(job);
      else stages.push({ at, jobs: [job] });
    }
    return stages.map((s) => s.jobs);
  }

  /**
   * Edges between consecutive stages — but only where one side is a single job,
   * so the edge means "this, then those" or "those, then this".
   *
   * Between two multi-job stages there is no honest single-edge story (which of
   * the three fed which of the three?), and drawing every pair produces a hairball
   * that says less than the grouping already does. So it draws nothing there, and
   * the stage subgraphs carry the order.
   */
  function linkStages(stageIds) {
    const edges = [];
    for (let i = 0; i < stageIds.length - 1; i++) {
      const from = stageIds[i];
      const to = stageIds[i + 1];
      if (from.length !== 1 && to.length !== 1) continue;
      for (const a of from) for (const b of to) edges.push({ from: a, to: b });
    }
    return edges;
  }

  /**
   * Maps a jobs payload onto a graph, a state vocabulary and a replayable
   * timeline.
   *
   * @param {object|Array} payload - The `/jobs` response, or its `jobs` array
   * @param {object} [options]
   * @param {Object.<string, Array<string>>} [options.needs] - Exact dependencies, keyed by job name
   * @param {'jobs'|'steps'} [options.mode='jobs']
   * @param {string} [options.job] - Which job's steps to draw in `steps` mode
   * @param {'TB'|'LR'} [options.direction='LR']
   * @param {number} [options.stageGapMs=5000] - Start-time tolerance when inferring stages
   * @param {boolean} [options.groups=true] - Render inferred stages as subgraphs
   * @returns {{graph: object, states: object, events: Array, initial: object, meta: object}}
   */
  function fromGitHubActions(payload, options) {
    const opts = options || {};
    const all = Array.isArray(payload) ? payload : (payload && payload.jobs) || [];
    if (!all.length) throw new Error('fromGitHubActions: no jobs in the payload');

    if (opts.mode === 'steps') return fromSteps(all, opts);

    const taken = new Set();
    const byName = new Map();
    const nodes = {};
    const initial = {};
    const events = [];

    for (const job of all) {
      const id = toId(job.name, taken);
      byName.set(job.name, id);
      nodes[id] = {
        label: job.name,
        shape: 'rect',
        description: `${job.status}${job.conclusion ? ` · ${job.conclusion}` : ''}`,
        meta: { url: job.html_url, runner: job.runner_name || null, steps: (job.steps || []).length, id: job.id }
      };
      const state = stateOf(job);
      initial[id] = { state, badge: duration(job), data: { conclusion: job.conclusion, url: job.html_url } };

      if (job.started_at) events.push({ t: Date.parse(job.started_at), node: id, state: 'running' });
      if (job.completed_at) {
        events.push({ t: Date.parse(job.completed_at), node: id, state, badge: duration(job),
                      data: { conclusion: job.conclusion, url: job.html_url } });
      }
    }

    let edges = [];
    let groups = [];
    let inferred = true;

    if (opts.needs && typeof opts.needs === 'object') {
      inferred = false;
      for (const [name, deps] of Object.entries(opts.needs)) {
        const to = byName.get(name);
        if (!to) continue;
        for (const dep of [].concat(deps || [])) {
          const from = byName.get(dep);
          if (from) edges.push({ from, to });
        }
      }
    } else {
      const stages = toStages(all, opts.stageGapMs).map((stage) => stage.map((job) => byName.get(job.name)));
      edges = linkStages(stages);
      if (opts.groups !== false && stages.length > 1) {
        groups = stages.map((ids, i) => ({ id: `stage_${i + 1}`, label: `Stage ${i + 1}`, nodes: ids }));
      }
    }

    return {
      graph: { direction: opts.direction || 'LR', nodes, edges, groups },
      states: GITHUB_STATES,
      initial,
      events: events.sort((a, b) => a.t - b.t),
      meta: {
        jobs: all.length,
        inferredDependencies: inferred,
        startedAt: all.map((j) => j.started_at).filter(Boolean).sort()[0] || null,
        conclusion: all.some((j) => j.conclusion === 'failure') ? 'failure'
          : all.every((j) => j.conclusion === 'success') ? 'success' : 'mixed'
      }
    };
  }

  /** One job's steps, in order — the closest thing GitHub gives you to a real sequence. */
  function fromSteps(jobs, opts) {
    const job = opts.job ? jobs.find((j) => j.name === opts.job) : jobs[0];
    if (!job) throw new Error(`fromGitHubActions: no job named "${opts.job}"`);
    const steps = (job.steps || []).slice().sort((a, b) => (a.number || 0) - (b.number || 0));
    if (!steps.length) throw new Error(`fromGitHubActions: job "${job.name}" has no steps in this payload`);

    const taken = new Set();
    const nodes = {};
    const edges = [];
    const initial = {};
    const events = [];
    let previous = null;

    for (const step of steps) {
      const id = toId(step.name, taken);
      nodes[id] = { label: step.name, shape: 'rect', description: `step ${step.number}` };
      initial[id] = { state: stateOf(step), badge: duration(step) };
      if (previous) edges.push({ from: previous, to: id });
      previous = id;
      if (step.started_at) events.push({ t: Date.parse(step.started_at), node: id, state: 'running' });
      if (step.completed_at) events.push({ t: Date.parse(step.completed_at), node: id, state: stateOf(step), badge: duration(step) });
    }

    return {
      graph: { direction: opts.direction || 'TB', nodes, edges, groups: [] },
      states: GITHUB_STATES,
      initial,
      events: events.sort((a, b) => a.t - b.t),
      meta: { job: job.name, steps: steps.length, inferredDependencies: false }
    };
  }

  // ── src/element.js ────────────────────────────────────────────
  /**
   * `<live-diagram>` — the custom element.
   *
   * A class is the honest core, but "import it, hold a ref, mount it in an
   * effect, destroy it on unmount" is four decisions before anyone sees a
   * diagram. One custom element works unchanged in React, Vue, Svelte, Astro,
   * Rails, Django, WordPress and every documentation site, which makes it the
   * cheapest integration this library can offer.
   *
   * Deliberately light DOM, not shadow DOM: the stylesheet, your own CSS
   * overrides and Mermaid's rendering all reach the diagram normally, and
   * `document.querySelector('[data-ld-node="build"]')` keeps working.
   */




  const BOOLEAN_ATTRS = ['controls', 'icons', 'bare', 'no-fit'];

  /**
   * Parses an attribute that may be inline JSON, a `#selector` pointing at a
   * script tag, or — for `graph` — plain Mermaid source.
   */
  function readJsonAttr(el, name, allowMermaid) {
    const raw = el.getAttribute(name);
    if (!raw) return null;
    const value = raw.trim();
    if (value.startsWith('#')) {
      const source = el.ownerDocument.querySelector(value);
      if (!source) throw new Error(`<live-diagram> ${name}="${value}" — no such element`);
      const text = source.textContent.trim();
      try { return JSON.parse(text); } catch (err) {
        if (allowMermaid && looksLikeMermaid(text)) return text;
        throw err;
      }
    }
    try {
      return JSON.parse(value);
    } catch (err) {
      if (allowMermaid && looksLikeMermaid(value)) return value;   // Mermaid source, handed on as-is
      throw new Error(`<live-diagram> ${name} is not valid JSON: ${err.message}`);
    }
  }

  /**
   * Defines the element. Called automatically by the UMD build (the drop-in-a-page
   * path); ESM users call it themselves so importing the library stays free of
   * side effects.
   *
   * @param {string} [tagName='live-diagram']
   * @param {object} [globalScope] - Where to find customElements (tests pass a stub)
   * @returns {?Function} The element class, or null if it was already defined.
   */
  function defineLiveDiagram(tagName, globalScope) {
    const scope = globalScope || (typeof globalThis !== 'undefined' ? globalThis : null);
    const name = tagName || 'live-diagram';
    if (!scope || !scope.customElements || !scope.HTMLElement) return null;
    if (scope.customElements.get(name)) return scope.customElements.get(name);

    class LiveDiagramElement extends scope.HTMLElement {
      static get observedAttributes() { return ['graph', 'states', 'theme', 'src', 'height']; }

      constructor() {
        super();
        this.diagram = null;
        this._mounting = false;
      }

      connectedCallback() {
        if (!this.style.height && !this.getAttribute('height')) this.style.height = '420px';
        else if (this.getAttribute('height')) this.style.height = this.getAttribute('height');
        this.style.display = this.style.display || 'block';
        this._mount();
      }

      disconnectedCallback() {
        if (this.diagram) { this.diagram.destroy(); this.diagram = null; }
      }

      attributeChangedCallback(name, before, after) {
        if (before === after || !this.isConnected) return;
        if (name === 'theme' && this.diagram) { this.diagram.setTheme(after || 'auto'); return; }
        if (name === 'height') { this.style.height = after || '420px'; return; }
        this._mount();  // graph / states / src changed: rebuild
      }

      // ---- the class API, forwarded so the element is not a dead end ----------
      patch(patch) { return this.diagram && this.diagram.patch(patch); }
      setState(id, state) { return this.diagram && this.diagram.setState(id, state); }
      badge(id, text) { return this.diagram && this.diagram.badge(id, text); }
      snapshot() { return this.diagram && this.diagram.snapshot(); }
      restore(snapshot) { return this.diagram && this.diagram.restore(snapshot); }
      clear() { return this.diagram && this.diagram.clear(); }
      fit() { return this.diagram && this.diagram.fit(); }
      timeline(events) { return this.diagram && this.diagram.timeline(events); }
      connect(source) { return this.diagram && this.diagram.connect(source); }

      /** @param {object} graph - Set the graph as a property (no JSON round-trip). */
      set graph(graph) { this._graph = graph; if (this.isConnected) this._mount(); }
      get graph() { return this._graph || (this.diagram && this.diagram.graph) || null; }

      set states(states) { this._states = states; if (this.isConnected) this._mount(); }
      get states() { return this._states || null; }

      async _mount() {
        if (this._mounting) return;
        this._mounting = true;
        try {
          let graph = this._graph || readJsonAttr(this, 'graph', true);
          let states = this._states || readJsonAttr(this, 'states');
          let initial = readJsonAttr(this, 'initial');
          let events = null;

          const src = this.getAttribute('src');
          if (src) {
            const response = await fetch(src, { credentials: 'same-origin' });
            if (!response.ok) throw new Error(`<live-diagram src="${src}"> responded ${response.status}`);
            const payload = await response.json();
            // The file may be a bare graph or a full spec.
            graph = payload.graph || (payload.nodes ? payload : graph);
            states = payload.states || states;
            initial = payload.initial || initial;
            events = payload.events || null;
          }

          if (!graph) throw new Error('<live-diagram> needs a `graph` attribute, a `src`, or a .graph property');

          if (this.diagram) this.diagram.destroy();
          this.innerHTML = '';

          const flags = {};
          for (const attr of BOOLEAN_ATTRS) flags[attr] = this.hasAttribute(attr);

          this.diagram = new LiveDiagram({
            mount: this,
            graph: (this.getAttribute('direction') && typeof graph === 'object')
              ? { ...graph, direction: this.getAttribute('direction') } : graph,
            states,
            initial,
            theme: this.getAttribute('theme') || 'auto',
            defaultState: this.getAttribute('default-state') || undefined,
            controls: flags.controls,
            showIcons: flags.icons,
            autoFit: flags['no-fit'] ? false : (this.getAttribute('fit') === 'observe' ? 'observe' : true),
            viewport: flags.bare ? false : undefined
          });

          // DOM events, so a listener can be attached from anywhere — including
          // frameworks that never import this library.
          this.diagram.on('nodeClick', (detail) => this._emit('nodeclick', detail));
          this.diagram.on('nodeHover', (detail) => this._emit('nodehover', detail));
          this.diagram.on('change', (detail) => this._emit('statechange', detail));
          this.diagram.on('error', (detail) => this._emit('diagramerror', detail));

          if (events) {
            this.replay = this.diagram.timeline(events);
            if (this.hasAttribute('autoplay')) {
              this.replay.play({ speed: Number(this.getAttribute('speed')) || 1, loop: this.hasAttribute('loop') });
            } else {
              this.replay.seek(this.replay.duration);
            }
          }

          await this.diagram.render();
          this._emit('ready', { diagram: this.diagram });
        } catch (err) {
          this._emit('diagramerror', { source: 'element', error: err });
          // Say so in the page rather than only in the console: a silent empty
          // box is the worst possible failure for a copy-pasted snippet.
          this.innerHTML = `<pre style="margin:0;padding:12px;font:12px ui-monospace,monospace;color:#b91c1c;white-space:pre-wrap">${
            String(err && err.message || err).replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</pre>`;
        } finally {
          this._mounting = false;
        }
      }

      _emit(name, detail) {
        this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
      }
    }

    scope.customElements.define(name, LiveDiagramElement);
    return LiveDiagramElement;
  }

  // ── src/hydrate.js ────────────────────────────────────────────
  /**
   * Hydration — turning static blocks in a rendered page into live diagrams.
   *
   * Documentation sites are where Mermaid users already are, and every one of
   * them has a different plugin system. Rather than write four plugins, this
   * scans the *rendered output* those systems all produce and mounts diagrams in
   * place. A docs author writes a fenced block; a site owner adds two script
   * tags. Nobody writes a plugin.
   *
   * Three sources are recognised:
   *
   *   <script type="application/live-diagram+json">{ … }</script>
   *   ```live-diagram  →  <pre><code class="language-live-diagram">{ … }</code></pre>
   *   <div data-live-diagram='{ … }'></div>
   *
   * The payload is a spec — `{graph, states, initial, events, …}` — or, for the
   * common case, a bare graph (`{nodes, edges}`), detected by its own shape.
   */




  const HYDRATED = 'data-ld-hydrated';

  /**
   * Pulls the spec out of a block.
   *
   * A block may hold JSON *or* plain Mermaid source, because the people writing
   * these blocks already have Mermaid diagrams and should not have to translate
   * one into JSON to make it live.
   */
  function readSpec(text, where) {
    const trimmed = String(text).trim();
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      if (looksLikeMermaid(trimmed)) return { graph: trimmed };
      throw new Error(`live-diagram: ${where} contains neither valid JSON nor Mermaid source — ${err.message}`);
    }
  }

  function normalizeSpec(spec) {
    if (!spec || typeof spec !== 'object') throw new Error('live-diagram: empty spec');
    // A bare graph is the shape people write first; accept it.
    return spec.graph || spec.nodes ? (spec.graph ? spec : { graph: spec }) : spec;
  }

  /**
   * The element a highlighter wrapped the block in — hiding only the <code>
   * would leave an empty box behind on half these sites.
   */
  function outermostBlock(el) {
    let block = el.matches('pre, div') ? el : el.closest('pre') || el;
    const parent = block.parentElement;
    if (parent && /highlight|language-|code-?block/i.test(parent.className || '') && parent.children.length === 1) {
      block = parent;
    }
    return block;
  }

  /**
   * Mounts one spec into a container.
   * @returns {LiveDiagram}
   */
  function mountSpec(spec, container, defaults) {
    const config = normalizeSpec(spec);
    const options = defaults || {};
    if (config.height) container.style.height = config.height;
    else if (!container.style.height) container.style.height = options.height || '420px';

    const diagram = new LiveDiagram({
      mount: container,
      graph: config.graph,
      states: config.states,
      initial: config.initial,
      theme: config.theme || options.theme || 'auto',
      defaultState: config.defaultState,
      controls: config.controls !== undefined ? config.controls : options.controls !== false,
      showIcons: config.showIcons === true,
      autoFit: config.autoFit !== false
    });

    if (Array.isArray(config.events) && config.events.length) {
      const timeline = diagram.timeline(config.events);
      diagram.replay = timeline;
      // A diagram in documentation should say something the moment it is seen:
      // either it plays, or it shows the end state of what it recorded.
      if (config.autoplay) timeline.play({ speed: config.speed || 1, loop: config.loop !== false });
      else timeline.seek(timeline.duration);
    }
    return diagram;
  }

  /**
   * Finds every hydratable block under `root` and mounts it.
   *
   * @param {Element|Document} [root=document]
   * @param {object} [options] - Defaults: {height, theme, controls, fence}
   * @returns {Array<LiveDiagram>}
   */
  function hydrate(root, options) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) return [];
    const opts = options || {};
    const fence = opts.fence || 'live-diagram';
    const doc = scope.ownerDocument || scope;
    const mounted = [];

    // Every static-site generator marks a fenced block differently: Docusaurus
    // puts `language-x` on the <pre>, VitePress on a wrapping <div>, Jekyll on an
    // outer div, Hugo uses data-lang, markdown-it puts it on the <code>. Matching
    // the class wherever it lands covers all of them; the script-block form below
    // covers the ones that strip it entirely.
    const seen = new Set();
    const targets = [];
    const collect = (selector) => {
      for (const el of scope.querySelectorAll(selector)) {
        if (!seen.has(el)) { seen.add(el); targets.push(el); }
      }
    };
    collect(`script[type="application/live-diagram+json"]:not([${HYDRATED}])`);
    collect(`.language-${fence}:not([${HYDRATED}]), [data-lang="${fence}"]:not([${HYDRATED}])`);
    collect(`[data-live-diagram]:not([${HYDRATED}])`);

    for (const source of targets) {
      // Mermaid must be present before anything is replaced — otherwise a missing
      // <script> tag silently eats the reader's content.
      if (!globalThis.mermaid) {
        console.error('live-diagram: Mermaid is not loaded, leaving the source block in place.');
        return mounted;
      }
      // Marked before parsing, not after: a block with a broken spec must be
      // complained about once, not on every hydrate() call.
      source.setAttribute(HYDRATED, '');

      try {
        let spec;
        let container;

        if (source.tagName === 'SCRIPT') {
          spec = readSpec(source.textContent, 'a live-diagram script block');
          container = doc.createElement('div');
          source.parentNode.insertBefore(container, source.nextSibling);
        } else if (source.hasAttribute('data-live-diagram')) {
          spec = readSpec(source.getAttribute('data-live-diagram'), 'a data-live-diagram attribute');
          container = source;
        } else {
          // A fenced block, wherever the language class landed. The text is read
          // from the <code>, so a syntax highlighter's <span> soup is harmless.
          const code = source.matches('code') ? source : source.querySelector('code') || source;
          spec = readSpec(code.textContent, `a \`\`\`${fence} block`);
          container = doc.createElement('div');
          const block = outermostBlock(source);
          block.parentNode.insertBefore(container, block);
          block.setAttribute(HYDRATED, '');
          block.style.display = 'none';   // hidden, not removed: view-source still shows the spec
        }

        container.classList.add('ld-hydrated');
        mounted.push(mountSpec(spec, container, opts));
      } catch (err) {
        console.error(err.message || err);
        // The block stays visible and readable — a broken spec must not blank a
        // paragraph of someone's documentation.
      }
    }
    return mounted;
  }

  /**
   * Wires `<script src="…/live-diagram.umd.js" data-auto>` to hydrate on load.
   * The two-tag docs-site install, and the reason this file exists.
   *
   * @param {?Element} script - The script element that loaded the library
   */
  function autoHydrate(script) {
    if (!script || !script.hasAttribute || !script.hasAttribute('data-auto')) return false;
    const options = {
      fence: script.getAttribute('data-fence') || undefined,
      theme: script.getAttribute('data-theme') || undefined,
      height: script.getAttribute('data-height') || undefined,
      controls: script.getAttribute('data-controls') !== 'false'
    };
    const run = () => hydrate(document, options);
    if (typeof document === 'undefined') return false;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
    return true;
  }

  // ── src/export.js ─────────────────────────────────────────────
  /**
   * Getting a diagram back out: as a file, or as a link.
   *
   * A diagram that only exists in a browser tab is half a tool. People put these
   * in incident reports, in slide decks, and in messages to colleagues — and
   * "screenshot it" loses the crispness, the badges and the state at the same
   * time.
   *
   * Two honest limitations, both stated rather than papered over: badges and
   * overlays are HTML, so an SVG export redraws badges in SVG and cannot carry
   * arbitrary overlay content; and PNG rasterisation cannot render Mermaid's
   * default HTML labels (see `toPNG`).
   */

  const XMLNS = 'http://www.w3.org/2000/svg';

  /** Serialises the rendered SVG, standalone and self-contained. */
  function cloneSvg(diagram) {
    const svg = diagram.canvas && diagram.canvas.querySelector('svg');
    if (!svg) throw new Error('live-diagram: nothing rendered yet — await diagram.render() first');
    const clone = svg.cloneNode(true);
    const box = svg.getBoundingClientRect();
    const scale = diagram.viewport ? (diagram.viewport.scale || 1) : 1;
    // The on-page SVG carries the zoom projection as an inline width; an export
    // is standalone and must not inherit the viewer's zoom level.
    clone.style.removeProperty('width');
    if (!clone.getAttribute('style')) clone.removeAttribute('style');
    clone.setAttribute('xmlns', XMLNS);
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    // Mermaid sizes its SVG with a viewBox and a percentage width; an exported
    // file needs real dimensions or every consumer guesses differently.
    if (!clone.getAttribute('viewBox') && svg.viewBox && svg.viewBox.baseVal) {
      const v = svg.viewBox.baseVal;
      clone.setAttribute('viewBox', `${v.x} ${v.y} ${v.width} ${v.height}`);
    }
    clone.setAttribute('width', Math.round(box.width / scale));
    clone.setAttribute('height', Math.round(box.height / scale));
    return { svg, clone };
  }

  /** The node's box in the root SVG's coordinate system. */
  function boxInSvgSpace(el) {
    const box = el.getBBox();
    const ctm = el.getCTM();
    if (!ctm) return null;
    const point = (x, y) => ({ x: ctm.a * x + ctm.c * y + ctm.e, y: ctm.b * x + ctm.d * y + ctm.f });
    const topLeft = point(box.x, box.y);
    const bottomRight = point(box.x + box.width, box.y + box.height);
    return { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
  }

  /** Redraws badge chips as SVG, since the originals are HTML. */
  function drawBadges(diagram, clone) {
    const badges = diagram.snapshot().badges;
    const ids = Object.keys(badges || {});
    if (!ids.length) return;
    const doc = clone.ownerDocument;
    const layer = doc.createElementNS(XMLNS, 'g');
    layer.setAttribute('class', 'ld-export-badges');

    for (const id of ids) {
      const el = diagram._nodes.get(id);
      if (!el) continue;
      const box = boxInSvgSpace(el);
      if (!box) continue;
      const text = String(badges[id]);
      const width = Math.max(22, text.length * 6.6 + 12);
      const height = 17;
      const x = box.x + box.width - width / 2;
      const y = box.y - height / 2;

      const rect = doc.createElementNS(XMLNS, 'rect');
      rect.setAttribute('x', x); rect.setAttribute('y', y);
      rect.setAttribute('rx', height / 2);
      rect.setAttribute('width', width); rect.setAttribute('height', height);
      rect.setAttribute('fill', '#0f172a');

      const label = doc.createElementNS(XMLNS, 'text');
      label.setAttribute('x', x + width / 2); label.setAttribute('y', y + height / 2 + 4);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace');
      label.setAttribute('font-size', '11');
      label.setAttribute('font-weight', '600');
      label.setAttribute('fill', '#f8fafc');
      label.textContent = text;

      layer.appendChild(rect);
      layer.appendChild(label);
    }
    clone.appendChild(layer);
  }

  /**
   * The diagram as a standalone SVG string.
   *
   * @param {object} diagram - A LiveDiagram
   * @param {object} [options]
   * @param {string} [options.background] - A colour behind the diagram (default: transparent)
   * @param {boolean} [options.badges=true] - Redraw badge chips into the SVG
   * @returns {string}
   */
  function toSVG(diagram, options) {
    const opts = options || {};
    const { clone } = cloneSvg(diagram);

    if (opts.background) {
      const doc = clone.ownerDocument;
      const rect = doc.createElementNS(XMLNS, 'rect');
      rect.setAttribute('x', '0'); rect.setAttribute('y', '0');
      rect.setAttribute('width', '100%'); rect.setAttribute('height', '100%');
      rect.setAttribute('fill', opts.background);
      clone.insertBefore(rect, clone.firstChild);
    }
    if (opts.badges !== false) drawBadges(diagram, clone);

    const markup = new XMLSerializer().serializeToString(clone);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`;
  }

  /**
   * The diagram as a PNG blob.
   *
   * Mermaid renders node labels as HTML inside `<foreignObject>` by default, and
   * no browser rasterises foreignObject when an SVG is drawn to a canvas — the
   * labels would silently vanish. Rather than ship an export that quietly loses
   * every word, this refuses and says how to fix it.
   *
   * @param {object} diagram
   * @param {object} [options]
   * @param {number} [options.scale=2]
   * @param {string} [options.background='#ffffff']
   * @returns {Promise<Blob>}
   */
  function toPNG(diagram, options) {
    const opts = options || {};
    const svgEl = diagram.canvas && diagram.canvas.querySelector('svg');
    if (svgEl && svgEl.querySelector('foreignObject')) {
      throw new Error(
        'live-diagram: this diagram uses Mermaid HTML labels, which cannot be rasterised. ' +
        'Render it with mermaidRenderer({ svgLabels: true }) to export PNG, ' +
        'or use toSVG(), which keeps them.'
      );
    }

    const scale = Number(opts.scale) > 0 ? Number(opts.scale) : 2;
    const markup = toSVG(diagram, { ...opts, background: opts.background || '#ffffff' });
    const { clone } = cloneSvg(diagram);
    const width = Number(clone.getAttribute('width')) || 800;
    const height = Number(clone.getAttribute('height')) || 600;

    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('live-diagram: canvas produced no image'))), 'image/png');
      };
      image.onerror = () => reject(new Error('live-diagram: the SVG could not be rasterised'));
      // No external references are ever inlined, so the canvas stays untainted.
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    });
  }

  /**
   * Saves the diagram as a file.
   *
   * A page inside a sandboxed viewer (a Claude artifact, some embeds) blocks
   * downloads it did not initiate; there the honest move is to hand the caller
   * `toSVG()` and let them copy it.
   *
   * @param {object} diagram
   * @param {object} [options] - {format: 'svg'|'png', filename, ...toSVG/toPNG options}
   * @returns {Promise<void>}
   */
  async function download(diagram, options) {
    const opts = options || {};
    const format = opts.format === 'png' ? 'png' : 'svg';
    const name = opts.filename || `diagram.${format}`;
    const blob = format === 'png'
      ? await toPNG(diagram, opts)
      : new Blob([toSVG(diagram, opts)], { type: 'image/svg+xml;charset=utf-8' });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ---------------------------------------------------------------- share links

  /** URL-safe base64 that survives non-ASCII labels. */
  function encodeBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeBase64(text) {
    const padded = String(text).replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  /**
   * Encodes anything JSON-able into a URL-safe string.
   * @param {object} payload
   * @returns {string}
   */
  function encodeState(payload) {
    return encodeBase64(JSON.stringify(payload));
  }

  /**
   * The inverse. Returns null for anything it cannot read, because a mangled
   * link should land on the default view rather than on an error.
   * @param {string} text
   * @returns {?object}
   */
  function decodeState(text) {
    if (!text) return null;
    try {
      return JSON.parse(decodeBase64(String(text).replace(/^#/, '')));
    } catch (_) {
      return null;
    }
  }

  /**
   * "Send someone this exact diagram, in this exact state."
   *
   * @param {object} diagram
   * @param {object} [options]
   * @param {string|object} [options.graph] - Prefer the Mermaid source you started from; it is
   *   far shorter than the expanded graph and is what a human would want to read
   * @param {string} [options.url] - Base URL (defaults to the current location)
   * @returns {string}
   */
  function shareUrl(diagram, options) {
    const opts = options || {};
    const snapshot = diagram.snapshot();
    const payload = {
      graph: opts.graph || { direction: diagram.graph.direction, nodes: diagram.graph.nodes, edges: diagram.graph.edges, groups: diagram.graph.groups },
      states: snapshot.states,
      edges: snapshot.edges,
      badges: snapshot.badges
    };
    const base = (opts.url || (typeof location !== 'undefined' ? location.href : '')).split('#')[0];
    return `${base}#${encodeState(payload)}`;
  }

  /**
   * Reads a payload written by `shareUrl` and applies it.
   * @param {object} diagram
   * @param {string} [hash] - Defaults to the current location hash
   * @returns {boolean} Whether anything was applied
   */
  function applyShared(diagram, hash) {
    const payload = decodeState(hash == null ? (typeof location !== 'undefined' ? location.hash : '') : hash);
    if (!payload || !payload.graph) return false;
    diagram.setGraph(payload.graph);
    diagram.restore({ states: payload.states || {}, edges: payload.edges || {}, badges: payload.badges || {} });
    return true;
  }

  // ── src/kit/legend.js ─────────────────────────────────────────
  /**
   * A legend, built from the state vocabulary the diagram already holds.
   *
   * Every demo written against this library hand-rolled one of these, which is
   * the clearest possible signal that it belongs here. It is opt-in: the core
   * renders diagrams, and none of the kit is loaded into a page that never calls
   * it.
   */





  /**
   * @param {object} diagram - A LiveDiagram
   * @param {object} [options]
   * @param {Element|string} [options.mount] - Where to put it (else use `.el` yourself)
   * @param {boolean} [options.counts=true] - Show how many nodes are in each state
   * @param {boolean} [options.hideUnused=false] - Only show states in use
   * @param {Array<string>} [options.only] - Restrict to these state names, in this order
   * @returns {{el: Element, update: function, destroy: function}}
   */
  function legend(diagram, options) {
    const opts = options || {};
    const doc = diagram.root.ownerDocument;
    const el = doc.createElement('div');
    el.className = 'ld-legend';

    const update = () => {
      const theme = resolveTheme(diagram.theme);
      const snapshot = diagram.snapshot();
      const tally = {};
      for (const state of Object.values(snapshot.states)) tally[state] = (tally[state] || 0) + 1;

      const names = opts.only || Object.keys(diagram.states);
      el.innerHTML = '';
      for (const name of names) {
        const entry = diagram.states[name];
        if (!entry) continue;
        const count = tally[name] || 0;
        if (opts.hideUnused && !count) continue;

        const declarations = parseStyle(styleFor(diagram.states, name, theme));
        const item = doc.createElement('span');
        item.className = 'ld-legend__item';
        item.setAttribute('data-ld-legend-state', name);

        const swatch = doc.createElement('i');
        swatch.className = 'ld-legend__swatch';
        swatch.style.background = declarations.fill || 'transparent';
        swatch.style.borderColor = declarations.stroke || 'currentColor';
        item.appendChild(swatch);
        item.appendChild(doc.createTextNode(entry.label || name));

        if (opts.counts !== false) {
          const badge = doc.createElement('b');
          badge.textContent = String(count);
          item.appendChild(badge);
        }
        el.appendChild(item);
      }
    };

    const offs = [
      diagram.on('change', update),
      diagram.on('render', update),
      diagram.on('restyle', update)
    ];
    update();

    const mount = typeof opts.mount === 'string' ? doc.querySelector(opts.mount) : opts.mount;
    if (mount) mount.appendChild(el);

    return {
      el,
      update,
      destroy() {
        offs.forEach((off) => off());
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }

  // ── src/kit/inspector.js ──────────────────────────────────────
  /**
   * An inspector: what the thing under the pointer, or the thing you just
   * clicked, actually is.
   *
   * Four demos, four hand-written detail panels — all showing the same five
   * fields the payload already carries. This is that panel, with the template
   * exposed so it can be replaced rather than fought.
   */

  const FIELD_ORDER = ['state', 'badge', 'description', 'data'];

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /** The default template: a definition list of what is known. */
  function defaultTemplate(payload) {
    if (!payload) return '';
    const rows = [];
    if (payload.edge) {
      rows.push(['edge', `${payload.from} → ${payload.to}`]);
      rows.push(['state', payload.state]);
      if (payload.edge.label) rows.push(['label', payload.edge.label]);
    } else {
      rows.push(['node', payload.node && payload.node.label ? payload.node.label : payload.id]);
      for (const field of FIELD_ORDER) {
        const value = field === 'description' ? (payload.node && payload.node.description) : payload[field];
        if (value == null || value === '') continue;
        rows.push([field, typeof value === 'object' ? JSON.stringify(value) : value]);
      }
    }
    return rows.map(([key, value]) =>
      `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join('');
  }

  /**
   * @param {object} diagram - A LiveDiagram
   * @param {object} [options]
   * @param {'panel'|'tooltip'} [options.mode='panel']
   * @param {Element|string} [options.mount] - Required for 'panel'; ignored for 'tooltip'
   * @param {function(object): string} [options.template] - Return HTML for a payload
   * @param {string} [options.empty='Click a node.'] - Panel text with nothing selected
   * @param {boolean} [options.edges=true] - Also inspect edges
   * @returns {{el: Element, show: function, destroy: function}}
   */
  function inspector(diagram, options) {
    const opts = options || {};
    const mode = opts.mode === 'tooltip' ? 'tooltip' : 'panel';
    const doc = diagram.root.ownerDocument;
    const template = opts.template || defaultTemplate;

    const el = doc.createElement('dl');
    el.className = `ld-inspector ld-inspector--${mode}`;
    if (mode === 'tooltip') el.hidden = true;

    const show = (payload) => {
      if (!payload) {
        if (mode === 'tooltip') { el.hidden = true; return; }
        el.innerHTML = `<dt>—</dt><dd>${escapeHtml(opts.empty || 'Click a node.')}</dd>`;
        return;
      }
      el.innerHTML = template(payload);
      if (mode === 'tooltip') {
        el.hidden = false;
        position(payload);
      }
    };

    /** Keeps the tooltip beside its node and inside the diagram. */
    function position(payload) {
      const target = payload.element;
      if (!target) return;
      const base = diagram.root.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      const width = el.offsetWidth || 200;
      let left = rect.left - base.left + rect.width / 2 - width / 2;
      left = Math.max(4, Math.min(base.width - width - 4, left));
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(rect.bottom - base.top + 8)}px`;
    }

    const offs = [];
    if (mode === 'tooltip') {
      diagram.root.appendChild(el);
      offs.push(diagram.on('nodeHover', show));
    } else {
      offs.push(diagram.on('nodeClick', show));
    }
    if (opts.edges !== false) offs.push(diagram.on('edgeClick', show));
    // A rebuilt diagram means the element the tooltip pointed at is gone.
    offs.push(diagram.on('render', () => { if (mode === 'tooltip') el.hidden = true; }));

    show(null);

    const mount = typeof opts.mount === 'string' ? doc.querySelector(opts.mount) : opts.mount;
    if (mount && mode === 'panel') mount.appendChild(el);

    return {
      el,
      show,
      destroy() {
        offs.forEach((off) => off());
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }

  // ── src/kit/transport.js ──────────────────────────────────────
  /**
   * Play, pause, step, scrub.
   *
   * `Timeline` is the interesting half and it is in the core; this is the row of
   * buttons everybody writes afterwards, wired to it correctly — including the
   * two details that are easy to get wrong: scrubbing pauses playback, and the
   * clock follows the timeline rather than a second timer of its own.
   */

  function button(doc, label, title) {
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = 'ld-transport__button';
    el.textContent = label;
    el.title = title;
    el.setAttribute('aria-label', title);
    return el;
  }

  function seconds(ms) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  /**
   * @param {object} diagram - A LiveDiagram (the source of `tick`)
   * @param {object} timeline - The Timeline returned by diagram.timeline()
   * @param {object} [options]
   * @param {Element|string} [options.mount]
   * @param {number} [options.speed=1]
   * @param {boolean} [options.loop=false]
   * @param {Array<number>} [options.speeds=[1, 2, 5, 12]] - Empty array hides the selector
   * @returns {{el: Element, destroy: function}}
   */
  function transport(diagram, timeline, options) {
    const opts = options || {};
    const doc = diagram.root.ownerDocument;

    const el = doc.createElement('div');
    el.className = 'ld-transport';

    const play = button(doc, '▶', 'Play');
    const step = button(doc, '⏭', 'Step one event');
    const rewind = button(doc, '⏮', 'Rewind');

    const scrub = doc.createElement('input');
    scrub.type = 'range';
    scrub.className = 'ld-transport__scrub';
    scrub.min = '0';
    scrub.max = String(timeline.duration || 0);
    scrub.step = '1';
    scrub.value = '0';
    scrub.setAttribute('aria-label', 'Position in the recording');

    const clock = doc.createElement('span');
    clock.className = 'ld-transport__clock';

    let speed = Number(opts.speed) > 0 ? Number(opts.speed) : 1;
    const speeds = opts.speeds || [1, 2, 5, 12];
    const picker = doc.createElement('select');
    picker.className = 'ld-transport__speed';
    picker.setAttribute('aria-label', 'Playback speed');
    for (const value of speeds) {
      const option = doc.createElement('option');
      option.value = String(value);
      option.textContent = `${value}×`;
      if (value === speed) option.selected = true;
      picker.appendChild(option);
    }

    el.append(play, step, rewind, scrub, clock);
    if (speeds.length) el.appendChild(picker);

    const label = () => {
      play.textContent = timeline.playing ? '⏸' : '▶';
      play.title = timeline.playing ? 'Pause' : 'Play';
      play.setAttribute('aria-label', play.title);
    };

    const tick = (info) => {
      scrub.value = String(info.position);
      clock.textContent = `${seconds(info.position)} / ${seconds(timeline.duration)}  ·  ${info.index}/${timeline.length}`;
    };

    play.addEventListener('click', () => {
      if (timeline.playing) timeline.pause();
      else timeline.play({ speed, loop: opts.loop === true });
      label();
    });
    // Anything that moves the position by hand stops playback first: a scrubber
    // fighting a running clock is the classic bug in this widget.
    step.addEventListener('click', () => { timeline.pause(); label(); timeline.step(); });
    rewind.addEventListener('click', () => { timeline.pause(); label(); timeline.reset(); });
    scrub.addEventListener('input', () => { timeline.pause(); label(); timeline.seek(Number(scrub.value)); });
    picker.addEventListener('change', () => {
      speed = Number(picker.value) || 1;
      if (timeline.playing) { timeline.pause(); timeline.play({ speed, loop: opts.loop === true }); }
    });

    const off = diagram.on('tick', (info) => { tick(info); label(); });
    tick({ position: timeline.position, index: timeline.index });

    const mount = typeof opts.mount === 'string' ? doc.querySelector(opts.mount) : opts.mount;
    if (mount) mount.appendChild(el);

    return {
      el,
      destroy() {
        off();
        timeline.pause();
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }

  // ── src/index.js ──────────────────────────────────────────────
  /**
   * live-diagram — turn a diagram into a live control surface.
   *
   * Push state in with patch(), get node events out, replay a recorded run.
   * Mermaid is the first renderer, not the architecture.
   */
























  const VERSION = '0.4.2';

  /**
   * Sugar for the common case.
   * @param {object} options - See LiveDiagram
   */
  function createDiagram(options) {
    return new LiveDiagram(options);
  }

  exports.VERSION = VERSION;
  exports.LiveDiagram = LiveDiagram;
  exports.createDiagram = createDiagram;
  exports.defineLiveDiagram = defineLiveDiagram;
  exports.readJsonAttr = readJsonAttr;
  exports.hydrate = hydrate;
  exports.mountSpec = mountSpec;
  exports.autoHydrate = autoHydrate;
  exports.legend = legend;
  exports.inspector = inspector;
  exports.transport = transport;
  exports.toSVG = toSVG;
  exports.toPNG = toPNG;
  exports.download = download;
  exports.encodeState = encodeState;
  exports.decodeState = decodeState;
  exports.shareUrl = shareUrl;
  exports.applyShared = applyShared;
  exports.defaultTemplate = defaultTemplate;
  exports.Emitter = Emitter;
  exports.StateStore = StateStore;
  exports.Timeline = Timeline;
  exports.Viewport = Viewport;
  exports.Overlay = Overlay;
  exports.mermaidRenderer = mermaidRenderer;
  exports.buildDefinition = buildDefinition;
  exports.nodeSyntax = nodeSyntax;
  exports.tagNodes = tagNodes;
  exports.tagEdges = tagEdges;
  exports.resolveTheme = resolveTheme;
  exports.normalizeGraph = normalizeGraph;
  exports.parseMermaid = parseMermaid;
  exports.parseStateDiagram = parseStateDiagram;
  exports.looksLikeMermaid = looksLikeMermaid;
  exports.normalizeStates = normalizeStates;
  exports.normalizeEvents = normalizeEvents;
  exports.diffSnapshots = diffSnapshots;
  exports.styleFor = styleFor;
  exports.edgeStyleFor = edgeStyleFor;
  exports.parseStyle = parseStyle;
  exports.isValidId = isValidId;
  exports.escapeLabel = escapeLabel;
  exports.nodeIds = nodeIds;
  exports.edgeIds = edgeIds;
  exports.ensureStyles = ensureStyles;
  exports.webSocketSource = webSocketSource;
  exports.eventSourceSource = eventSourceSource;
  exports.pollSource = pollSource;
  exports.toTimelineEvents = toTimelineEvents;
  exports.graphFromEvents = graphFromEvents;
  exports.fromGitHubActions = fromGitHubActions;
  exports.toStages = toStages;
  exports.linkStages = linkStages;
  exports.stateOf = stateOf;
  exports.toId = toId;
  exports.GITHUB_STATES = GITHUB_STATES;
  exports.DEFAULT_STATES = DEFAULT_STATES;
  exports.GROUP_STYLE = GROUP_STYLE;
  exports.DIRECTIONS = DIRECTIONS;
  exports.SHAPES = SHAPES;
  exports.CSS = CSS;
  Object.defineProperty(exports, '__esModule', { value: true });

  // The class doubles as the namespace: `new LiveDiagram(...)` and
  // `LiveDiagram.mermaidRenderer()` both work from a plain <script> tag.
  Object.assign(LiveDiagram, exports);
  if (global && typeof global === 'object') global.LiveDiagram = LiveDiagram;

  // The UMD build is the drop-it-in-a-page path, so it registers the custom
  // element and honours <script … data-auto> on itself. The ESM entry does
  // neither: importing a module should not touch the document.
  if (typeof customElements !== 'undefined') defineLiveDiagram();
  if (typeof document !== 'undefined') autoHydrate(document.currentScript);
}));
