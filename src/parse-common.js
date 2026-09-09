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
export const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Rewrites source ids into ids this library can emit, remembering the mapping
 * so both ends of every edge follow the same rewrite.
 * @returns {function(string): string}
 */
export function makeIdMapper() {
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
export function stripComments(source) {
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
