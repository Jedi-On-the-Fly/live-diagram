/**
 * live-diagram — turn a diagram into a live control surface.
 *
 * Push state in with patch(), get node events out, replay a recorded run.
 * Mermaid is the first renderer, not the architecture.
 */

import { LiveDiagram, parseStyle } from './live-diagram.js';
import { Emitter } from './emitter.js';
import { normalizeGraph, isValidId, escapeLabel, nodeIds, edgeIds, DIRECTIONS, SHAPES } from './graph.js';
import { parseMermaid, looksLikeMermaid } from './parse-mermaid.js';
import { parseStateDiagram } from './parse-state.js';
import { StateStore, diffSnapshots } from './state.js';
import { normalizeStates, styleFor, edgeStyleFor, DEFAULT_STATES } from './states.js';
import { Timeline, normalizeEvents } from './timeline.js';
import { Viewport } from './viewport.js';
import { Overlay } from './overlay.js';
import { mermaidRenderer, resolveTheme, tagNodes, tagEdges } from './renderers/mermaid.js';
import { buildDefinition, nodeSyntax, GROUP_STYLE } from './renderers/mermaid-def.js';
import { webSocketSource, eventSourceSource, pollSource } from './sources.js';
import { toTimelineEvents, graphFromEvents } from './adapters/logs.js';
import { fromGitHubActions, toStages, linkStages, stateOf, toId, GITHUB_STATES } from './adapters/github-actions.js';
import { defineLiveDiagram, readJsonAttr } from './element.js';
import { hydrate, mountSpec, autoHydrate } from './hydrate.js';
import { toSVG, toPNG, download, encodeState, decodeState, shareUrl, applyShared } from './export.js';
import { legend } from './kit/legend.js';
import { inspector, defaultTemplate } from './kit/inspector.js';
import { transport } from './kit/transport.js';
import { CSS, ensureStyles } from './styles.js';

const VERSION = '0.4.2';

/**
 * Sugar for the common case.
 * @param {object} options - See LiveDiagram
 */
function createDiagram(options) {
  return new LiveDiagram(options);
}

export {
  VERSION,
  LiveDiagram,
  createDiagram,
  defineLiveDiagram,
  readJsonAttr,
  hydrate,
  mountSpec,
  autoHydrate,
  legend,
  inspector,
  transport,
  toSVG,
  toPNG,
  download,
  encodeState,
  decodeState,
  shareUrl,
  applyShared,
  defaultTemplate,
  Emitter,
  StateStore,
  Timeline,
  Viewport,
  Overlay,
  mermaidRenderer,
  buildDefinition,
  nodeSyntax,
  tagNodes,
  tagEdges,
  resolveTheme,
  normalizeGraph,
  parseMermaid,
  parseStateDiagram,
  looksLikeMermaid,
  normalizeStates,
  normalizeEvents,
  diffSnapshots,
  styleFor,
  edgeStyleFor,
  parseStyle,
  isValidId,
  escapeLabel,
  nodeIds,
  edgeIds,
  ensureStyles,
  webSocketSource,
  eventSourceSource,
  pollSource,
  toTimelineEvents,
  graphFromEvents,
  fromGitHubActions,
  toStages,
  linkStages,
  stateOf,
  toId,
  GITHUB_STATES,
  DEFAULT_STATES,
  GROUP_STYLE,
  DIRECTIONS,
  SHAPES,
  CSS
};
