// ---------------------------------------------------------------------------
// House layout — the shared "world" that every voice-room client renders and
// simulates the same way. Pure geometry/data, no DOM or audio here so it can
// be unit-reasoned-about and reused by both rendering and gain calculation.
//
// Coordinate space: a fixed 960x600 world, independent of screen size/shape.
// The canvas maps this world onto whatever viewport it's given (see fitWorld
// in voice.js), so the layout itself never has to think about aspect ratio.
// ---------------------------------------------------------------------------

export const WORLD_W = 960;
export const WORLD_H = 600;
export const PLAYER_RADIUS = 15;

// Four quadrant rooms around a central crossroads. Room rects are used for
// rendering (floor fill, labels, decor) and for placing the spawn point;
// movement/collision/line-of-sight only care about the wall segments below.
export const rooms = [
  { id: "living", label: "Living Room", rect: [10, 10, 470, 290] },
  { id: "game", label: "Game Room", rect: [490, 10, 950, 290], table: { cx: 720, cy: 150, r: 55 } },
  { id: "tv", label: "TV Room", rect: [10, 310, 470, 590], tv: { x: 30, y: 320, w: 140, h: 16 } },
  { id: "private", label: "Private Room", rect: [490, 310, 950, 590] },
];

// Interior walls dividing the four rooms, each with a doorway gap. The gaps
// overlap at the middle so the four rooms all meet at one open crossroads
// rather than a blind four-way corner.
const DOOR = { v: [260, 340], h: [440, 520] }; // [start, end] gap along each divider

export const walls = [
  // vertical divider at x=480, split around the doorway gap
  { x1: 480, y1: 0, x2: 480, y2: DOOR.v[0] },
  { x1: 480, y1: DOOR.v[1], x2: 480, y2: WORLD_H },
  // horizontal divider at y=300, split around the doorway gap
  { x1: 0, y1: 300, x2: DOOR.h[0], y2: 300 },
  { x1: DOOR.h[1], y1: 300, x2: WORLD_W, y2: 300 },
];

export const spawnPoint = { x: 240, y: 150 }; // center of the living room

// --- geometry helpers --------------------------------------------------------

function closestPointOnSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: x1 + t * dx, y: y1 + t * dy };
}

// resolveCollision pushes (x, y) out of any wall it's overlapping (a thin
// segment thickened by `radius`) and clamps it inside the world bounds.
export function resolveCollision(x, y, radius = PLAYER_RADIUS) {
  let px = x, py = y;
  for (const w of walls) {
    const c = closestPointOnSegment(px, py, w.x1, w.y1, w.x2, w.y2);
    const dx = px - c.x, dy = py - c.y;
    const dist = Math.hypot(dx, dy);
    const minDist = radius + 3; // half wall thickness
    if (dist < minDist) {
      if (dist === 0) {
        // Degenerate (dead center on the wall line): push along the wall's normal.
        const nx = -(w.y2 - w.y1), ny = w.x2 - w.x1;
        const nl = Math.hypot(nx, ny) || 1;
        px = c.x + (nx / nl) * minDist;
        py = c.y + (ny / nl) * minDist;
      } else {
        px = c.x + (dx / dist) * minDist;
        py = c.y + (dy / dist) * minDist;
      }
    }
  }
  px = Math.max(radius, Math.min(WORLD_W - radius, px));
  py = Math.max(radius, Math.min(WORLD_H - radius, py));
  return { x: px, y: py };
}

function segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

// hasLineOfSight reports whether a straight line between two points is
// unobstructed by any wall.
export function hasLineOfSight(ax, ay, bx, by) {
  for (const w of walls) {
    if (segIntersect(ax, ay, bx, by, w.x1, w.y1, w.x2, w.y2)) return false;
  }
  return true;
}
