/**
 * A Docusaurus/MDX component wrapper.
 *
 * Two things make this more than a one-liner: the static build must not run the
 * constructor (it touches `document`), and the library is loaded as a global by
 * `docusaurus.config.js` rather than imported, so the component waits for it
 * instead of assuming it.
 *
 * Copy to src/components/LiveDiagram.jsx.
 */
import React, { useEffect, useRef } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

function Mounted({ graph, states, initial, patch, height = 420, controls = true, theme = 'auto', onNodeClick }) {
  const ref = useRef(null);
  const diagram = useRef(null);
  const shape = JSON.stringify([graph, states, theme, controls]);

  useEffect(() => {
    let cancelled = false;

    const start = () => {
      if (cancelled || !ref.current || !window.LiveDiagram) return;
      diagram.current = new window.LiveDiagram({
        mount: ref.current, graph, states, initial, theme, controls
      });
      if (onNodeClick) diagram.current.on('nodeClick', onNodeClick);
    };

    // The global arrives with a <script> tag, which may not have run yet.
    if (window.LiveDiagram) start();
    else {
      const timer = setInterval(() => { if (window.LiveDiagram) { clearInterval(timer); start(); } }, 50);
      setTimeout(() => clearInterval(timer), 10000);
    }

    return () => {
      cancelled = true;
      if (diagram.current) { diagram.current.destroy(); diagram.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  useEffect(() => {
    if (diagram.current && patch) diagram.current.patch(patch);
  }, [JSON.stringify(patch)]);

  return <div ref={ref} style={{ height }} />;
}

export default function LiveDiagram(props) {
  return <BrowserOnly fallback={<div style={{ height: props.height || 420 }} />}>{() => <Mounted {...props} />}</BrowserOnly>;
}
