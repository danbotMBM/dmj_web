import { Geo } from './geometry.js';
import { Scene } from './scene.js';
import { RayModules } from './rays.js';
import { Audio } from './audio.js';

/* ════════════════════════════════════════════════════════════
   APP  — state, input, render loop, UI wiring.
   ════════════════════════════════════════════════════════════ */
const App = (() => {
  const active = { direct: false, echo: false, permeate: false };
  let placeTarget = 'player';     // 'player' | 'sourceA' | 'sourceB'
  let testRay = null;             // {x,y} world point the test ray aims at
  let dragging = null;            // 'player' | 'source' | 'sourceB' | null

  // per-source smoothing state for the ray modules (so A and B don't share).
  // colors match each source marker so arrows/lines are distinguishable.
  const rayState = {
    a: { direct: { color: 0x59d4ff }, permeate: { color: 0x59d4ff } },
    b: { direct: { color: 0xc792ea }, permeate: { color: 0xc792ea } },
  };

  const el = {
    toggles: [...document.querySelectorAll('.toggle')],
    toggleTarget: document.getElementById('toggleTarget'),
    clearRays: document.getElementById('clearRays'),
    reset: document.getElementById('resetScene'),
    placeMode: document.getElementById('placeMode'),
    rayCount: document.getElementById('rayCount'),
    envToggle: document.getElementById('envToggle'),
    envPanel: document.getElementById('envPanel'),
    scaleSlider: document.getElementById('scaleSlider'),
    scaleVal: document.getElementById('scaleVal'),
    thickSlider: document.getElementById('thickSlider'),
    thickVal: document.getElementById('thickVal'),
    borderSwitch: document.getElementById('borderSwitch'),
    ro: {
      direct: document.getElementById('ro-direct'),
      echo: document.getElementById('ro-echo'),
      permeate: document.getElementById('ro-permeate'),
    },
  };

  // ── fit the simulation shell into the viewport below the site navbar ──
  // The shared header scrolls with the page and can wrap to two rows on
  // narrow screens, so we measure it rather than assume a fixed height.
  const shell = document.querySelector('.rt-shell');
  function fitShell() {
    const header = document.querySelector('.site-header');
    const top = header ? header.getBoundingClientRect().bottom : 0;
    shell.style.height = Math.max(320, window.innerHeight - top) + 'px';
    Scene.resize();
  }
  addEventListener('resize', fitShell);
  fitShell();

  // ── pointer handling ──
  const canvas = Scene.domElement;
  function pickActor(world) {
    const near = (m) => Math.hypot(m.position.x - world.x, m.position.z - world.y) < 1.1;
    if (near(Scene.player)) return 'player';
    if (near(Scene.source)) return 'source';
    if (near(Scene.sourceB)) return 'sourceB';
    return null;
  }
  function markerFor(name) {
    if (name === 'player') return Scene.player;
    if (name === 'sourceB') return Scene.sourceB;
    return Scene.source;   // 'source' / 'sourceA'
  }
  function pointerDown(e) {
    Audio.ensure();
    const t = e.touches ? e.touches[0] : e;
    const world = Scene.screenToWorld(t.clientX, t.clientY);
    const hitActor = pickActor(world);
    if (hitActor) { dragging = hitActor; }
    else {
      const m = markerFor(placeTarget === 'sourceA' ? 'source' : placeTarget);
      m.position.set(world.x, m.position.y, world.y);
    }
    testRay = world;
  }
  function pointerMove(e) {
    const t = e.touches ? e.touches[0] : e;
    const world = Scene.screenToWorld(t.clientX, t.clientY);
    if (dragging) {
      const m = markerFor(dragging);
      m.position.set(world.x, m.position.y, world.y);
    }
    testRay = world;
  }
  function pointerUp() { dragging = null; }

  canvas.addEventListener('mousedown', pointerDown);
  canvas.addEventListener('mousemove', pointerMove);
  addEventListener('mouseup', pointerUp);
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); pointerDown(e); }, { passive: false });
  canvas.addEventListener('touchmove',  (e) => { e.preventDefault(); pointerMove(e); }, { passive: false });
  canvas.addEventListener('touchend',   (e) => { e.preventDefault(); pointerUp(e); }, { passive: false });

  // ── UI ──
  el.toggles.forEach(btn => btn.addEventListener('click', () => {
    const k = btn.dataset.ray;
    active[k] = !active[k];
    btn.classList.toggle('on', active[k]);
    if (!active[k]) { el.ro[k].textContent = '—'; el.ro[k].classList.add('muted'); }
    if (k === 'direct') {
      if (active.direct) { Audio.play(); }
      else { Audio.silenceDirect('a'); Audio.silenceDirect('b'); }
    }
    if (k === 'echo') {
      if (active.echo) { Audio.play(); }
      else { Audio.silenceEcho(); }
    }
    if (k === 'permeate') {
      if (active.permeate) { Audio.play(); }
      else { Audio.silencePermeate('a'); Audio.silencePermeate('b'); }
    }
  }));
  const PLACE_CYCLE = ['player', 'sourceA', 'sourceB'];
  const PLACE_LABEL = { player: 'Player', sourceA: 'Source A', sourceB: 'Source B' };
  el.toggleTarget.addEventListener('click', () => {
    const i = PLACE_CYCLE.indexOf(placeTarget);
    placeTarget = PLACE_CYCLE[(i + 1) % PLACE_CYCLE.length];
    el.toggleTarget.textContent = 'Place: ' + PLACE_LABEL[placeTarget];
    el.placeMode.textContent = 'Tap: place ' + PLACE_LABEL[placeTarget];
  });
  el.clearRays.addEventListener('click', () => { testRay = null; });
  el.reset.addEventListener('click', () => { Scene.reset(); testRay = null; });

  // ── environment panel ──
  el.envToggle.addEventListener('click', () => {
    const open = el.envPanel.hidden;
    el.envPanel.hidden = !open;
    el.envToggle.setAttribute('aria-expanded', String(open));
  });
  el.scaleSlider.addEventListener('input', () => {
    const s = parseFloat(el.scaleSlider.value);
    el.scaleVal.textContent = s + ' m';
    Scene.setScale(s);
  });
  el.thickSlider.addEventListener('input', () => {
    const t = parseFloat(el.thickSlider.value);
    el.thickVal.textContent = t.toFixed(1) + ' m';
    Scene.setWallThickness(t);
  });
  el.borderSwitch.addEventListener('click', () => {
    const on = !el.borderSwitch.classList.contains('on');
    el.borderSwitch.classList.toggle('on', on);
    el.borderSwitch.setAttribute('aria-checked', String(on));
    Scene.setReflectiveBorder(on);
  });

  // ── the visible test ray: verifies castRay + reflect ──
  // Casts from player toward the pointer, then reflects up to N bounces.
  function drawTestRay() {
    if (!testRay) return;
    const p = Scene.player.position;
    let ox = p.x, oy = p.z;
    let dx = testRay.x - ox, dy = testRay.y - oy;
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;

    const pts = [{ x: ox, y: oy }];
    const MAX_BOUNCE = 6, MAX_DIST = 60;
    let travelled = 0;
    for (let i = 0; i < MAX_BOUNCE; i++) {
      const hit = Geo.castRay(ox, oy, dx, dy, Scene.walls);
      if (!hit || travelled + hit.t > MAX_DIST) {
        pts.push({ x: ox + dx * 4, y: oy + dy * 4 });
        break;
      }
      pts.push(hit.point);
      Scene.drawDot(hit.point, 0xffffff, 0.14);
      if (hit.seg && hit.seg.boundary && !Scene.env.reflectiveBorder) break;
      const r = Geo.reflect(dx, dy, hit.normal.x, hit.normal.y);
      dx = r.x; dy = r.y;
      ox = hit.point.x + dx * 1e-3; oy = hit.point.y + dy * 1e-3;
      travelled += hit.t;
    }
    Scene.drawPolyline(pts, 0xffffff, 0.85);
  }

  // ── main loop ──
  function frame() {
    Scene.clearRays();
    const origin = { x: Scene.player.position.x, y: Scene.player.position.z };

    // DIRECT — run per source, dispatch to each voice, combine for readout.
    if (active.direct) {
      const ra = RayModules.direct.cast(origin, Scene.walls, Scene.source, Scene, rayState.a.direct);
      const rb = RayModules.direct.cast(origin, Scene.walls, Scene.sourceB, Scene, rayState.b.direct);
      Audio.applyDirect('a', ra);
      Audio.applyDirect('b', rb);
      el.ro.direct.classList.remove('muted');
      el.ro.direct.textContent =
        'A ' + Math.round(ra.volume * 100) + '% · B ' + Math.round(rb.volume * 100) + '%';
    }

    // PERMEATE — run per source, dispatch to each voice.
    if (active.permeate) {
      const pa = RayModules.permeate.cast(origin, Scene.walls, Scene.source, Scene, rayState.a.permeate);
      const pb = RayModules.permeate.cast(origin, Scene.walls, Scene.sourceB, Scene, rayState.b.permeate);
      Audio.applyPermeate('a', pa);
      Audio.applyPermeate('b', pb);
      el.ro.permeate.classList.remove('muted');
      el.ro.permeate.textContent =
        'A ' + Math.round(pa.muffle * 100) + '% · B ' + Math.round(pb.muffle * 100) + '%';
    }

    // ECHO — single processor on the COMBINED signal. We cast from the player
    // (geometry is source-independent: it measures how the ROOM returns energy).
    if (active.echo) {
      const re = RayModules.echo.cast(origin, Scene.walls, Scene.source, Scene);
      el.ro.echo.classList.remove('muted');
      const ms = Math.round(re.delay * 1000);
      if (!active.direct) {
        // echo now reverberates the scaled direct streams — silent without them
        el.ro.echo.textContent = 'needs Direct';
        el.ro.echo.classList.add('muted');
      } else {
        el.ro.echo.textContent = Math.round(re.magnitude * 100) + '%·' + ms + 'ms';
      }
      Audio.applyEcho(re);
    }

    drawTestRay();
    Scene.render();
    requestAnimationFrame(frame);
  }
  frame();

  return {};
})();

export { App };
