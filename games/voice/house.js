// ---------------------------------------------------------------------------
// House layout — the shared "world" that every voice-room client renders and
// simulates the same way. Pure geometry/data, no DOM or audio here so it can
// be unit-reasoned-about and reused by both rendering and gain calculation.
//
// Coordinate space: a fixed 960x600 world, independent of screen size/shape.
// The canvas maps this world onto whatever viewport it's given (see fitWorld
// in voice.js), so the layout itself never has to think about aspect ratio.
// ---------------------------------------------------------------------------

// The whole layout is uniformly scaled up from an earlier 960x600 design so
// the house is large enough to require real walking/camera panning, while
// every proportion (room size vs. player vs. audio ranges) stays identical.
export const SCALE = 3;

export const WORLD_W = 960 * SCALE;
export const WORLD_H = 600 * SCALE;
export const PLAYER_RADIUS = 15 * SCALE;

// Four quadrant rooms around a central crossroads. Room rects are used for
// rendering (floor fill, labels, decor) and for placing the spawn point;
// movement/collision/line-of-sight only care about the wall segments below.
export const rooms = [
  { id: "living", label: "Living Room", rect: [10, 10, 470, 290].map((n) => n * SCALE) },
  { id: "game", label: "Game Room", rect: [490, 10, 950, 290].map((n) => n * SCALE), table: { cx: 720 * SCALE, cy: 150 * SCALE, r: 55 * SCALE } },
  { id: "tv", label: "TV Room", rect: [10, 310, 470, 590].map((n) => n * SCALE), tv: { x: 30 * SCALE, y: 320 * SCALE, w: 140 * SCALE, h: 16 * SCALE } },
  { id: "private", label: "Private Room", rect: [490, 310, 950, 590].map((n) => n * SCALE) },
];

// Interior walls dividing the four rooms, each with a doorway gap. The gaps
// overlap at the middle so the four rooms all meet at one open crossroads
// rather than a blind four-way corner.
const DOOR = { v: [260 * SCALE, 340 * SCALE], h: [440 * SCALE, 520 * SCALE] }; // [start, end] gap along each divider
const DIVIDER_X = 480 * SCALE, DIVIDER_Y = 300 * SCALE;

export const walls = [
  // vertical divider, split around the doorway gap
  { x1: DIVIDER_X, y1: 0, x2: DIVIDER_X, y2: DOOR.v[0] },
  { x1: DIVIDER_X, y1: DOOR.v[1], x2: DIVIDER_X, y2: WORLD_H },
  // horizontal divider, split around the doorway gap
  { x1: 0, y1: DIVIDER_Y, x2: DOOR.h[0], y2: DIVIDER_Y },
  { x1: DOOR.h[1], y1: DIVIDER_Y, x2: WORLD_W, y2: DIVIDER_Y },
];

export const spawnPoint = { x: 240 * SCALE, y: 150 * SCALE }; // center of the living room

// Freestanding circular obstacles (furniture) gathered from the rooms that
// have one. Walked around, not through — both for movement collision and
// for pathfinding.
export const obstacles = rooms.filter((r) => r.table).map((r) => r.table);

const WALL_HALF = 3 * SCALE;

// --- geometry helpers --------------------------------------------------------

function closestPointOnSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: x1 + t * dx, y: y1 + t * dy };
}

function distPointToSegment(px, py, x1, y1, x2, y2) {
  const c = closestPointOnSegment(px, py, x1, y1, x2, y2);
  return Math.hypot(px - c.x, py - c.y);
}

// resolveCollision pushes (x, y) out of any wall or obstacle it's overlapping
// and clamps it inside the world bounds.
export function resolveCollision(x, y, radius = PLAYER_RADIUS) {
  let px = x, py = y;
  for (const w of walls) {
    const c = closestPointOnSegment(px, py, w.x1, w.y1, w.x2, w.y2);
    const dx = px - c.x, dy = py - c.y;
    const dist = Math.hypot(dx, dy);
    const minDist = radius + WALL_HALF;
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
  for (const o of obstacles) {
    const dx = px - o.cx, dy = py - o.cy;
    const dist = Math.hypot(dx, dy) || 0.001;
    const minDist = radius + o.r;
    if (dist < minDist) {
      px = o.cx + (dx / dist) * minDist;
      py = o.cy + (dy / dist) * minDist;
    }
  }
  px = Math.max(radius, Math.min(WORLD_W - radius, px));
  py = Math.max(radius, Math.min(WORLD_H - radius, py));
  return { x: px, y: py };
}

// blocksMovement reports whether a circle of the given radius centered at
// (x, y) overlaps a wall, an obstacle, or the world bounds.
function blocksMovement(x, y, radius) {
  if (x - radius < 0 || y - radius < 0 || x + radius > WORLD_W || y + radius > WORLD_H) return true;
  for (const w of walls) {
    if (distPointToSegment(x, y, w.x1, w.y1, w.x2, w.y2) < radius + WALL_HALF) return true;
  }
  for (const o of obstacles) {
    if (Math.hypot(x - o.cx, y - o.cy) < radius + o.r) return true;
  }
  return false;
}

// segmentClear reports whether a disc of the given radius can travel in a
// straight line from (ax, ay) to (bx, by) without clipping a wall or
// obstacle — i.e. the swept "capsule" along that segment stays clear.
function segmentClear(ax, ay, bx, by, radius) {
  for (const w of walls) {
    if (segSegDist(ax, ay, bx, by, w.x1, w.y1, w.x2, w.y2) < radius + WALL_HALF) return false;
  }
  for (const o of obstacles) {
    if (distPointToSegment(o.cx, o.cy, ax, ay, bx, by) < radius + o.r) return false;
  }
  return true;
}

// Minimum distance between two segments (exact when they don't intersect,
// which is the only case that matters here since intersecting means blocked).
function segSegDist(ax, ay, bx, by, cx, cy, dx, dy) {
  if (segIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    distPointToSegment(ax, ay, cx, cy, dx, dy),
    distPointToSegment(bx, by, cx, cy, dx, dy),
    distPointToSegment(cx, cy, ax, ay, bx, by),
    distPointToSegment(dx, dy, ax, ay, bx, by),
  );
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

// ---------------------------------------------------------------------------
// Pathfinding — grid A* so a click on the far side of a wall or the table
// makes the player walk *around* it (through a doorway) instead of sliding
// along the obstacle it bumped into.
// ---------------------------------------------------------------------------

const CELL = 60; // world units per grid cell — well under the doorway width
const GRID_COLS = Math.ceil(WORLD_W / CELL);
const GRID_ROWS = Math.ceil(WORLD_H / CELL);

// Precomputed once: whether a player-sized disc centered on each cell's
// center overlaps a wall/obstacle/bound. Geometry is static, so this is
// built lazily on first use and reused for every path query.
let walkGrid = null;
function buildWalkGrid() {
  const grid = new Uint8Array(GRID_COLS * GRID_ROWS);
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const cx = col * CELL + CELL / 2;
      const cy = row * CELL + CELL / 2;
      grid[row * GRID_COLS + col] = blocksMovement(cx, cy, PLAYER_RADIUS) ? 1 : 0;
    }
  }
  return grid;
}
function getWalkGrid() {
  if (!walkGrid) walkGrid = buildWalkGrid();
  return walkGrid;
}

function cellIndex(col, row) { return row * GRID_COLS + col; }
function toCell(x, y) {
  return {
    col: Math.max(0, Math.min(GRID_COLS - 1, Math.floor(x / CELL))),
    row: Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(y / CELL))),
  };
}
function cellCenter(col, row) { return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 }; }

// nearestWalkableCell finds the closest open cell to (col, row) via a small
// expanding-ring search — used when a click lands inside a wall/obstacle.
function nearestWalkableCell(col, row) {
  const grid = getWalkGrid();
  if (!grid[cellIndex(col, row)]) return { col, row };
  for (let radius = 1; radius < Math.max(GRID_COLS, GRID_ROWS); radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue; // ring only
        const c = col + dc, r = row + dr;
        if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) continue;
        if (!grid[cellIndex(c, r)]) return { col: c, row: r };
      }
    }
  }
  return null;
}

const NEIGHBORS = [
  { dc: 1, dr: 0, cost: 1 }, { dc: -1, dr: 0, cost: 1 },
  { dc: 0, dr: 1, cost: 1 }, { dc: 0, dr: -1, cost: 1 },
  { dc: 1, dr: 1, cost: Math.SQRT2 }, { dc: 1, dr: -1, cost: Math.SQRT2 },
  { dc: -1, dr: 1, cost: Math.SQRT2 }, { dc: -1, dr: -1, cost: Math.SQRT2 },
];

// Simple binary-heap-free A* (grids here are small — low thousands of cells —
// so a linear-scan open set is plenty fast for one path query per click).
function astar(startCell, goalCell, radius) {
  const grid = getWalkGrid();
  const startIdx = cellIndex(startCell.col, startCell.row);
  const goalIdx = cellIndex(goalCell.col, goalCell.row);
  if (startIdx === goalIdx) return [startCell];

  const open = new Map(); // idx -> {col,row,g,f}
  const cameFrom = new Map();
  const closed = new Set();
  open.set(startIdx, { col: startCell.col, row: startCell.row, g: 0 });

  const heuristic = (col, row) => Math.hypot(col - goalCell.col, row - goalCell.row);

  while (open.size) {
    let curIdx = null, cur = null, bestF = Infinity;
    for (const [idx, node] of open) {
      const f = node.g + heuristic(node.col, node.row);
      if (f < bestF) { bestF = f; curIdx = idx; cur = node; }
    }
    if (curIdx === goalIdx) {
      const path = [{ col: cur.col, row: cur.row }];
      let idx = curIdx;
      while (cameFrom.has(idx)) {
        idx = cameFrom.get(idx);
        const row = Math.floor(idx / GRID_COLS), col = idx % GRID_COLS;
        path.unshift({ col, row });
      }
      return path;
    }
    open.delete(curIdx);
    closed.add(curIdx);
    const curCenter = cellCenter(cur.col, cur.row);

    for (const n of NEIGHBORS) {
      const col = cur.col + n.dc, row = cur.row + n.dr;
      if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) continue;
      const idx = cellIndex(col, row);
      if (closed.has(idx) || grid[idx]) continue;
      // For a diagonal step, don't trust the grid alone (two cells can each
      // be individually walkable while the disc swept between them still
      // clips a wall corner) — verify the actual swept path is clear. This
      // also correctly *permits* a tight-but-valid diagonal squeeze through
      // a narrow doorway that a naive "block if either side is blocked"
      // heuristic would wrongly forbid.
      if (n.dc !== 0 && n.dr !== 0) {
        const neighborCenter = cellCenter(col, row);
        if (!segmentClear(curCenter.x, curCenter.y, neighborCenter.x, neighborCenter.y, radius)) continue;
      }
      const g = cur.g + n.cost;
      const existing = open.get(idx);
      if (!existing || g < existing.g) {
        open.set(idx, { col, row, g });
        cameFrom.set(idx, curIdx);
      }
    }
  }
  return null; // unreachable
}

// String-pull the raw grid path down to the few waypoints actually needed,
// so the walk looks like a natural line rather than a staircase of cells.
function smoothPath(points, radius) {
  if (points.length <= 2) return points;
  const smoothed = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    for (let i = points.length - 1; i > anchor + 1; i--) {
      if (segmentClear(points[anchor].x, points[anchor].y, points[i].x, points[i].y, radius)) {
        next = i;
        break;
      }
    }
    smoothed.push(points[next]);
    anchor = next;
  }
  return smoothed;
}

// findPath returns a list of waypoints (excluding the start) to walk from
// `start` to `target`, weaving around walls/obstacles as needed. Returns
// null if no route exists at all (shouldn't normally happen — the grid is
// fully connected through the doorways).
export function findPath(start, target, radius = PLAYER_RADIUS) {
  const startCell = toCell(start.x, start.y);
  let goalCell = toCell(target.x, target.y);
  const grid = getWalkGrid();
  if (grid[cellIndex(goalCell.col, goalCell.row)]) {
    const nearest = nearestWalkableCell(goalCell.col, goalCell.row);
    if (!nearest) return null;
    goalCell = nearest;
  }

  // If the straight line is already clear, skip pathfinding entirely.
  const goalPoint = cellCenter(goalCell.col, goalCell.row);
  if (segmentClear(start.x, start.y, target.x, target.y, radius)) {
    return [{ x: target.x, y: target.y }];
  }

  const cellPath = astar(startCell, goalCell, radius);
  if (!cellPath) return null;

  const points = cellPath.map((c) => cellCenter(c.col, c.row));
  points[points.length - 1] = goalPoint;
  const smoothed = smoothPath(points, radius);
  const waypoints = smoothed.slice(1);
  if (waypoints.length === 0) waypoints.push(goalPoint);
  // Swap the final grid-cell center for the actual clicked point when that
  // last leg is clear, so the walk ends exactly where you clicked.
  const last = waypoints[waypoints.length - 1];
  if (segmentClear(last.x, last.y, target.x, target.y, radius)) {
    waypoints.push({ x: target.x, y: target.y });
  }
  return waypoints;
}
