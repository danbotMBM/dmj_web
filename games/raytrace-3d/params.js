/* ════════════════════════════════════════════════════════════
   PARAMS — single source of truth for every tunable constant in
   the 3D sim. The ray / audio / player modules read from here
   each frame, so the admin panel can mutate these live and the
   simulation responds immediately. DEFAULTS is a frozen copy used
   by the panel's "Reset" button and to diff for export.
   ════════════════════════════════════════════════════════════ */
export const Params = {
  direct: {
    RAY_COUNT: 220,    // rays cast over the sphere (higher = smoother, costlier)
    MAX_BOUNCE: 3,     // reflections before a ray is abandoned
    MAX_DIST: 55,      // total path budget per ray (↑ = sound carries further)
    CAPTURE_R: 1.1,    // how close a ray must pass to "reach" the source
    REF_DIST: 6,       // distance at which a ray counts as full strength
    ENERGY_NORM: 0.05, // loudness scale: energy / (rayCount * this)
    SMOOTH: 0.82,      // temporal smoothing (0 = instant, →1 = sluggish)
  },
  echo: {
    RAY_COUNT: 220,
    MAX_BOUNCE: 5,     // bounces allowed before a ray can return
    MAX_DIST: 80,
    RETURN_R: 1.3,     // how close to the player a ray must pass to "return"
    MIN_PATH: 3,       // ignore returns shorter than this (not a real echo)
    REF_DIST: 12,
    SPEED: 343,        // m/s, path length → delay time
    ENERGY_NORM: 0.07,
    SMOOTH: 0.88,
    GAIN: 0.5,         // echo loudness = magnitude * this
    FEEDBACK_MAX: 0.42,// cap on echo regeneration (↑ = longer tails)
  },
  permeate: {
    RAY_COUNT: 25,     // fan rays aimed at the source
    SPREAD: 0.35,      // radians half-angle of the fan
    REF_THICK: 2.0,    // wall metres for noticeable muffling (↓ = walls matter more)
    THROUGH_THICK_MULT: 1.6, // through-volume falloff = exp(-inWall/(REF_THICK*this))
    SMOOTH: 0.86,
    GAIN: 0.85,        // permeated loudness = through * this (↓ = quieter through walls)
    LP_MAX_HZ: 18000,  // filter cutoff when unmuffled
    LP_MIN_HZ: 350,    // filter cutoff when fully muffled (↓ = more "dull")
  },
  audio: {
    MASTER: 0.82,      // overall output gain
    PLACE_R: 3,        // metres from listener that panners are placed
  },
  player: {
    SPEED: 5.5,        // movement speed, m/s
  },
};

// Deep-frozen snapshot of the shipped defaults.
export const DEFAULTS = JSON.parse(JSON.stringify(Params));
