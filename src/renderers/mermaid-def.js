/**
 * graph + state -> a Mermaid flowchart definition. A pure function, which is
 * why it can be unit-tested in Node with no browser, no DOM and no Mermaid
 * installed. Everything that could be pure here is.
 */

import { escapeLabel } from '../graph.js';
import { styleFor, edgeStyleFor } from '../states.js';

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
export function nodeSyntax(shape, id, label) {
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
export function buildDefinition(args) {
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

export { GROUP_STYLE };
