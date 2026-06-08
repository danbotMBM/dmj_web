import * as THREE from 'three';

/* ════════════════════════════════════════════════════════════
   SCENE  — three.js orthographic top-down world.
   World units: meters. Camera frames a fixed span, recentred
   on resize so it stays mobile-first portrait-friendly.
   ════════════════════════════════════════════════════════════ */
export const Scene = (() => {
  const VIEW_SPAN = 24;            // metres visible on the shorter axis
  const stageEl = document.getElementById('stage');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stageEl.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e14);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 50, 0);
  camera.up.set(0, 0, -1);          // so +x is right, +z is down on screen
  camera.lookAt(0, 0, 0);

  // groups
  const worldGroup = new THREE.Group();   // walls, grid
  const rayGroup   = new THREE.Group();    // ray visualisations (cleared each frame)
  const actorGroup = new THREE.Group();    // player + source markers
  scene.add(worldGroup, rayGroup, actorGroup);

  // ── grid ──
  const grid = new THREE.GridHelper(VIEW_SPAN * 2, VIEW_SPAN * 2, 0x16202c, 0x111922);
  grid.material.transparent = true; grid.material.opacity = 0.6;
  worldGroup.add(grid);

  // ── walls: stored as 2D segments for math + meshes for display ──
  const walls = [];   // {ax,ay,bx,by}
  const wallMeshGroup = new THREE.Group(); worldGroup.add(wallMeshGroup);

  function makeBox(cx, cy, w, h) {
    // four segments (CCW) for the math
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
    walls.push(
      { ax: x0, ay: y0, bx: x1, by: y0 },
      { ax: x1, ay: y0, bx: x1, by: y1 },
      { ax: x1, ay: y1, bx: x0, by: y1 },
      { ax: x0, ay: y1, bx: x0, by: y0 },
    );
    // display mesh
    const geo = new THREE.BoxGeometry(w, 1.2, h);
    const mat = new THREE.MeshBasicMaterial({ color: 0x2d3a4d });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, 0, cy);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x52688a })
    );
    mesh.add(edges);
    wallMeshGroup.add(mesh);
  }

  // outer boundary + interior obstacles, parametrized by room scale.
  // env.scale ∈ ~[6..20] half-extent; env.reflectiveBorder toggles whether
  // boundary segments reflect (false = open space, rays pass/escape).
  const env = { scale: 11, reflectiveBorder: true, wallThickness: 0.7 };

  function buildDefaultLayout() {
    walls.length = 0;
    wallMeshGroup.clear();
    const R = env.scale;
    // boundary segments — tagged so ray code can treat them specially
    walls.push(
      { ax: -R, ay: -R, bx:  R, by: -R, boundary: true },
      { ax:  R, ay: -R, bx:  R, by:  R, boundary: true },
      { ax:  R, ay:  R, bx: -R, by:  R, boundary: true },
      { ax: -R, ay:  R, bx: -R, by: -R, boundary: true },
    );
    const boundColor = env.reflectiveBorder ? 0x52688a : 0x33414f;
    const bound = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-R,0,-R), new THREE.Vector3(R,0,-R),
        new THREE.Vector3(R,0,R),   new THREE.Vector3(-R,0,R),
      ]),
      new THREE.LineBasicMaterial({
        color: boundColor,
        transparent: !env.reflectiveBorder,
        opacity: env.reflectiveBorder ? 1 : 0.4,
      })
    );
    wallMeshGroup.add(bound);

    // ── dividing wall across the middle (y=0) with a door gap ──
    // door + interior walls scale with the room so layout stays proportional.
    // T (wall thickness) is adjustable and drives the permeation/muffle score.
    const DOOR = 1.5, T = env.wallThickness;
    makeBox((-R + -DOOR) / 2, 0, (R - DOOR), T);   // left of door
    makeBox(( R +  DOOR) / 2, 0, (R - DOOR), T);   // right of door

    // ── interior walls in the BOTTOM half (y > 0) only ──
    // positioned as fractions of R so they spread with a bigger room.
    makeBox(-0.41 * R, 0.36 * R, 3,   T);     // horizontal stub
    makeBox( 0.32 * R, 0.45 * R, T,   5);     // vertical wall
    makeBox(-0.18 * R, 0.68 * R, 5,   T);     // lower horizontal
    // top half (y < 0) left empty
  }

  function setScale(s)            { env.scale = s; buildDefaultLayout(); }
  function setReflectiveBorder(b) { env.reflectiveBorder = b; buildDefaultLayout(); }
  function setWallThickness(t)    { env.wallThickness = t; buildDefaultLayout(); }

  // ── actors ──
  function marker(color, r = 0.7) {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(r, 32),
      new THREE.MeshBasicMaterial({ color })
    );
    disc.rotation.x = -Math.PI / 2;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r * 1.25, r * 1.4, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 })
    );
    ring.rotation.x = -Math.PI / 2;
    g.add(disc, ring);
    return g;
  }
  const player = marker(0xffb454, 0.55); player.position.set(0, 0.1, 6);
  const source = marker(0x59d4ff, 0.55); source.position.set(2, 0.1, -6);   // source A
  const sourceB = marker(0xc792ea, 0.55); sourceB.position.set(-4, 0.1, -6); // source B (violet)
  actorGroup.add(player, source, sourceB);

  // ── ray drawing helpers (called by ray modules later) ──
  function clearRays() {
    // Dispose GPU buffers — clear() alone leaks geometry/material on the GPU,
    // which exhausts VRAM and causes "Context Lost".
    for (const obj of rayGroup.children) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
    rayGroup.clear();
  }
  function drawPolyline(pts, colorHex, opacity = 1) {
    const v = pts.map(p => new THREE.Vector3(p.x, 0.2, p.y));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(v),
      new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity })
    );
    rayGroup.add(line);
  }
  function drawDot(p, colorHex, r = 0.18) {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(r, 16),
      new THREE.MeshBasicMaterial({ color: colorHex })
    );
    m.rotation.x = -Math.PI / 2; m.position.set(p.x, 0.25, p.y);
    rayGroup.add(m);
  }

  // Arrow from a point, given a unit dir and a length. Drawn in rayGroup.
  function drawArrow(from, dir, length, colorHex, width = 0.28) {
    if (length < 1e-3) return;
    const tipX = from.x + dir.x * length, tipY = from.y + dir.y * length;
    // shaft
    drawPolyline([{ x: from.x, y: from.y }, { x: tipX, y: tipY }], colorHex, 1);
    // head: two short barbs
    const headLen = Math.min(0.9, length * 0.4);
    const ang = Math.atan2(dir.y, dir.x);
    const a1 = ang + Math.PI * 0.82, a2 = ang - Math.PI * 0.82;
    drawPolyline([{ x: tipX, y: tipY }, { x: tipX + Math.cos(a1) * headLen, y: tipY + Math.sin(a1) * headLen }], colorHex, 1);
    drawPolyline([{ x: tipX, y: tipY }, { x: tipX + Math.cos(a2) * headLen, y: tipY + Math.sin(a2) * headLen }], colorHex, 1);
  }

  // ── resize / projection ──
  function resize() {
    const w = stageEl.clientWidth, h = stageEl.clientHeight;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    let halfW, halfH;
    if (aspect >= 1) { halfH = VIEW_SPAN / 2; halfW = halfH * aspect; }
    else             { halfW = VIEW_SPAN / 2; halfH = halfW / aspect; }
    camera.left = -halfW; camera.right = halfW;
    camera.top = halfH; camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  }

  // screen px (relative to stage) → world {x,y} on plane
  function screenToWorld(px, py) {
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((px - rect.left) / rect.width) * 2 - 1;
    const ny = -(((py - rect.top) / rect.height) * 2 - 1);
    const v = new THREE.Vector3(nx, ny, 0).unproject(camera);
    return { x: v.x, y: v.z };
  }

  buildDefaultLayout();
  resize();
  addEventListener('resize', resize);

  function render() { renderer.render(scene, camera); }

  return {
    render, resize, screenToWorld,
    clearRays, drawPolyline, drawDot, drawArrow,
    get walls() { return walls; },
    player, source, sourceB,
    setScale, setReflectiveBorder, setWallThickness,
    get env() { return env; },
    reset() { buildDefaultLayout(); player.position.set(0,0.1,6); source.position.set(2,0.1,-6); sourceB.position.set(-4,0.1,-6); },
    domElement: renderer.domElement,
  };
})();
