import { API_BASE } from "/utils.js";
import { WORLD_W, WORLD_H, PLAYER_RADIUS, SCALE, rooms, walls, spawnPoint, resolveCollision, hasLineOfSight, findPath } from "/games/voice/house.js";

// ---------------------------------------------------------------------------
// Voice Room client — a WebRTC mesh (coordinated by the Go signaling server)
// plus a walkable house shared by everyone in the room.
//
// Each remote participant gets their own RTCPeerConnection (a full mesh, fine
// for <=6 people). The server only relays SDP/ICE and broadcasts everyone's
// position/name/color; audio itself is peer-to-peer.
//
// Volume model: every remote stream is routed through a Web Audio GainNode.
// Its value is spatialGain(distance, lineOfSight) * that peer's slider
// multiplier — full volume up close with a clear line of sight, a faint
// "muffled through the wall" murmur from adjacent rooms, and silence beyond
// each reach radius. See spatialGain() below.
//
// Negotiation is glare-free by convention: when you join you receive the list
// of peers already present and send an offer to each of them. Anyone who
// joins after you will, in turn, offer to you.
// ---------------------------------------------------------------------------

const NAME_KEY = "dmj-voice-name";
const COLOR_KEY = "dmj-voice-color";
const TOKEN_KEY = "dmj-voice-token";

const PALETTE = ["#5b8def", "#e0575b", "#3ec46d", "#f2b134", "#b56ce2", "#37c4c4", "#e0729a", "#c9822e"];

// --- spatial audio model -----------------------------------------------------
// Ranges scale with the house's SCALE factor so they stay proportional to
// room size regardless of how large the world is.
const FULL_VOLUME_R = 90 * SCALE;    // full volume out to this distance
const LOS_SILENCE_R = 420 * SCALE;   // max reach with a clear line of sight
const MUFFLED_SILENCE_R = 190 * SCALE; // max reach through a wall
const MUFFLE_FACTOR = 0.35;  // volume multiplier when blocked by a wall

function falloff(d, maxR) {
  if (d <= FULL_VOLUME_R) return 1;
  if (d >= maxR) return 0;
  return 1 - (d - FULL_VOLUME_R) / (maxR - FULL_VOLUME_R);
}

function spatialGain(dist, los) {
  if (los) return falloff(dist, LOS_SILENCE_R);
  if (dist >= MUFFLED_SILENCE_R) return 0;
  return falloff(dist, MUFFLED_SILENCE_R) * MUFFLE_FACTOR;
}

// --- elements -----------------------------------------------------------------
const banner = document.getElementById("status-banner");
const canvas = document.getElementById("house-canvas");
const ctx2d = canvas.getContext("2d");
const canvasWrap = document.getElementById("canvas-wrap");
const selfBar = document.getElementById("self-bar");
const selfNameEl = document.getElementById("self-name");
const selfLevelBar = document.getElementById("self-level-bar");
const btnMute = document.getElementById("btn-mute");
const btnLeave = document.getElementById("btn-leave");
const overlay = document.getElementById("name-overlay");
const nameInput = document.getElementById("name-input");
const nameError = document.getElementById("name-error");
const nameSubmit = document.getElementById("name-submit");
const joinColorRow = document.getElementById("join-color-row");

const btnMenu = document.getElementById("btn-menu");
const sideMenu = document.getElementById("side-menu");
const menuBackdrop = document.getElementById("menu-backdrop");
const settingsName = document.getElementById("settings-name");
const settingsColorRow = document.getElementById("settings-color-row");
const settingsTokenField = document.getElementById("settings-token");
const settingsTokenCopy = document.getElementById("settings-token-copy");
const settingsTokenInput = document.getElementById("settings-token-input");
const settingsTokenLoad = document.getElementById("settings-token-load");
const settingsTokenMsg = document.getElementById("settings-token-msg");
const peerVolumeList = document.getElementById("peer-volume-list");

// --- state ------------------------------------------------------------------
let iceServers = [{ urls: ["stun:stun.l.google.com:19302"] }];
let ws = null;
let selfId = null;
let localStream = null;
let audioCtx = null;
let muted = false;
let hasJoined = false;
let selfName = "";
let selfColor = PALETTE[0];
let selfToken = "";
let selfPos = { ...spawnPoint };
let movePath = []; // queue of waypoints (world points) still to walk through
const MOVE_SPEED = 260 * SCALE; // world units / second
let lastMoveSend = 0;
let lastMoveSentPos = { x: -1, y: -1 };
const peers = new Map(); // id -> { name, color, x, y, pc, gain, volumeMult, audioEl, analyser, speaking, pending: [], els }

// --- bootstrap --------------------------------------------------------------
selfToken = localStorage.getItem(TOKEN_KEY) || crypto.randomUUID();
localStorage.setItem(TOKEN_KEY, selfToken);
selfName = localStorage.getItem(NAME_KEY) || "";
selfColor = localStorage.getItem(COLOR_KEY) || PALETTE[Math.floor(Math.random() * PALETTE.length)];

nameInput.value = selfName;
buildColorSwatches(joinColorRow, selfColor, (c) => { selfColor = c; });
buildColorSwatches(settingsColorRow, selfColor, (c) => { selfColor = c; onIdentityChange(); });
settingsName.value = selfName;
settingsTokenField.value = selfToken;

nameSubmit.addEventListener("click", join);
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
btnMute.addEventListener("click", toggleMute);
btnLeave.addEventListener("click", () => location.reload());

btnMenu.addEventListener("click", () => toggleMenu());
menuBackdrop.addEventListener("click", () => toggleMenu(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && sideMenu.classList.contains("open")) toggleMenu(false);
});

function toggleMenu(open) {
  const next = open === undefined ? !sideMenu.classList.contains("open") : open;
  sideMenu.classList.toggle("open", next);
  menuBackdrop.classList.toggle("hidden", !next);
  btnMenu.setAttribute("aria-expanded", String(next));
}

let identityDebounce = null;
settingsName.addEventListener("input", () => {
  selfName = settingsName.value.trim().slice(0, 16);
  selfNameEl.textContent = selfName || "Guest";
  onIdentityChange();
});
settingsTokenCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(selfToken);
    settingsTokenMsg.textContent = "Copied!";
  } catch (e) {
    settingsTokenMsg.textContent = "Copy failed — select and copy manually.";
  }
  setTimeout(() => { settingsTokenMsg.textContent = ""; }, 2500);
});
settingsTokenLoad.addEventListener("click", async () => {
  const token = settingsTokenInput.value.trim();
  if (!token) return;
  settingsTokenMsg.textContent = "Loading…";
  try {
    const r = await fetch(API_BASE + "/voice/profile/" + encodeURIComponent(token));
    if (!r.ok) {
      settingsTokenMsg.textContent = r.status === 404 ? "No saved profile for that token." : "Couldn't load that token.";
      return;
    }
    const p = await r.json();
    selfToken = token;
    localStorage.setItem(TOKEN_KEY, selfToken);
    settingsTokenField.value = selfToken;
    selfName = p.name;
    selfColor = p.color;
    settingsName.value = selfName;
    nameInput.value = selfName;
    selfNameEl.textContent = selfName || "Guest";
    buildColorSwatches(settingsColorRow, selfColor, (c) => { selfColor = c; onIdentityChange(); });
    buildColorSwatches(joinColorRow, selfColor, (c) => { selfColor = c; });
    localStorage.setItem(NAME_KEY, selfName);
    localStorage.setItem(COLOR_KEY, selfColor);
    sendProfile();
    settingsTokenMsg.textContent = "Profile loaded.";
  } catch (e) {
    settingsTokenMsg.textContent = "Couldn't load that token.";
  }
  setTimeout(() => { settingsTokenMsg.textContent = ""; }, 3000);
});

function buildColorSwatches(container, current, onPick) {
  container.innerHTML = "";
  for (const c of PALETTE) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "color-swatch";
    b.style.background = c;
    b.setAttribute("aria-label", "Color " + c);
    if (c === current) b.classList.add("selected");
    b.addEventListener("click", () => {
      container.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("selected"));
      b.classList.add("selected");
      onPick(c);
    });
    container.appendChild(b);
  }
}

// Debounced: pushes a live rename/recolor to peers over the socket and
// persists it to the player's token so it's there next time (any device).
function onIdentityChange() {
  localStorage.setItem(NAME_KEY, selfName);
  localStorage.setItem(COLOR_KEY, selfColor);
  clearTimeout(identityDebounce);
  identityDebounce = setTimeout(() => {
    sendProfile();
    saveProfileToServer();
  }, 500);
}

function sendProfile() {
  send({ type: "profile", name: selfName || "Guest", color: selfColor });
}

async function saveProfileToServer() {
  try {
    await fetch(API_BASE + "/voice/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: selfToken, name: selfName || "Guest", color: selfColor }),
    });
  } catch (e) { /* best-effort */ }
}

async function loadConfig() {
  try {
    const r = await fetch(API_BASE + "/voice/config");
    if (r.ok) {
      const cfg = await r.json();
      if (Array.isArray(cfg.iceServers) && cfg.iceServers.length) {
        iceServers = cfg.iceServers;
      }
    }
  } catch (e) { /* fall back to default STUN */ }
}
loadConfig();

// --- join flow --------------------------------------------------------------
async function join() {
  const name = nameInput.value.trim();
  if (!name) {
    showNameError("Please enter a name.");
    return;
  }
  selfName = name.slice(0, 16);
  localStorage.setItem(NAME_KEY, selfName);
  localStorage.setItem(COLOR_KEY, selfColor);
  settingsName.value = selfName;
  nameSubmit.disabled = true;
  hideNameError();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (e) {
    nameSubmit.disabled = false;
    showNameError("Microphone access is required to join.");
    return;
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") { try { await audioCtx.resume(); } catch (e) {} }
  setupLocalMeter();

  selfPos = jitteredSpawn();
  selfNameEl.textContent = selfName;
  overlay.classList.add("hidden");
  selfBar.classList.remove("hidden");
  hasJoined = true;

  setupCanvasInput();
  connectSignaling();
  saveProfileToServer();
}

function jitteredSpawn() {
  const jitter = () => (Math.random() - 0.5) * 60 * SCALE;
  return resolveCollision(spawnPoint.x + jitter(), spawnPoint.y + jitter());
}

function connectSignaling() {
  banner.textContent = "Connecting…";
  const wsUrl = API_BASE.replace(/^http/, "ws") + "/voice/ws";
  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    send({ type: "join", name: selfName, color: selfColor, x: selfPos.x, y: selfPos.y });
  });
  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    handleSignal(msg);
  });
  ws.addEventListener("close", () => onDisconnected());
  ws.addEventListener("error", () => { /* close handler covers UI */ });
}

// --- signaling handlers -----------------------------------------------------
async function handleSignal(msg) {
  switch (msg.type) {
    case "welcome":
      selfId = msg.self;
      banner.textContent = "Connected. Say hi 👋";
      for (const p of msg.peers || []) {
        const peer = createPeer(p.id, p.name, p.color, p.x, p.y, /*polite=*/false);
        await makeOffer(peer);
      }
      updateRoster();
      break;

    case "peer-join":
      if (msg.peer && !peers.has(msg.peer.id)) {
        createPeer(msg.peer.id, msg.peer.name, msg.peer.color, msg.peer.x, msg.peer.y, /*polite=*/true);
        updateRoster();
      }
      break;

    case "peer-leave":
      removePeer(msg.id);
      updateRoster();
      break;

    case "peer-move": {
      const peer = peers.get(msg.id);
      if (peer) { peer.x = msg.x; peer.y = msg.y; }
      break;
    }

    case "peer-profile": {
      const peer = peers.get(msg.id);
      if (peer) {
        if (msg.name) { peer.name = msg.name; if (peer.els) peer.els.nameEl.textContent = msg.name; }
        if (msg.color) { peer.color = msg.color; if (peer.els) peer.els.swatch.style.background = msg.color; }
      }
      break;
    }

    case "signal":
      await onPeerSignal(msg.from, msg.data);
      break;

    case "room-full":
      banner.textContent = "The room is full (6 people). Try again later.";
      teardown();
      break;

    case "error":
      console.warn("signal error:", msg.msg);
      break;
  }
}

async function onPeerSignal(fromId, data) {
  if (!data) return;
  let peer = peers.get(fromId);

  if (data.kind === "offer") {
    if (!peer) peer = createPeer(fromId, fromId, PALETTE[0], spawnPoint.x, spawnPoint.y, /*polite=*/true);
    await peer.pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
    await flushPending(peer);
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    send({ type: "signal", to: fromId, data: { kind: "answer", sdp: answer.sdp } });
  } else if (data.kind === "answer") {
    if (peer) {
      await peer.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
      await flushPending(peer);
    }
  } else if (data.kind === "candidate") {
    if (!peer) return;
    const cand = data.candidate;
    if (peer.pc.remoteDescription && peer.pc.remoteDescription.type) {
      try { await peer.pc.addIceCandidate(cand); } catch (e) {}
    } else {
      peer.pending.push(cand);
    }
  }
}

async function flushPending(peer) {
  while (peer.pending.length) {
    const cand = peer.pending.shift();
    try { await peer.pc.addIceCandidate(cand); } catch (e) {}
  }
}

// --- peer connections -------------------------------------------------------
function createPeer(id, name, color, x, y, polite) {
  if (peers.has(id)) return peers.get(id);

  const pc = new RTCPeerConnection({ iceServers });
  const peer = {
    id, name, color, polite,
    x: typeof x === "number" ? x : spawnPoint.x,
    y: typeof y === "number" ? y : spawnPoint.y,
    pc, gain: null, volumeMult: 1, audioEl: null, analyser: null, speaking: false,
    pending: [], els: null,
  };
  peers.set(id, peer);

  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream);
  }

  pc.addEventListener("icecandidate", (e) => {
    if (e.candidate) {
      send({ type: "signal", to: id, data: { kind: "candidate", candidate: e.candidate.toJSON() } });
    }
  });

  pc.addEventListener("track", (e) => {
    attachRemoteAudio(peer, e.streams[0] || new MediaStream([e.track]));
  });

  renderPeerVolumeRow(peer);
  return peer;
}

async function makeOffer(peer) {
  const offer = await peer.pc.createOffer();
  await peer.pc.setLocalDescription(offer);
  send({ type: "signal", to: peer.id, data: { kind: "offer", sdp: offer.sdp } });
}

// Route a remote stream through a per-peer GainNode driven by spatial gain
// (distance + line-of-sight) times that peer's volume slider. Also sunk to a
// muted <audio> element — some browsers won't pull audio through Web Audio
// for a WebRTC stream unless it's also attached to a media element.
function attachRemoteAudio(peer, stream) {
  if (peer.audioEl) return;

  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  audioEl.muted = true;
  audioEl.srcObject = stream;
  audioEl.play().catch(() => {});
  document.body.appendChild(audioEl);
  peer.audioEl = audioEl;

  const src = audioCtx.createMediaStreamSource(stream);
  const gain = audioCtx.createGain();
  gain.gain.value = 0;
  src.connect(gain);
  gain.connect(audioCtx.destination);
  peer.gain = gain;

  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  src.connect(analyser);
  peer.analyser = analyser;
  peer.analyserBuf = new Uint8Array(analyser.frequencyBinCount);
}

function removePeer(id) {
  const peer = peers.get(id);
  if (!peer) return;
  try { peer.pc.close(); } catch (e) {}
  if (peer.audioEl) { peer.audioEl.srcObject = null; peer.audioEl.remove(); }
  if (peer.els && peer.els.row) peer.els.row.remove();
  peers.delete(id);
}

// --- settings drawer: per-peer volume rows ----------------------------------
function renderPeerVolumeRow(peer) {
  const row = document.createElement("div");
  row.className = "peer-vol-row";
  row.innerHTML = `
    <span class="color-swatch small"></span>
    <span class="peer-vol-name"></span>
    <input type="range" class="vol-slider" min="0" max="200" step="1" value="100"
           aria-label="Volume for this person">
    <span class="vol-val">100%</span>`;
  const swatch = row.querySelector(".color-swatch");
  const nameEl = row.querySelector(".peer-vol-name");
  const slider = row.querySelector(".vol-slider");
  const valEl = row.querySelector(".vol-val");
  swatch.style.background = peer.color;
  nameEl.textContent = peer.name;

  slider.addEventListener("input", () => {
    valEl.textContent = slider.value + "%";
    peer.volumeMult = slider.value / 100;
  });

  peerVolumeList.appendChild(row);
  peer.els = { row, swatch, nameEl, slider, valEl };
}

function updateRoster() {
  const n = peers.size;
  if (n === 0) {
    banner.textContent = "You're the only one here. Share the link!";
  } else {
    banner.textContent = `In the house: you + ${n} ${n === 1 ? "other" : "others"}.`;
  }
}

// --- camera & canvas input ----------------------------------------------------
// A fixed zoom (CSS pixels per world unit) rather than fitting the whole
// world into the viewport — the house is bigger than any single screen, so a
// camera follows the player around it instead.
const PX_PER_UNIT = 0.4;
let canvasScale = 1, canvasOffsetX = 0, canvasOffsetY = 0;
const camera = { x: spawnPoint.x, y: spawnPoint.y };
const CAMERA_LERP = 6; // higher = snappier follow

function fitCanvas() {
  const rect = canvasWrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  canvas.style.width = rect.width + "px";
  canvas.style.height = rect.height + "px";
  canvasScale = PX_PER_UNIT * dpr;
}
window.addEventListener("resize", fitCanvas);
fitCanvas();

// Moves the camera toward the target point (the player once joined, the
// spawn point beforehand) and keeps the viewport inside the world so you
// never see past its edges.
function updateCamera(dt) {
  const target = hasJoined ? selfPos : spawnPoint;
  const t = 1 - Math.exp(-CAMERA_LERP * dt);
  camera.x += (target.x - camera.x) * t;
  camera.y += (target.y - camera.y) * t;

  const halfViewW = canvas.width / canvasScale / 2;
  const halfViewH = canvas.height / canvasScale / 2;
  camera.x = WORLD_W <= halfViewW * 2 ? WORLD_W / 2 : clamp(camera.x, halfViewW, WORLD_W - halfViewW);
  camera.y = WORLD_H <= halfViewH * 2 ? WORLD_H / 2 : clamp(camera.y, halfViewH, WORLD_H - halfViewH);

  canvasOffsetX = canvas.width / 2 - camera.x * canvasScale;
  canvasOffsetY = canvas.height / 2 - camera.y * canvasScale;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function clientToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cx = (clientX - rect.left) * dpr;
  const cy = (clientY - rect.top) * dpr;
  return {
    x: (cx - canvasOffsetX) / canvasScale,
    y: (cy - canvasOffsetY) / canvasScale,
  };
}

let lastPickAt = 0;
let lastPickTarget = null;

function setupCanvasInput() {
  canvas.style.touchAction = "none";
  let pointerDown = false;

  const pick = (e) => {
    const { x, y } = clientToWorld(e.clientX, e.clientY);
    if (x < 0 || y < 0 || x > WORLD_W || y > WORLD_H) return;

    // Throttle pathfinding during a drag: recompute only when the pointer
    // has moved meaningfully or enough time has passed, not on every event.
    const now = performance.now();
    if (lastPickTarget) {
      const moved = Math.hypot(x - lastPickTarget.x, y - lastPickTarget.y) > 20 * SCALE;
      if (!moved && now - lastPickAt < 120) return;
    }
    lastPickAt = now;
    lastPickTarget = { x, y };

    const path = findPath(selfPos, { x, y });
    if (path && path.length) movePath = path;
  };

  canvas.addEventListener("pointerdown", (e) => {
    pointerDown = true;
    canvas.setPointerCapture(e.pointerId);
    pick(e);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pointerDown) pick(e);
  });
  canvas.addEventListener("pointerup", () => { pointerDown = false; });
  canvas.addEventListener("pointercancel", () => { pointerDown = false; });
}

let lastTick = 0;
function tick(ts) {
  if (!lastTick) lastTick = ts;
  const dt = Math.min(0.1, (ts - lastTick) / 1000);
  lastTick = ts;

  if (hasJoined) {
    stepMovement(dt);
    updateGains();
    updateSpeakingIndicators();
  }
  updateCamera(dt);
  draw();

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function stepMovement(dt) {
  let budget = MOVE_SPEED * dt;
  // Consume the frame's movement budget across as many waypoints as needed
  // (a waypoint is usually well under one frame's travel distance) so the
  // walk doesn't stall for a tick at each corner of the path.
  while (budget > 0 && movePath.length) {
    const wp = movePath[0];
    const dx = wp.x - selfPos.x, dy = wp.y - selfPos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2 * SCALE) {
      movePath.shift();
      continue;
    }
    const step = Math.min(dist, budget);
    selfPos.x += (dx / dist) * step;
    selfPos.y += (dy / dist) * step;
    budget -= step;
    if (step >= dist) movePath.shift();
  }
  const resolved = resolveCollision(selfPos.x, selfPos.y);
  selfPos.x = resolved.x;
  selfPos.y = resolved.y;

  const now = performance.now();
  const moved = Math.hypot(selfPos.x - lastMoveSentPos.x, selfPos.y - lastMoveSentPos.y) > 1 * SCALE;
  if (moved && now - lastMoveSend > 80) {
    lastMoveSend = now;
    lastMoveSentPos = { x: selfPos.x, y: selfPos.y };
    send({ type: "move", x: selfPos.x, y: selfPos.y });
  }
}

function updateGains() {
  for (const peer of peers.values()) {
    if (!peer.gain) continue;
    const dist = Math.hypot(peer.x - selfPos.x, peer.y - selfPos.y);
    const los = hasLineOfSight(selfPos.x, selfPos.y, peer.x, peer.y);
    const target = spatialGain(dist, los) * peer.volumeMult;
    peer.gain.gain.setTargetAtTime(target, audioCtx.currentTime, 0.05);
  }
}

function updateSpeakingIndicators() {
  for (const peer of peers.values()) {
    if (!peer.analyser) continue;
    peer.analyser.getByteFrequencyData(peer.analyserBuf);
    let sum = 0;
    for (let i = 0; i < peer.analyserBuf.length; i++) sum += peer.analyserBuf[i];
    peer.speaking = sum / peer.analyserBuf.length > 12;
  }
}

// --- rendering ----------------------------------------------------------------
function draw() {
  const w = canvas.width, h = canvas.height;
  ctx2d.save();
  ctx2d.clearRect(0, 0, w, h);
  ctx2d.fillStyle = getCss("--bgColor-default") || "#0d1117";
  ctx2d.fillRect(0, 0, w, h);

  ctx2d.translate(canvasOffsetX, canvasOffsetY);
  ctx2d.scale(canvasScale, canvasScale);

  drawRooms();
  drawWalls();
  if (hasJoined) drawReachRing();
  drawPlayers();

  ctx2d.restore();
}

function getCss(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

function drawRooms() {
  const floor = getCss("--bgColor-elevated") || "#161b22";
  const border = getCss("--borderColor-default") || "#30363d";
  const label = getCss("--fgColor-muted") || "#8b949e";
  const accent = getCss("--accent-strong") || "#5b8def";

  for (const room of rooms) {
    const [x1, y1, x2, y2] = room.rect;
    ctx2d.fillStyle = floor;
    ctx2d.strokeStyle = border;
    ctx2d.lineWidth = 2 * SCALE;
    roundRect(x1, y1, x2 - x1, y2 - y1, 14 * SCALE);
    ctx2d.fill();
    ctx2d.stroke();

    ctx2d.fillStyle = label;
    ctx2d.font = `600 ${15 * SCALE}px system-ui, sans-serif`;
    ctx2d.textBaseline = "top";
    ctx2d.fillText(room.label, x1 + 14 * SCALE, y1 + 12 * SCALE);

    if (room.table) {
      ctx2d.fillStyle = "#8a5a34";
      ctx2d.beginPath();
      ctx2d.arc(room.table.cx, room.table.cy, room.table.r, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.strokeStyle = "#6b4426";
      ctx2d.lineWidth = 3 * SCALE;
      ctx2d.stroke();
    }
    if (room.tv) {
      ctx2d.fillStyle = "#111418";
      ctx2d.strokeStyle = accent;
      ctx2d.lineWidth = 2 * SCALE;
      ctx2d.fillRect(room.tv.x, room.tv.y, room.tv.w, room.tv.h);
      ctx2d.strokeRect(room.tv.x, room.tv.y, room.tv.w, room.tv.h);
    }
  }
}

function roundRect(x, y, w, h, r) {
  ctx2d.beginPath();
  ctx2d.moveTo(x + r, y);
  ctx2d.arcTo(x + w, y, x + w, y + h, r);
  ctx2d.arcTo(x + w, y + h, x, y + h, r);
  ctx2d.arcTo(x, y + h, x, y, r);
  ctx2d.arcTo(x, y, x + w, y, r);
  ctx2d.closePath();
}

function drawWalls() {
  ctx2d.strokeStyle = getCss("--fgColor-default") || "#e6edf3";
  ctx2d.lineWidth = 6 * SCALE;
  ctx2d.lineCap = "round";
  for (const w of walls) {
    ctx2d.beginPath();
    ctx2d.moveTo(w.x1, w.y1);
    ctx2d.lineTo(w.x2, w.y2);
    ctx2d.stroke();
  }
}

// A faint dashed ring hinting at your muffled reach (the max distance anyone
// could hear you at all, even through a wall).
function drawReachRing() {
  ctx2d.save();
  ctx2d.strokeStyle = "rgba(120,150,255,0.28)";
  ctx2d.setLineDash([6 * SCALE, 8 * SCALE]);
  ctx2d.lineWidth = 2 * SCALE;
  ctx2d.beginPath();
  ctx2d.arc(selfPos.x, selfPos.y, LOS_SILENCE_R, 0, Math.PI * 2);
  ctx2d.stroke();
  ctx2d.restore();
}

function drawPlayers() {
  for (const peer of peers.values()) {
    drawPlayer(peer.x, peer.y, peer.color, peer.name, peer.speaking, false);
  }
  if (hasJoined) {
    drawPlayer(selfPos.x, selfPos.y, selfColor, selfName || "You", isSelfSpeaking(), true);
  }
}

function drawPlayer(x, y, color, name, speaking, isSelf) {
  if (speaking) {
    ctx2d.beginPath();
    ctx2d.arc(x, y, PLAYER_RADIUS + 6 * SCALE, 0, Math.PI * 2);
    ctx2d.strokeStyle = "#3ec46d";
    ctx2d.lineWidth = 3 * SCALE;
    ctx2d.stroke();
  }

  ctx2d.beginPath();
  ctx2d.arc(x, y, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx2d.fillStyle = color;
  ctx2d.fill();
  ctx2d.strokeStyle = isSelf ? "#ffffff" : "rgba(0,0,0,0.35)";
  ctx2d.lineWidth = (isSelf ? 3 : 2) * SCALE;
  ctx2d.stroke();

  ctx2d.font = `700 ${13 * SCALE}px system-ui, sans-serif`;
  ctx2d.textAlign = "center";
  ctx2d.textBaseline = "bottom";
  ctx2d.lineWidth = 3 * SCALE;
  ctx2d.strokeStyle = "rgba(0,0,0,0.65)";
  ctx2d.strokeText(name, x, y - PLAYER_RADIUS - 6 * SCALE);
  ctx2d.fillStyle = "#fff";
  ctx2d.fillText(name, x, y - PLAYER_RADIUS - 6 * SCALE);
  ctx2d.textAlign = "left";
}

let selfAnalyser = null;
let selfAnalyserBuf = null;
function isSelfSpeaking() {
  if (!selfAnalyser || muted) return false;
  selfAnalyser.getByteFrequencyData(selfAnalyserBuf);
  let sum = 0;
  for (let i = 0; i < selfAnalyserBuf.length; i++) sum += selfAnalyserBuf[i];
  return sum / selfAnalyserBuf.length > 12;
}

// --- local mic --------------------------------------------------------------
function setupLocalMeter() {
  const src = audioCtx.createMediaStreamSource(localStream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  src.connect(analyser); // NOT connected to destination — avoids hearing yourself
  selfAnalyser = analyser;
  selfAnalyserBuf = new Uint8Array(analyser.frequencyBinCount);
  const buf = selfAnalyserBuf;
  const meterTick = () => {
    analyser.getByteFrequencyData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i];
    const level = muted ? 0 : Math.min(100, (sum / buf.length) * 1.5);
    selfLevelBar.style.width = level + "%";
    requestAnimationFrame(meterTick);
  };
  meterTick();
}

function toggleMute() {
  muted = !muted;
  for (const track of localStream.getAudioTracks()) track.enabled = !muted;
  btnMute.textContent = muted ? "Unmute" : "Mute";
  btnMute.setAttribute("aria-pressed", String(muted));
  btnMute.classList.toggle("muted", muted);
}

// --- teardown ---------------------------------------------------------------
function onDisconnected() {
  banner.textContent = "Disconnected. Reload to rejoin.";
  teardown();
}

function teardown() {
  for (const id of [...peers.keys()]) removePeer(id);
  if (ws) { try { ws.close(); } catch (e) {} ws = null; }
}

window.addEventListener("beforeunload", () => {
  if (ws && ws.readyState === WebSocket.OPEN) send({ type: "leave" });
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
});

// --- helpers ----------------------------------------------------------------
function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function showNameError(t) { nameError.textContent = t; nameError.classList.remove("hidden"); }
function hideNameError() { nameError.classList.add("hidden"); }
