import { API_BASE } from "/utils.js";

// ---------------------------------------------------------------------------
// Voice Room client — a WebRTC mesh coordinated by the Go signaling server.
//
// Each remote participant gets their own RTCPeerConnection (a full mesh, fine
// for <=6 people). The server only relays SDP/ICE; audio is peer-to-peer.
//
// Volume model: every remote stream is routed through a Web Audio GainNode whose
// value is driven by that peer's slider. Gain is applied locally per listener —
// the building block for proximity chat, where the same gain will later be a
// function of distance instead of a manual slider.
//
// Negotiation is glare-free by convention: when you join you receive the list of
// peers already present and send an offer to each of them. Anyone who joins
// after you will, in turn, offer to you. So you only ever *initiate* toward
// peers that predate you, and only ever *answer* peers that arrive later.
// ---------------------------------------------------------------------------

const NAME_KEY = "dmj-voice-name";

// --- elements ---------------------------------------------------------------
const banner = document.getElementById("status-banner");
const peersEl = document.getElementById("peers");
const selfBar = document.getElementById("self-bar");
const selfNameEl = document.getElementById("self-name");
const selfLevelBar = document.getElementById("self-level-bar");
const btnMute = document.getElementById("btn-mute");
const btnLeave = document.getElementById("btn-leave");
const overlay = document.getElementById("name-overlay");
const nameInput = document.getElementById("name-input");
const nameError = document.getElementById("name-error");
const nameSubmit = document.getElementById("name-submit");

// --- state ------------------------------------------------------------------
let iceServers = [{ urls: ["stun:stun.l.google.com:19302"] }];
let ws = null;
let selfId = null;
let localStream = null;
let audioCtx = null;
let muted = false;
const peers = new Map(); // id -> { name, pc, gain, audioEl, analyser, pending: [], els }

// --- bootstrap --------------------------------------------------------------
nameInput.value = localStorage.getItem(NAME_KEY) || "";

nameSubmit.addEventListener("click", join);
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
btnMute.addEventListener("click", toggleMute);
btnLeave.addEventListener("click", () => location.reload());

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
    localStorage.setItem(NAME_KEY, name);
    nameSubmit.disabled = true;
    hideNameError();

    // Get the mic first; if the user denies it there's no point connecting.
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

    // AudioContext must be created/resumed from a user gesture (this click).
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") { try { await audioCtx.resume(); } catch (e) {} }
    setupLocalMeter();

    selfNameEl.textContent = name;
    overlay.classList.add("hidden");
    selfBar.classList.remove("hidden");

    connectSignaling(name);
}

function connectSignaling(name) {
    banner.textContent = "Connecting…";
    const wsUrl = API_BASE.replace(/^http/, "ws") + "/voice/ws";
    ws = new WebSocket(wsUrl);

    ws.addEventListener("open", () => {
        send({ type: "join", name });
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
            // We are the newcomer: offer to everyone already here.
            for (const p of msg.peers || []) {
                const peer = createPeer(p.id, p.name, /*polite=*/false);
                await makeOffer(peer);
            }
            updateRoster();
            break;

        case "peer-join":
            // Someone arrived after us; they will send us an offer. Just show them.
            if (msg.peer && !peers.has(msg.peer.id)) {
                createPeer(msg.peer.id, msg.peer.name, /*polite=*/true);
                updateRoster();
            }
            break;

        case "peer-leave":
            removePeer(msg.id);
            updateRoster();
            break;

        case "signal":
            await onPeerSignal(msg.from, msg.data);
            break;

        case "room-full":
            banner.textContent = "The room is full (6 people). Try again later.";
            teardown();
            break;

        case "error":
            // Non-fatal; log to console for debugging.
            console.warn("signal error:", msg.msg);
            break;
    }
}

async function onPeerSignal(fromId, data) {
    if (!data) return;
    let peer = peers.get(fromId);

    if (data.kind === "offer") {
        // An incoming offer from a peer that joined after us (or a renegotiation).
        if (!peer) peer = createPeer(fromId, fromId, /*polite=*/true);
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
            peer.pending.push(cand); // buffer until remote description is set
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
function createPeer(id, name, polite) {
    if (peers.has(id)) return peers.get(id);

    const pc = new RTCPeerConnection({ iceServers });
    const peer = { id, name, pc, polite, gain: null, audioEl: null, analyser: null, pending: [], els: null };
    peers.set(id, peer);

    // Send our mic to this peer.
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

    pc.addEventListener("connectionstatechange", () => {
        if (peer.els) {
            peer.els.card.dataset.state = pc.connectionState;
        }
        if (["failed", "closed"].includes(pc.connectionState)) {
            // Leave it to peer-leave / disconnect handling; just reflect state.
        }
    });

    renderPeerCard(peer);
    return peer;
}

async function makeOffer(peer) {
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    send({ type: "signal", to: peer.id, data: { kind: "offer", sdp: offer.sdp } });
}

// Route a remote stream through a per-peer GainNode (the volume slider) and also
// attach it to a muted <audio> element — some browsers won't pull audio through
// Web Audio for a WebRTC stream unless it's also sunk to a media element.
function attachRemoteAudio(peer, stream) {
    if (peer.audioEl) return; // already wired

    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    audioEl.muted = true; // real audio comes out of the Web Audio graph below
    audioEl.srcObject = stream;
    audioEl.play().catch(() => {});
    document.body.appendChild(audioEl);
    peer.audioEl = audioEl;

    const src = audioCtx.createMediaStreamSource(stream);
    const gain = audioCtx.createGain();
    gain.gain.value = peer.els ? peer.els.slider.value / 100 : 1;
    src.connect(gain);
    gain.connect(audioCtx.destination);
    peer.gain = gain;

    // Analyser for the speaking indicator (not connected to output).
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    peer.analyser = analyser;
    startSpeakingIndicator(peer);
}

function removePeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    try { peer.pc.close(); } catch (e) {}
    if (peer.audioEl) { peer.audioEl.srcObject = null; peer.audioEl.remove(); }
    if (peer.els && peer.els.card) peer.els.card.remove();
    peers.delete(id);
}

// --- UI ---------------------------------------------------------------------
function renderPeerCard(peer) {
    const card = document.createElement("div");
    card.className = "peer-card";
    card.dataset.state = "connecting";
    card.innerHTML = `
        <div class="peer-head">
            <span class="speaking-dot"></span>
            <span class="peer-name"></span>
        </div>
        <div class="vol-row">
            <span class="vol-icon">🔊</span>
            <input type="range" class="vol-slider" min="0" max="200" step="1" value="100"
                   aria-label="Volume for this person">
            <span class="vol-val">100%</span>
        </div>`;
    const nameEl = card.querySelector(".peer-name");
    const slider = card.querySelector(".vol-slider");
    const valEl = card.querySelector(".vol-val");
    const dot = card.querySelector(".speaking-dot");
    nameEl.textContent = peer.name;

    slider.addEventListener("input", () => {
        valEl.textContent = slider.value + "%";
        if (peer.gain) peer.gain.gain.value = slider.value / 100;
    });

    peersEl.appendChild(card);
    peer.els = { card, slider, valEl, dot };
}

function startSpeakingIndicator(peer) {
    const buf = new Uint8Array(peer.analyser.frequencyBinCount);
    const tick = () => {
        if (!peers.has(peer.id) || !peer.analyser) return;
        peer.analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        const level = sum / buf.length; // 0..255-ish
        if (peer.els) peer.els.dot.classList.toggle("active", level > 12);
        requestAnimationFrame(tick);
    };
    tick();
}

function updateRoster() {
    const n = peers.size;
    if (n === 0) {
        banner.textContent = "You're the only one here. Share the link!";
    } else {
        banner.textContent = `In the room: you + ${n} ${n === 1 ? "other" : "others"}.`;
    }
}

// --- local mic --------------------------------------------------------------
function setupLocalMeter() {
    const src = audioCtx.createMediaStreamSource(localStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser); // NOT connected to destination — avoids hearing yourself
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        const level = muted ? 0 : Math.min(100, (sum / buf.length) * 1.5);
        selfLevelBar.style.width = level + "%";
        requestAnimationFrame(tick);
    };
    tick();
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
    if (!selfId && overlay.classList.contains("hidden")) {
        // Never fully joined.
    }
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
