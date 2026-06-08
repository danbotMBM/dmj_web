/* ════════════════════════════════════════════════════════════
   GEOMETRY2D  — all ray math lives on the XZ plane (we use x,y
   internally; maps to three.js x,z). Pure, framework-free.
   ════════════════════════════════════════════════════════════ */
export const Geo = (() => {
  const EPS = 1e-6;

  // Ray: {x,y} origin + {x,y} unit dir. Segment: {ax,ay,bx,by}.
  // Returns {t, point:{x,y}, normal:{x,y}} or null. t = distance along ray.
  function raySegment(ox, oy, dx, dy, s) {
    const ex = s.bx - s.ax, ey = s.by - s.ay;       // segment edge vector
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < EPS) return null;          // parallel
    const wx = s.ax - ox, wy = s.ay - oy;
    const t = (wx * ey - wy * ex) / denom;           // dist along ray
    const u = (wx * dy - wy * dx) / denom;           // param along segment
    if (t < EPS || u < 0 || u > 1) return null;
    // normal: perpendicular to edge, flipped to oppose ray dir
    let nx = -ey, ny = ex;
    const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
    if (nx * dx + ny * dy > 0) { nx = -nx; ny = -ny; }
    return { t, point: { x: ox + dx * t, y: oy + dy * t }, normal: { x: nx, y: ny } };
  }

  // Nearest hit across a set of segments.
  function castRay(ox, oy, dx, dy, segments) {
    let best = null;
    for (const s of segments) {
      const h = raySegment(ox, oy, dx, dy, s);
      if (h && (!best || h.t < best.t)) { best = h; best.seg = s; }
    }
    return best;
  }

  // Reflect dir d about unit normal n:  r = d - 2(d·n)n
  function reflect(dx, dy, nx, ny) {
    const dot = dx * nx + dy * ny;
    return { x: dx - 2 * dot * nx, y: dy - 2 * dot * ny };
  }

  // Does a ray (unit dir) pass within radius `rad` of point P, within `maxT`?
  // Returns distance-along-ray to closest approach if captured, else null.
  function capsuleHit(ox, oy, dx, dy, maxT, P, rad) {
    const wx = P.x - ox, wy = P.y - oy;
    const proj = wx * dx + wy * dy;            // closest-approach param along ray
    if (proj < 0) return null;                 // behind origin
    const clamped = Math.min(proj, maxT);
    const cx = ox + dx * clamped, cy = oy + dy * clamped;
    const d2 = (P.x - cx) ** 2 + (P.y - cy) ** 2;
    if (d2 <= rad * rad) return clamped;
    return null;
  }

  return { raySegment, castRay, reflect, capsuleHit, EPS };
})();
