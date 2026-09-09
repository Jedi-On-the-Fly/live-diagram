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

import { parseMermaid } from './parse-mermaid.js';

const DIRECTIONS = ['TB', 'TD', 'BT', 'LR', 'RL'];
const SHAPES = ['rounded', 'stadium', 'rect', 'diamond', 'circle', 'hex', 'subroutine', 'cylinder'];

// Mermaid ids are bare words in the diagram source; anything else would need
// escaping we would then have to reverse when mapping SVG elements back to
// nodes. Rejecting loudly at construction beats a mystery at render time.
const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** @returns {boolean} Whether an id is safe to emit into a diagram definition. */
export function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

/**
 * Escapes a label for use inside a quoted Mermaid string.
 * @param {string} label
 */
export function escapeLabel(label) {
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
export function normalizeGraph(graph) {
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
export function nodeIds(graph) {
  return Object.keys(graph.nodes);
}

/** @returns {Array<string>} Edge ids in declaration order. */
export function edgeIds(graph) {
  return graph.edges.map((edge) => edge.id);
}

export { DIRECTIONS, SHAPES };
