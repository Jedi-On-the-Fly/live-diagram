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
export declare const DEFAULT_STATES: {
    idle: {
        icon: string;
        label: string;
        style: string;
        darkStyle: string;
        edgeStyle: string;
        darkEdgeStyle: string;
    };
    queued: {
        icon: string;
        label: string;
        style: string;
        darkStyle: string;
        edgeStyle: string;
        darkEdgeStyle: string;
    };
    running: {
        icon: string;
        label: string;
        style: string;
        darkStyle: string;
        edgeStyle: string;
        darkEdgeStyle: string;
    };
    waiting: {
        icon: string;
        label: string;
        style: string;
        darkStyle: string;
        edgeStyle: string;
        darkEdgeStyle: string;
    };
    success: {
        icon: string;
        label: string;
        style: string;
        darkStyle: string;
        edgeStyle: string;
        darkEdgeStyle: string;
    };
    error: {
        icon: string;
        label: string;
        style: string;
        darkStyle: string;
        edgeStyle: string;
        darkEdgeStyle: string;
    };
    skipped: {
        icon: string;
        label: string;
        style: string;
        darkStyle: string;
        edgeStyle: string;
        darkEdgeStyle: string;
    };
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
export declare function hexifyColors(style: string | null): string;
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
export declare function normalizeStates(states: object | null, options?: {
    extend?: boolean;
}): {};
/**
 * Resolves the EDGE style string for a state under a theme.
 * @param {object} states - Normalized vocabulary
 * @param {string} name
 * @param {string} theme - 'light' | 'dark'
 */
export declare function edgeStyleFor(states: object, name: string, theme: string): any;
/**
 * Resolves the style string for a state under a theme.
 * @param {object} states - Normalized vocabulary
 * @param {string} name
 * @param {string} theme - 'light' | 'dark'
 */
export declare function styleFor(states: object, name: string, theme: string): any;
