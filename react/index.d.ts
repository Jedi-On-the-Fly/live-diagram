import type { CSSProperties, HTMLAttributes, RefObject } from 'react';
import type { LiveDiagram } from '../dist/types/index.js';
import type { GraphSpec } from '../dist/types/graph.js';
import type { StatePatch } from '../dist/types/state.js';

export interface NodeEvent {
  id: string;
  node: object;
  state: string;
  badge: string | null;
  data: object | null;
  element: Element | null;
  originalEvent: Event | null;
}

export interface LiveDiagramOptions {
  graph: GraphSpec;
  states?: object;
  initial?: StatePatch;
  theme?: 'light' | 'dark' | 'auto';
  controls?: boolean;
  showIcons?: boolean;
  defaultState?: string;
  extendStates?: boolean;
  viewport?: object | false;
  onNodeClick?: (event: NodeEvent) => void;
  onNodeHover?: (event: NodeEvent | null) => void;
  onChange?: (event: { changed: string[]; structural: boolean; snapshot: object }) => void;
  onError?: (event: { source: string; error: Error }) => void;
  onReady?: (diagram: LiveDiagram) => void;
}

export interface LiveDiagramViewProps extends LiveDiagramOptions, Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'onError'> {
  /** Applied with patch() whenever it changes. */
  patch?: StatePatch;
  className?: string;
  style?: CSSProperties;
}

/** Mounts a diagram into a ref'd element and keeps it alive across renders. */
export declare function useLiveDiagram(ref: RefObject<Element>, options: LiveDiagramOptions): LiveDiagram | null;

/** The component form. */
export declare function LiveDiagramView(props: LiveDiagramViewProps): JSX.Element;

export default LiveDiagramView;
