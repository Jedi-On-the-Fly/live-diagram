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
export function transport(diagram, timeline, options) {
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
