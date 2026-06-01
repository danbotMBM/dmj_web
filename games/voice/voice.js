// Voice chat client.
//
// Captures the mic at 16 kHz, voice-activity-gates it in an AudioWorklet, and
// streams 20 ms int16 PCM frames to the Go mixer over a WebSocket. The server
// mixes a personalized stream per listener (applying our per-speaker volume
// sliders) and streams one mixed frame back, which we play through a second
// worklet. See games/voice/voice-worklet.js and backend/voice.go.

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
      break;
    case "roster":
      roster = msg.players;
      renderParticipants();
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
      // Per-user volume slider — drives a server-side gain applied before the
      // mix, so it's authoritative and proximity-ready.
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

function setStatus(text, kind) {
  statusBanner.textContent = text;
  statusBanner.className = "status-banner " + (kind || "");
}

window.addEventListener("beforeunload", () => {
  if (ws) ws.close();
});
