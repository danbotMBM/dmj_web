import { Geo } from './geometry.js';

/* ════════════════════════════════════════════════════════════
   RAY MODULES  — each: cast(origin, walls, source, scene, st) ->
   result. They draw into Scene's rayGroup and return numbers for
   the audio layer + readout.
   ════════════════════════════════════════════════════════════ */
export const RayModules = {
  direct: {
    label: 'Direct',
    color: 0xffb454,
    // Tunables
    RAY_COUNT: 360,        // rays fanned over 360°
    MAX_BOUNCE: 4,         // reflections before a ray is abandoned
    CAPTURE_R: 0.7,        // how close a ray must pass to "reach" the source
    MAX_DIST: 70,          // total path budget per ray
    REF_DIST: 6,           // distance at which a single direct ray = full strength

    cast(origin, walls, source, scene, st) {
      st = st || this;
      const src = { x: source.position.x, y: source.position.z };
      const reached = [];   // {dir0:{x,y}, dist}

      for (let i = 0; i < this.RAY_COUNT; i++) {
        const a = (i / this.RAY_COUNT) * Math.PI * 2;
        let dx = Math.cos(a), dy = Math.sin(a);
        const dir0 = { x: dx, y: dy };          // launch direction (what the ear localizes)
        let ox = origin.x, oy = origin.y;
        let travelled = 0;
        let hitSource = false;
        const path = [{ x: ox, y: oy }];        // bounce vertices of this ray

        for (let b = 0; b <= this.MAX_BOUNCE; b++) {
          const hit = Geo.castRay(ox, oy, dx, dy, walls);
          const segLen = hit ? hit.t : (this.MAX_DIST - travelled);

          // Does the source lie along this segment, before the wall?
          const cap = Geo.capsuleHit(ox, oy, dx, dy, segLen, src, this.CAPTURE_R);
          if (cap != null) {
            travelled += cap;            // distance to closest approach
            path.push({ x: ox + dx * cap, y: oy + dy * cap });
            hitSource = true;
            break;
          }

          if (!hit || travelled + segLen > this.MAX_DIST) break;
          travelled += hit.t;
          path.push({ x: hit.point.x, y: hit.point.y });
          // open-space border: ray escapes, no reflection
          if (hit.seg && hit.seg.boundary && scene && !scene.env.reflectiveBorder) break;
          const r = Geo.reflect(dx, dy, hit.normal.x, hit.normal.y);
          dx = r.x; dy = r.y;
          ox = hit.point.x + dx * 1e-3; oy = hit.point.y + dy * 1e-3;
        }

        if (hitSource) reached.push({ dir0, dist: travelled, path });
      }

      // ── combine: energy-weighted volume + direction ──
      let vx = 0, vy = 0, energy = 0;
      for (const r of reached) {
        // inverse-distance falloff, clamped so very short paths don't blow up
        const w = this.REF_DIST / Math.max(this.REF_DIST, r.dist);
        energy += w;
        vx += r.dir0.x * w; vy += r.dir0.y * w;
      }
      // normalize volume: divide accumulated energy by a soft reference so a
      // handful of close rays ≈ 1.0; many distant rays stay lower.
      const volumeRaw = Math.min(1, energy / (this.RAY_COUNT * 0.06));
      const dirLenRaw = Math.hypot(vx, vy);
      const dirRaw = dirLenRaw > 1e-4 ? { x: vx / dirLenRaw, y: vy / dirLenRaw } : { x: 0, y: 0 };

      // ── temporal smoothing: ease toward the new reading over a few frames ──
      // exponential smoothing; SMOOTH≈0.85 ≈ a handful of frames of inertia.
      const S = this.SMOOTH;
      st._volume = (st._volume||0) * S + volumeRaw * (1 - S);
      st._dvx = (st._dvx||0) * S + (dirRaw.x * volumeRaw) * (1 - S);
      st._dvy = (st._dvy||0) * S + (dirRaw.y * volumeRaw) * (1 - S);
      const sLen = Math.hypot(st._dvx, st._dvy);
      const dir = sLen > 1e-4 ? { x: st._dvx / sLen, y: st._dvy / sLen } : { x: 0, y: 0 };
      const volume = st._volume;

      // ── visualize ──
      if (scene) {
        const col = st.color || this.color;
        // faint full bounce paths — subsample so we never flood the GPU
        const stride = Math.max(1, Math.ceil(reached.length / 40));
        for (let i = 0; i < reached.length; i += stride) {
          const r = reached[i];
          if (r.path.length > 1) scene.drawPolyline(r.path, col, 0.18);
        }
        const arrowLen = 1 + volume * 6;
        scene.drawArrow(origin, dir, volume > 0.01 ? arrowLen : 0, col, 0.3);
      }

      return { volume, dir, reachedCount: reached.length };
    },
    // smoothing state
    _volume: 0, _dvx: 0, _dvy: 0,
    SMOOTH: 0.85,
  },
  echo: {
    label: 'Echo',
    color: 0xff5e87,
    RAY_COUNT: 360,
    MAX_BOUNCE: 6,         // echoes can bounce several times before returning
    RETURN_R: 0.7,         // how close to origin a ray must pass to "return"
    MIN_PATH: 2.5,         // ignore returns shorter than this (not a real echo)
    MAX_DIST: 90,
    REF_DIST: 10,
    SPEED: 343,            // m/s, for converting path length → delay time

    cast(origin, walls, source, scene) {
      const returns = [];   // {arriveDir:{x,y}, dist}

      for (let i = 0; i < this.RAY_COUNT; i++) {
        const a = (i / this.RAY_COUNT) * Math.PI * 2;
        let dx = Math.cos(a), dy = Math.sin(a);
        let ox = origin.x, oy = origin.y;
        let travelled = 0;
        let returned = false, arriveDir = null;
        const path = [{ x: ox, y: oy }];

        for (let b = 0; b <= this.MAX_BOUNCE; b++) {
          const hit = Geo.castRay(ox, oy, dx, dy, walls);
          const segLen = hit ? hit.t : (this.MAX_DIST - travelled);

          // after at least one bounce, does this segment pass back near origin?
          if (b > 0) {
            const back = Geo.capsuleHit(ox, oy, dx, dy, segLen, origin, this.RETURN_R);
            if (back != null && travelled + back > this.MIN_PATH) {
              travelled += back;
              path.push({ x: ox + dx * back, y: oy + dy * back });
              // arrival direction = the way the ray points as it comes back,
              // i.e. it travels (dx,dy) toward the player, so it ARRIVES FROM
              // the opposite side: arrivalFrom = -dir.
              arriveDir = { x: -dx, y: -dy };
              returned = true;
              break;
            }
          }

          if (!hit || travelled + segLen > this.MAX_DIST) break;
          travelled += hit.t;
          path.push({ x: hit.point.x, y: hit.point.y });
          if (hit.seg && hit.seg.boundary && scene && !scene.env.reflectiveBorder) break;
          const r = Geo.reflect(dx, dy, hit.normal.x, hit.normal.y);
          dx = r.x; dy = r.y;
          ox = hit.point.x + dx * 1e-3; oy = hit.point.y + dy * 1e-3;
        }

        if (returned) returns.push({ arriveDir, dist: travelled, path });
      }

      // ── combine factors ──
      let vx = 0, vy = 0, energy = 0, wDelay = 0;
      for (const r of returns) {
        const w = this.REF_DIST / Math.max(this.REF_DIST, r.dist);
        energy += w;
        vx += r.arriveDir.x * w; vy += r.arriveDir.y * w;
        wDelay += (r.dist / this.SPEED) * w;     // energy-weighted return time
      }
      const magnitudeRaw = Math.min(1, energy / (this.RAY_COUNT * 0.08));
      const meanDelayRaw = energy > 1e-6 ? wDelay / energy : 0;   // seconds
      const dLenRaw = Math.hypot(vx, vy);
      const dirRaw = dLenRaw > 1e-4 ? { x: vx / dLenRaw, y: vy / dLenRaw } : { x: 0, y: 0 };

      // ── temporal smoothing ──
      const S = this.SMOOTH;
      this._mag = this._mag * S + magnitudeRaw * (1 - S);
      this._delay = this._delay * S + meanDelayRaw * (1 - S);
      this._dvx = this._dvx * S + (dirRaw.x * magnitudeRaw) * (1 - S);
      this._dvy = this._dvy * S + (dirRaw.y * magnitudeRaw) * (1 - S);
      const sLen = Math.hypot(this._dvx, this._dvy);
      const dir = sLen > 1e-4 ? { x: this._dvx / sLen, y: this._dvy / sLen } : { x: 0, y: 0 };
      const magnitude = this._mag, delay = this._delay;

      // ── visualize: returning ray paths + arrow toward echo origin ──
      if (scene) {
        const stride = Math.max(1, Math.ceil(returns.length / 40));
        for (let i = 0; i < returns.length; i += stride) {
          const r = returns[i];
          if (r.path.length > 1) scene.drawPolyline(r.path, this.color, 0.15);
        }
        if (magnitude > 0.01) {
          scene.drawArrow(origin, dir, 1 + magnitude * 5, this.color, 0.28);
        }
      }

      return { magnitude, dir, delay, returnCount: returns.length };
    },
    _mag: 0, _delay: 0, _dvx: 0, _dvy: 0,
    SMOOTH: 0.88,
  },
  permeate: {
    label: 'Permeate',
    color: 0x7ee787,
    RAY_COUNT: 41,         // tight fan aimed at the source
    SPREAD: 0.5,           // radians half-angle of the fan
    REF_THICK: 1.0,        // in-wall metres for "noticeable" muffling

    cast(origin, walls, source, scene, st) {
      st = st || this;
      const src = { x: source.position.x, y: source.position.z };
      const toSrc = { x: src.x - origin.x, y: src.y - origin.y };
      const dist = Math.hypot(toSrc.x, toSrc.y) || 1;
      const baseAng = Math.atan2(toSrc.y, toSrc.x);

      let sumInside = 0, sumWalls = 0, n = 0;
      const rays = [];   // {end:{x,y}, insideSegs:[[t0,t1],...], dx, dy}

      for (let i = 0; i < this.RAY_COUNT; i++) {
        const f = this.RAY_COUNT === 1 ? 0 : (i / (this.RAY_COUNT - 1)) * 2 - 1; // -1..1
        const a = baseAng + f * this.SPREAD;
        const dx = Math.cos(a), dy = Math.sin(a);

        // collect all wall crossings along the straight path up to the source.
        const crossings = [];
        for (const s of walls) {
          const h = Geo.raySegment(origin.x, origin.y, dx, dy, s);
          if (h && h.t <= dist) crossings.push(h.t);
        }
        crossings.sort((p, q) => p - q);

        // entry/exit pairs → in-wall distance. Odd leftover = inside at source.
        let inside = 0, wallCount = 0;
        const insideSegs = [];
        for (let k = 0; k + 1 < crossings.length; k += 2) {
          inside += crossings[k + 1] - crossings[k];
          insideSegs.push([crossings[k], crossings[k + 1]]);
          wallCount++;
        }
        if (crossings.length % 2 === 1) {
          const last = crossings[crossings.length - 1];
          const segEnd = Math.min(dist, last + 0.4);
          inside += Math.min(0.4, dist - last);
          insideSegs.push([last, segEnd]);
          wallCount++;
        }

        sumInside += inside; sumWalls += wallCount; n++;
        rays.push({ dx, dy, insideSegs });
      }

      const avgInside = sumInside / n;          // metres of solid traversed
      const avgWalls = sumWalls / n;

      // muffle 0..1 (saturating) from in-wall distance; through-volume falls
      // off with material crossed.
      const muffleRaw = 1 - Math.exp(-avgInside / this.REF_THICK);
      const throughRaw = Math.exp(-avgInside / (this.REF_THICK * 1.6));

      // ── smoothing ──
      const S = this.SMOOTH;
      st._muffle = (st._muffle||0) * S + muffleRaw * (1 - S);
      st._through = (st._through==null?1:st._through) * S + throughRaw * (1 - S);
      const muffle = st._muffle, through = st._through;

      // direction to source (permeated sound comes straight from the source)
      const dir = { x: toSrc.x / dist, y: toSrc.y / dist };

      // ── visualize: the full permeating fan; in-wall portions highlighted ──
      if (scene) {
        const col = st.color || this.color;
        const stride = 2;   // draw every other ray to keep line count down
        for (let i = 0; i < rays.length; i += stride) {
          const ray = rays[i];
          const ex = origin.x + ray.dx * dist, ey = origin.y + ray.dy * dist;
          scene.drawPolyline([origin, { x: ex, y: ey }], col, 0.1);
          for (const [t0, t1] of ray.insideSegs) {
            scene.drawPolyline(
              [{ x: origin.x + ray.dx * t0, y: origin.y + ray.dy * t0 },
               { x: origin.x + ray.dx * t1, y: origin.y + ray.dy * t1 }],
              col, 0.7
            );
          }
        }
      }

      return { muffle, through, avgInside, avgWalls, dir };
    },
    _muffle: 0, _through: 1,
    SMOOTH: 0.86,
  },
};
