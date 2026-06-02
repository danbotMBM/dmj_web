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
const world = { w: 900, h: 540, full: 110, silence: 430 };
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
    me.x = clamp(me.x + vx * inv * MOVE_SPEED * dt, 0, world.w);
    me.y = clamp(me.y + vy * inv * MOVE_SPEED * dt, 0, world.h);
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

  // Our own audible range: full-volume bubble + outer silence radius.
  ctx2d.save();
  ctx2d.beginPath();
  ctx2d.arc(me.x, me.y, world.silence, 0, Math.PI * 2);
  ctx2d.fillStyle = "rgba(111,155,209,0.06)";
  ctx2d.fill();
  ctx2d.beginPath();
  ctx2d.arc(me.x, me.y, world.full, 0, Math.PI * 2);
  ctx2d.fillStyle = "rgba(111,155,209,0.10)";
  ctx2d.fill();
  ctx2d.setLineDash([6, 6]);
  ctx2d.strokeStyle = "rgba(111,155,209,0.35)";
  ctx2d.beginPath();
  ctx2d.arc(me.x, me.y, world.silence, 0, Math.PI * 2);
  ctx2d.stroke();
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

// proximityGainLocal mirrors the server's smoothstep falloff for visuals only.
function proximityGainLocal(ax, ay, bx, by) {
  const d = Math.hypot(ax - bx, ay - by);
  if (d <= world.full) return 1;
  if (d >= world.silence) return 0;
  const t = (d - world.full) / (world.silence - world.full);
  return 1 - t * t * (3 - 2 * t);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function setStatus(text, kind) {
  statusBanner.textContent = text;
  statusBanner.className = "status-banner " + (kind || "");
}

window.addEventListener("beforeunload", () => {
  if (ws) ws.close();
});
