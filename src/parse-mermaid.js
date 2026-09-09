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
import { makeIdMapper, stripComments } from './parse-common.js';
import { parseStateDiagram } from './parse-state.js';

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
export function parseMermaid(source, options) {
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
export function looksLikeMermaid(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  return /^(flowchart|graph|stateDiagram)\b/i.test(trimmed) || /(-->|---|-\.->|==>)/.test(trimmed);
}
