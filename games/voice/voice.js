// Voice chat client with proximity audio.
//
// Captures the mic at 16 kHz, voice-activity-gates it in an AudioWorklet, and
// streams 20 ms int16 PCM frames to the Go mixer over a WebSocket. Players walk
// a shared 2D space (WASD / arrow keys); we stream our position to the server,
// which mixes a personalized stream per listener where each speaker's volume is
// a smoothstep function of distance (times the listener's manual slider trim).
// The mixed stream plays back through a second worklet.
// See games/voice/voice-worklet.js and backend/voice.go.

import { API_BASE } from "/utils.js";

const ID_KEY = "voice_player_id";
const NAME_KEY = "voice_player_name";

let playerId = localStorage.getItem(ID_KEY);
if (!playerId) {
  playerId = crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random();
  localStorage.setItem(ID_KEY, playerId);
}
let playerName = localStorage.getItem(NAME_KEY) || "";

const wsBase = API_BASE.replace(/^http/, "ws");

// --- DOM ---
const joinView = document.getElementById("join-view");
const roomView = document.getElementById("room-view");
const nameInput = document.getElementById("name-input");
const joinBtn = document.getElementById("join-btn");
const joinError = document.getElementById("join-error");
const roomCount = document.getElementById("room-count");
const roomCountLive = document.getElementById("room-count-live");
const participants = document.getElementById("participants");
const micToggle = document.getElementById("mic-toggle");
const micMeterBar = document.getElementById("mic-meter-bar");
const leaveBtn = document.getElementById("leave-btn");
const statusBanner = document.getElementById("status-banner");
const canvas = document.getElementById("space");
const ctx2d = canvas.getContext("2d");

// --- session state ---
let ws = null;
let audioCtx = null;
let micStream = null;
let captureNode = null;
let playbackNode = null;
let selfMuted = false;
let roster = []; // [{id, name, muted}]
let speakingSet = new Set();
const volumes = {}; // speakerId -> gain (0..2), remembered locally across roster updates

// --- proximity space state ---
// World geometry comes from the server's "welcome" message so client and server
// agree on coordinates (the server computes distance-based gain from these).
const world = { w: 900, h: 540, full: 200, silence: 700, occluded: 0.2 };
let walls = [];                       // [{x,y,w,h}] room dividers, from the server
const me = { x: 0, y: 0 };            // our authoritative local position
const others = new Map();             // id -> { x, y, tx, ty } (tx/ty = server target, x/y interpolated)
const keys = new Set();               // currently-held movement keys
const MOVE_SPEED = 280;               // world units / second
let rafId = null;
let lastFrameT = 0;
let lastSentT = 0;
let lastSent = { x: null, y: null };

nameInput.value = playerName;

// Show how many people are already in the room before committing the mic.
async function refreshInfo() {
  try {
    const r = await fetch(API_BASE + "/voice/info");
    const d = await r.json();
    roomCount.textContent = `${d.count}/${d.max} in the room`;
  } catch {
    roomCount.textContent = "";
  }
}
refreshInfo();

joinBtn.addEventListener("click", join);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") join();
});
leaveBtn.addEventListener("click", leave);
micToggle.addEventListener("click", toggleMute);

async function join() {
  joinError.textContent = "";
  playerName = (nameInput.value || "").trim().slice(0, 16);
  if (!playerName) {
    joinError.textContent = "Pick a name first.";
    return;
  }
  localStorage.setItem(NAME_KEY, playerName);
  joinBtn.disabled = true;

  try {
    await startAudio();
  } catch (err) {
    joinError.textContent = "Microphone access is required: " + err.message;
    joinBtn.disabled = false;
    return;
  }

  const url = `${wsBase}/voice/ws?id=${encodeURIComponent(playerId)}&name=${encodeURIComponent(playerName)}`;
  ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    joinView.classList.add("hidden");
    roomView.classList.remove("hidden");
    setStatus("Connected — start talking.", "ok");
  };
  ws.onmessage = onMessage;
  ws.onerror = () => setStatus("Connection error.", "err");
  ws.onclose = (e) => {
    teardownAudio();
    stopSpace();
    joinBtn.disabled = false;
    roomView.classList.add("hidden");
    joinView.classList.remove("hidden");
    setStatus(e.reason ? `Disconnected: ${e.reason}` : "Disconnected.", "err");
    refreshInfo();
  };
}

function leave() {
  if (ws) ws.close(1000, "left");
}

// --- audio pipeline ---
async function startAudio() {
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });

  // 16 kHz context => the browser resamples the mic to our wire rate, and the
  // mixed audio we receive (also 16 kHz) plays back without resampling.
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  await audioCtx.audioWorklet.addModule("/games/voice/voice-worklet.js");

  const source = audioCtx.createMediaStreamSource(micStream);
  captureNode = new AudioWorkletNode(audioCtx, "vc-capture");
  playbackNode = new AudioWorkletNode(audioCtx, "vc-playback", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });

  captureNode.port.onmessage = (e) => {
    const { rms, pcm } = e.data;
    micMeterBar.style.width = Math.min(100, rms * 600) + "%";
    if (pcm && ws && ws.readyState === WebSocket.OPEN && !selfMuted) {
      ws.send(pcm); // transfer the int16 frame straight to the socket
    }
  };

  source.connect(captureNode);
  captureNode.connect(audioCtx.destination); // pull the capture graph (outputs silence)
  playbackNode.connect(audioCtx.destination);
}

function teardownAudio() {
  if (captureNode) captureNode.disconnect();
  if (playbackNode) playbackNode.disconnect();
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  if (audioCtx) audioCtx.close();
  captureNode = playbackNode = micStream = audioCtx = null;
}

// --- websocket messages ---
function onMessage(e) {
  if (typeof e.data !== "string") {
    // Binary = one mixed PCM frame: hand it to the playback worklet.
    if (playbackNode) playbackNode.port.postMessage(e.data, [e.data]);
    return;
  }
  const msg = JSON.parse(e.data);
  switch (msg.type) {
    case "welcome":
      playerId = msg.id;
      localStorage.setItem(ID_KEY, playerId);
      world.w = msg.worldW ?? world.w;
      world.h = msg.worldH ?? world.h;
      world.full = msg.fullRadius ?? world.full;
      world.silence = msg.silenceRadius ?? world.silence;
      world.occluded = msg.occludedGain ?? world.occluded;
      walls = msg.walls ?? [];
      me.x = msg.x ?? world.w / 2;
      me.y = msg.y ?? world.h / 2;
      canvas.width = world.w;
      canvas.height = world.h;
      startSpace();
      break;
    case "roster":
      roster = msg.players;
      // Drop render state for anyone who left.
      for (const id of [...others.keys()]) {
        if (!roster.some((p) => p.id === id)) others.delete(id);
      }
      renderParticipants();
      break;
    case "positions":
      for (const p of msg.players) {
        if (p.id === playerId) continue; // we own our own position locally
        const o = others.get(p.id);
        if (o) {
          o.tx = p.x;
          o.ty = p.y;
        } else {
          others.set(p.id, { x: p.x, y: p.y, tx: p.x, ty: p.y });
        }
      }
      break;
    case "activity":
      speakingSet = new Set(msg.speaking);
      updateSpeaking();
      break;
    case "error":
      setStatus(msg.message || "Server error.", "err");
      break;
  }
}

function sendControl(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function toggleMute() {
  selfMuted = !selfMuted;
  micToggle.textContent = selfMuted ? "🔇 Mic muted" : "🎙️ Mic live";
  micToggle.classList.toggle("muted", selfMuted);
  if (captureNode) captureNode.port.postMessage({ type: "mute", muted: selfMuted });
  sendControl({ type: "mute", muted: selfMuted });
}

// --- rendering ---
function renderParticipants() {
  roomCountLive.textContent = `${roster.length}/6 in the room`;
  participants.innerHTML = "";

  for (const p of roster) {
    const isSelf = p.id === playerId;
    const row = document.createElement("div");
    row.className = "participant";
    row.dataset.id = p.id;

    const dot = document.createElement("span");
    dot.className = "speak-dot";

    const name = document.createElement("span");
    name.className = "participant-name";
    name.textContent = p.name + (isSelf ? " (you)" : "");

    row.appendChild(dot);
    row.appendChild(name);

    if (isSelf) {
      const tag = document.createElement("span");
      tag.className = "self-tag";
      tag.textContent = selfMuted ? "muted" : "you";
      row.appendChild(tag);
    } else {
      // Per-user volume slider — a personal multiplier the server applies on
      // top of the automatic proximity gain.
      const gain = volumes[p.id] ?? 1;
      const vol = document.createElement("input");
      vol.type = "range";
      vol.min = "0";
      vol.max = "200";
      vol.value = String(Math.round(gain * 100));
      vol.className = "vol-slider";
      vol.setAttribute("aria-label", `Volume for ${p.name}`);

      const pct = document.createElement("span");
      pct.className = "vol-pct";
      pct.textContent = vol.value + "%";

      vol.addEventListener("input", () => {
        const g = Number(vol.value) / 100;
        volumes[p.id] = g;
        pct.textContent = vol.value + "%";
        sendControl({ type: "volume", target: p.id, gain: g });
      });

      row.appendChild(vol);
      row.appendChild(pct);
    }

    participants.appendChild(row);
  }
  updateSpeaking();

  // Re-assert any remembered volumes for speakers still present (e.g. after a
  // reconnect the server starts everyone at 100%).
  for (const p of roster) {
    if (p.id !== playerId && volumes[p.id] != null && volumes[p.id] !== 1) {
      sendControl({ type: "volume", target: p.id, gain: volumes[p.id] });
    }
  }
}

function updateSpeaking() {
  for (const row of participants.children) {
    const speaking = speakingSet.has(row.dataset.id);
    row.classList.toggle("speaking", speaking);
  }
}

// --- proximity space: movement + rendering ---

const MOVE_KEYS = {
  w: "up", arrowup: "up",
  s: "down", arrowdown: "down",
  a: "left", arrowleft: "left",
  d: "right", arrowright: "right",
};

function onKeyDown(e) {
  if (!rafId) return; // only while in the room
  const dir = MOVE_KEYS[e.key.toLowerCase()];
  if (!dir) return;
  keys.add(dir);
  e.preventDefault(); // stop arrow keys from scrolling the page
}
function onKeyUp(e) {
  const dir = MOVE_KEYS[e.key.toLowerCase()];
  if (dir) keys.delete(dir);
}
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);

function startSpace() {
  if (rafId) return;
  lastFrameT = performance.now();
  rafId = requestAnimationFrame(frame);
}

function stopSpace() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  keys.clear();
  others.clear();
}

function frame(t) {
  const dt = Math.min(0.05, (t - lastFrameT) / 1000); // clamp dt across tab stalls
  lastFrameT = t;

  // Integrate local movement from held keys, then clamp to the world.
  let vx = 0, vy = 0;
  if (keys.has("left")) vx -= 1;
  if (keys.has("right")) vx += 1;
  if (keys.has("up")) vy -= 1;
  if (keys.has("down")) vy += 1;
  if (vx || vy) {
    const inv = 1 / Math.hypot(vx, vy); // normalize so diagonals aren't faster
    const nx = clamp(me.x + vx * inv * MOVE_SPEED * dt, 0, world.w);
    const ny = clamp(me.y + vy * inv * MOVE_SPEED * dt, 0, world.h);
    // Try the full move; if a wall blocks it, slide along the free axis.
    if (!blocked(nx, ny)) {
      me.x = nx;
      me.y = ny;
    } else {
      if (!blocked(nx, me.y)) me.x = nx;
      if (!blocked(me.x, ny)) me.y = ny;
    }
  }

  // Throttle position updates to ~15/sec, and only when we've actually moved.
  if (t - lastSentT > 66 && (me.x !== lastSent.x || me.y !== lastSent.y)) {
    sendControl({ type: "position", x: Math.round(me.x), y: Math.round(me.y) });
    lastSent = { x: me.x, y: me.y };
    lastSentT = t;
  }

  // Ease remote avatars toward their last reported position for smooth motion.
  for (const o of others.values()) {
    o.x += (o.tx - o.x) * Math.min(1, dt * 12);
    o.y += (o.ty - o.y) * Math.min(1, dt * 12);
  }

  draw();
  rafId = requestAnimationFrame(frame);
}

// colorFor maps a player id to a stable, vivid color so everyone sees the same
// color for the same person.
const colorCache = new Map();
function colorFor(id) {
  if (colorCache.has(id)) return colorCache.get(id);
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const color = `hsl(${h % 360}, 70%, 55%)`;
  colorCache.set(id, color);
  return color;
}

const R = 18; // avatar radius (world units)

function draw() {
  const styles = getComputedStyle(document.body);
  const fg = styles.getPropertyValue("--fgColor-default").trim() || "#222";

  ctx2d.clearRect(0, 0, world.w, world.h);

  // Hearing field (drawn under the walls): the muffled reach as a dim full disk,
  // and the clear line-of-sight area lit only where the sightline isn't blocked.
  drawHearingField();

  // Glowing light-blue room walls + outer border.
  ctx2d.save();
  ctx2d.shadowColor = "#4dd2ff";
  ctx2d.shadowBlur = 10;
  ctx2d.strokeStyle = "#4dd2ff";
  ctx2d.lineWidth = 4;
  ctx2d.strokeRect(2, 2, world.w - 4, world.h - 4);
  ctx2d.fillStyle = "rgba(77,210,255,0.18)";
  ctx2d.lineWidth = 2;
  for (const w of walls) {
    if (ctx2d.roundRect) {
      ctx2d.beginPath();
      ctx2d.roundRect(w.x, w.y, w.w, w.h, 4);
      ctx2d.fill();
      ctx2d.stroke();
    } else {
      ctx2d.fillRect(w.x, w.y, w.w, w.h);
      ctx2d.strokeRect(w.x, w.y, w.w, w.h);
    }
  }
  ctx2d.restore();

  // Connector lines to anyone currently audible, opacity ~ proximity volume.
  for (const p of roster) {
    if (p.id === playerId) continue;
    const o = others.get(p.id);
    if (!o) continue;
    const g = proximityGainLocal(me.x, me.y, o.x, o.y);
    if (g <= 0) continue;
    ctx2d.strokeStyle = `rgba(111,155,209,${0.5 * g})`;
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.moveTo(me.x, me.y);
    ctx2d.lineTo(o.x, o.y);
    ctx2d.stroke();
  }

  // Avatars.
  for (const p of roster) {
    const isSelf = p.id === playerId;
    const pos = isSelf ? me : others.get(p.id);
    if (!pos) continue;
    drawAvatar(pos.x, pos.y, colorFor(p.id), p.name, isSelf, speakingSet.has(p.id), p.muted, fg);
  }
}

// drawHearingField paints two layers centered on the local player:
//   1) the muffled reach — a dim disk out to the silence radius (sound carries
//      everywhere within it, even through walls), and
//   2) the line-of-sight area — a brighter visibility polygon that lights up
//      only the sections with a clear sightline, leaving wall shadows dim.
function drawHearingField() {
  ctx2d.save();

  // 1) Muffled reach.
  ctx2d.beginPath();
  ctx2d.arc(me.x, me.y, world.silence, 0, Math.PI * 2);
  ctx2d.fillStyle = "rgba(111,155,209,0.05)";
  ctx2d.fill();

  // 2) Line of sight: fill the visibility polygon, fading with distance to hint
  // at the volume falloff. The polygon excludes anything behind a wall, so only
  // the visible wedges light up.
  const poly = visibilityPolygon(me.x, me.y, world.silence);
  if (poly.length > 2) {
    const grad = ctx2d.createRadialGradient(
      me.x, me.y, Math.min(world.full, world.silence) * 0.5,
      me.x, me.y, world.silence
    );
    grad.addColorStop(0, "rgba(120,200,255,0.30)");
    grad.addColorStop(1, "rgba(120,200,255,0.03)");
    ctx2d.fillStyle = grad;
    ctx2d.beginPath();
    ctx2d.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx2d.lineTo(poly[i][0], poly[i][1]);
    ctx2d.closePath();
    ctx2d.fill();
  }

  // Full-volume zone marker (where a clear sightline is loudest).
  ctx2d.setLineDash([5, 5]);
  ctx2d.lineWidth = 1.5;
  ctx2d.strokeStyle = "rgba(120,200,255,0.45)";
  ctx2d.beginPath();
  ctx2d.arc(me.x, me.y, world.full, 0, Math.PI * 2);
  ctx2d.stroke();

  ctx2d.restore();
}

// visibilityPolygon casts rays from (px,py) toward every wall corner (and a ring
// of fixed bearings for the open arcs), capped at `radius`, and returns the hit
// points sorted by angle — the polygon of everything in direct line of sight.
function visibilityPolygon(px, py, radius) {
  const segs = wallSegments();
  const angles = [];
  for (const s of segs) {
    for (const [x, y] of [[s[0], s[1]], [s[2], s[3]]]) {
      const a = Math.atan2(y - py, x - px);
      angles.push(a - 0.0002, a, a + 0.0002); // straddle each corner to wrap around it
    }
  }
  for (let a = -Math.PI; a < Math.PI; a += Math.PI / 36) angles.push(a); // smooth open arcs

  const poly = [];
  for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let dist = radius;
    for (const s of segs) {
      const t = raySegHit(px, py, dx, dy, s[0], s[1], s[2], s[3]);
      if (t !== null && t < dist) dist = t;
    }
    poly.push([px + dx * dist, py + dy * dist, a]);
  }
  poly.sort((u, v) => u[2] - v[2]);
  return poly;
}

// wallSegments returns the four edges of each wall plus the world border, as
// [x0,y0,x1,y1] occluders for the visibility raycast.
function wallSegments() {
  const segs = [];
  for (const w of walls) {
    const x0 = w.x, y0 = w.y, x1 = w.x + w.w, y1 = w.y + w.h;
    segs.push([x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]);
  }
  segs.push([0, 0, world.w, 0], [world.w, 0, world.w, world.h],
            [world.w, world.h, 0, world.h], [0, world.h, 0, 0]);
  return segs;
}

// raySegHit returns the ray parameter t>=0 where ray (px,py)+t*(dx,dy) crosses
// segment AB, or null if it doesn't.
function raySegHit(px, py, dx, dy, ax, ay, bx, by) {
  const v1x = px - ax, v1y = py - ay;
  const v2x = bx - ax, v2y = by - ay;
  const v3x = -dy, v3y = dx;
  const denom = v2x * v3x + v2y * v3y;
  if (Math.abs(denom) < 1e-9) return null; // ray parallel to segment
  const t1 = (v2x * v1y - v2y * v1x) / denom; // distance along the ray
  const t2 = (v1x * v3x + v1y * v3y) / denom; // 0..1 along the segment
  if (t1 >= 0 && t2 >= 0 && t2 <= 1) return t1;
  return null;
}

function drawAvatar(x, y, color, name, isSelf, speaking, muted, fg) {
  ctx2d.save();
  if (speaking) {
    ctx2d.beginPath();
    ctx2d.arc(x, y, R + 6, 0, Math.PI * 2);
    ctx2d.fillStyle = "rgba(76,175,80,0.35)";
    ctx2d.fill();
  }
  ctx2d.beginPath();
  ctx2d.arc(x, y, R, 0, Math.PI * 2);
  ctx2d.fillStyle = muted ? "#888" : color;
  ctx2d.fill();
  ctx2d.lineWidth = isSelf ? 4 : 2;
  ctx2d.strokeStyle = isSelf ? "#fff" : "rgba(0,0,0,0.35)";
  ctx2d.stroke();

  ctx2d.fillStyle = fg;
  ctx2d.font = "600 14px system-ui, sans-serif";
  ctx2d.textAlign = "center";
  ctx2d.textBaseline = "top";
  ctx2d.fillText(name + (isSelf ? " (you)" : ""), x, y + R + 4);
  ctx2d.restore();
}

// proximityGainLocal mirrors the server's gain (distance falloff gated by line
// of sight) for the connector-line visuals only; the real gain is server-side.
function proximityGainLocal(ax, ay, bx, by) {
  const d = Math.hypot(ax - bx, ay - by);
  let g;
  if (d <= world.full) g = 1;
  else if (d >= world.silence) return 0;
  else {
    const t = (d - world.full) / (world.silence - world.full);
    g = 1 - t * t * (3 - 2 * t);
  }
  if (sightBlocked(ax, ay, bx, by)) g *= world.occluded;
  return g;
}

// sightBlocked reports whether any wall crosses the line between two points.
function sightBlocked(x0, y0, x1, y1) {
  for (const w of walls) {
    if (segHitsRect(x0, y0, x1, y1, w.x, w.y, w.x + w.w, w.y + w.h)) return true;
  }
  return false;
}

// segHitsRect: segment vs axis-aligned box via Liang–Barsky slab clipping.
function segHitsRect(x0, y0, x1, y1, minx, miny, maxx, maxy) {
  const dx = x1 - x0, dy = y1 - y0;
  let t0 = 0, t1 = 1;
  const edges = [[-dx, x0 - minx], [dx, maxx - x0], [-dy, y0 - miny], [dy, maxy - y0]];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// blocked mirrors the server's wall test: walls inflated by the avatar radius so
// the circle can't clip a corner. Keeps local movement in sync with what the
// server will accept.
function blocked(x, y) {
  for (const w of walls) {
    if (x > w.x - R && x < w.x + w.w + R && y > w.y - R && y < w.y + w.h + R) return true;
  }
  return false;
}

function setStatus(text, kind) {
  statusBanner.textContent = text;
  statusBanner.className = "status-banner " + (kind || "");
}

window.addEventListener("beforeunload", () => {
  if (ws) ws.close();
});
