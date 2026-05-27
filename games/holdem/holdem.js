import { API_BASE } from "/utils.js";

const ID_KEY = "dmj-player-id";
const NAME_KEY = "dmj-holdem-name";

// --- identity ---------------------------------------------------------------
let playerId = localStorage.getItem(ID_KEY);
if (!playerId) {
    playerId = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random())
        .replace(/-/g, "").slice(0, 16);
    localStorage.setItem(ID_KEY, playerId);
}
let playerName = localStorage.getItem(NAME_KEY) || "";

const PHASE_LABELS = {
    WAITING: "Waiting for players…",
    BET_PREFLOP: "Pre-flop betting",
    BET_FLOP: "Flop betting",
    BET_TURN: "Turn betting",
    BET_RIVER: "River betting",
    SHOWDOWN: "Showdown",
};

// --- API helpers ------------------------------------------------------------
function api(path, method = "GET", body = null) {
    const opts = { method, headers: { "X-Player-ID": playerId } };
    if (body) {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
    }
    return fetch(API_BASE + path, opts);
}

async function join() {
    const r = await api("/holdem/join", "POST", { name: playerName });
    const data = await r.json();
    if (data.playerId) {
        playerId = data.playerId;
        localStorage.setItem(ID_KEY, playerId);
    }
}

function leave() {
    // Use sendBeacon-friendly fetch with keepalive so it fires on unload.
    fetch(API_BASE + "/holdem/leave", {
        method: "POST",
        headers: { "X-Player-ID": playerId },
        keepalive: true,
    });
}

// --- name prompt ------------------------------------------------------------
const nameOverlay = document.getElementById("name-overlay");
const nameInput = document.getElementById("name-input");

function promptForName() {
    return new Promise((resolve) => {
        nameOverlay.classList.remove("hidden");
        nameInput.focus();
        const submit = () => {
            const v = nameInput.value.trim();
            if (!v) return;
            initAudio(); // unlock audio on this user gesture
            playerName = v.slice(0, 16);
            localStorage.setItem(NAME_KEY, playerName);
            nameOverlay.classList.add("hidden");
            resolve();
        };
        document.getElementById("name-submit").onclick = submit;
        nameInput.onkeydown = (e) => { if (e.key === "Enter") submit(); };
    });
}

// --- rendering --------------------------------------------------------------
const seatsEl = document.getElementById("seats");
const communityEl = document.getElementById("community");
const potEl = document.getElementById("pot-display");
const boardMsgEl = document.getElementById("board-msg");
const bannerEl = document.getElementById("status-banner");
const holeEl = document.getElementById("your-hole");

function tileHTML(t, extraClass = "") {
    if (!t) return "";
    if (t.blank) {
        return `<span class="tile blank ${extraClass}"><span class="tile-letter">★</span></span>`;
    }
    return `<span class="tile ${extraClass}"><span class="tile-letter">${t.letter}</span><span class="tile-pts">${t.points}</span></span>`;
}

// Position seats evenly around the oval table.
function seatPosition(index, total) {
    // Spread `total` seats around an ellipse, starting at the bottom (you-ish).
    const angle = (Math.PI / 2) + (2 * Math.PI * index) / total;
    const cx = 50, cy = 50, rx = 46, ry = 42;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    return { x, y };
}

// --- sound effects (synthesized with the Web Audio API) ---------------------
let audioCtx = null;
function initAudio() {
    if (!audioCtx) {
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { audioCtx = null; }
    }
    // Browsers start the context suspended until a user gesture resumes it.
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
}

// A short pitched blip with an attack/decay envelope.
function tone(freq, startOffset, dur, type = "sine", gain = 0.18) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + startOffset;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
}

// A filtered noise burst — used for the "card slide" deal sound.
function noiseBurst(startOffset, dur, gain = 0.12, freq = 2400) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + startOffset;
    const len = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const bp = audioCtx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(audioCtx.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
}

const sfx = {
    check() { // table knock — two soft low thuds
        tone(170, 0, 0.07, "square", 0.16);
        tone(150, 0.13, 0.07, "square", 0.16);
    },
    call() { // single bright chip clink
        tone(700, 0, 0.10, "sine", 0.2);
        tone(950, 0.02, 0.08, "sine", 0.12);
    },
    raise() { // assertive rising two-tone
        tone(523, 0, 0.10, "triangle", 0.22);
        tone(784, 0.10, 0.18, "triangle", 0.22);
    },
    fold() { // soft descending tone
        tone(320, 0, 0.12, "sine", 0.16);
        tone(200, 0.10, 0.18, "sine", 0.16);
    },
    deal() { // quick card-slide swishes
        noiseBurst(0, 0.06, 0.12, 2600);
        noiseBurst(0.08, 0.06, 0.10, 2300);
    },
};

function playSfx(type) {
    if (!audioCtx) return;
    (sfx[type] || (() => {}))();
}

// Event sequence trackers (null until the first state arrives, so we don't
// play a burst of sounds on initial page load).
let lastActionSeq = null;
let lastDealSeq = null;

function handleSoundEvents(st) {
    if (st.dealSeq !== undefined) {
        if (lastDealSeq === null) lastDealSeq = st.dealSeq;
        else if (st.dealSeq > lastDealSeq) { lastDealSeq = st.dealSeq; playSfx("deal"); }
    }
    if (st.actionSeq !== undefined) {
        if (lastActionSeq === null) lastActionSeq = st.actionSeq;
        else if (st.actionSeq > lastActionSeq) {
            lastActionSeq = st.actionSeq;
            playSfx(st.lastActionType);
        }
    }
}

let lastResultMsg = null;

function render(st) {
    handleSoundEvents(st);

    // Banner / queue status.
    let banner = PHASE_LABELS[st.phase] || st.phase;
    if (!st.seated && st.joined) {
        banner = st.queuePos > 0
            ? `You're #${st.queuePos} in the queue — you'll be seated when a spot opens.`
            : "Spectating — waiting for a seat.";
    } else if (st.queueLen > 0) {
        banner += ` · ${st.queueLen} waiting`;
    }
    bannerEl.textContent = banner;

    // Seats.
    seatsEl.innerHTML = "";
    const seated = st.seats || [];
    const total = Math.max(seated.length, 2);
    seated.forEach((s, i) => {
        const pos = seatPosition(i, total);
        const el = document.createElement("div");
        el.className = "seat" +
            (s.isTurn ? " acting" : "") +
            (s.folded ? " folded" : "") +
            (s.isYou ? " you" : "") +
            (!s.inHand ? " sitting-out" : "");
        el.style.left = pos.x + "%";
        el.style.top = pos.y + "%";

        const holeMini = (s.hole && s.hole.length)
            ? `<div class="seat-hole">${s.hole.map(t => tileHTML(t, "mini")).join("")}</div>`
            : (s.inHand && st.phase !== "WAITING"
                ? `<div class="seat-hole">${tileHTML({ blank: false, letter: "", points: "" }, "mini back")}${tileHTML({}, "mini back")}${tileHTML({}, "mini back")}</div>`
                : "");

        el.innerHTML = `
            ${s.isButton ? '<span class="dealer-btn">D</span>' : ""}
            <div class="seat-name">${escapeHTML(s.name)}</div>
            <div class="seat-chips">${s.chips} chips</div>
            ${s.bet > 0 ? `<div class="seat-bet">bet ${s.bet}</div>` : ""}
            ${s.allIn ? '<div class="seat-tag">ALL IN</div>' : ""}
            ${s.folded ? '<div class="seat-tag">folded</div>' : ""}
            ${holeMini}
        `;
        seatsEl.appendChild(el);
    });

    // Pot + community.
    potEl.textContent = st.pot > 0 ? `Pot: ${st.pot}` : "";
    communityEl.innerHTML = (st.community || []).map(t => tileHTML(t)).join("");

    // Board message (showdown result).
    if (st.phase === "SHOWDOWN" && st.result) {
        boardMsgEl.textContent = st.result.winnerMsg || "";
        if (st.result.winnerMsg !== lastResultMsg) {
            lastResultMsg = st.result.winnerMsg;
        }
    } else {
        boardMsgEl.textContent = "";
        lastResultMsg = null;
    }

    // Your hole tiles + current best word.
    const you = seated.find(s => s.isYou);
    if (you && you.hole && you.hole.length) {
        const best = st.yourBestWord
            ? `<div class="best-word">Best play: <strong>${escapeHTML(st.yourBestWord)}</strong> <span class="best-score">${st.yourBestScore} pts</span></div>`
            : `<div class="best-word best-none">No word yet</div>`;
        holeEl.innerHTML =
            `<div class="hole-label">Your tiles</div>` +
            `<div class="hole-tiles">${you.hole.map(t => tileHTML(t, "big")).join("")}</div>` +
            best;
    } else {
        holeEl.innerHTML = "";
    }

    renderActions(st);
}

// --- action controls --------------------------------------------------------
const actionBar = document.getElementById("action-bar");
const btnFold = document.getElementById("btn-fold");
const btnCheck = document.getElementById("btn-check");
const btnCall = document.getElementById("btn-call");
const btnRaise = document.getElementById("btn-raise");
const raiseSlider = document.getElementById("raise-slider");
const raiseAmount = document.getElementById("raise-amount");
const raiseGroup = document.getElementById("raise-group");
const timerWrap = document.getElementById("turn-timer");
const timerBar = document.getElementById("turn-timer-bar");

function renderActions(st) {
    if (!st.yourTurn) {
        actionBar.classList.add("hidden");
        timerWrap.classList.add("hidden");
        return;
    }
    actionBar.classList.remove("hidden");

    const toCall = st.toCall || 0;
    // Check vs Call.
    if (toCall > 0) {
        btnCheck.classList.add("hidden");
        btnCall.classList.remove("hidden");
        btnCall.textContent = `Call ${toCall}`;
    } else {
        btnCheck.classList.remove("hidden");
        btnCall.classList.add("hidden");
    }

    // Raise slider: from (currentBet + minRaise) up to maxBet (your bet + chips).
    const minTotal = Math.min(st.currentBet + st.minRaise, st.maxBet);
    const maxTotal = st.maxBet;
    if (maxTotal > st.currentBet) {
        raiseGroup.classList.remove("hidden");
        raiseSlider.min = minTotal;
        raiseSlider.max = maxTotal;
        raiseSlider.step = 10;
        if (+raiseSlider.value < minTotal || +raiseSlider.value > maxTotal) {
            raiseSlider.value = minTotal;
        }
        raiseAmount.textContent = raiseSlider.value;
        btnRaise.textContent = toCall > 0 ? "Raise" : "Bet";
    } else {
        raiseGroup.classList.add("hidden");
    }

    // Timer bar.
    if (st.timeLeftMs > 0) {
        timerWrap.classList.remove("hidden");
        const pct = Math.max(0, Math.min(100, (st.timeLeftMs / 25000) * 100));
        timerBar.style.width = pct + "%";
    } else {
        timerWrap.classList.add("hidden");
    }
}

raiseSlider.addEventListener("input", () => { raiseAmount.textContent = raiseSlider.value; });

async function sendAction(action, amount = 0) {
    initAudio(); // unlock/keep audio alive on this user gesture
    actionBar.classList.add("hidden"); // optimistic hide to prevent double-click
    try {
        const r = await api("/holdem/action", "POST", { action, amount });
        if (!r.ok) {
            const msg = await r.text();
            console.warn("action rejected:", msg);
        }
    } catch (e) {
        console.error(e);
    }
    poll(); // refresh immediately
}

btnFold.onclick = () => sendAction("fold");
btnCheck.onclick = () => sendAction("check");
btnCall.onclick = () => sendAction("call");
btnRaise.onclick = () => sendAction("raise", +raiseSlider.value);

// --- util -------------------------------------------------------------------
function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

// --- poll loop --------------------------------------------------------------
let polling = false;
async function poll() {
    if (polling) return;
    polling = true;
    try {
        const r = await api("/holdem/state");
        if (r.ok) render(await r.json());
    } catch (e) {
        bannerEl.textContent = "Connection lost — retrying…";
    } finally {
        polling = false;
    }
}

window.addEventListener("beforeunload", leave);

// Unlock audio on the first interaction (covers returning players who skip the
// name prompt). Browsers block audio until a user gesture occurs.
["click", "keydown", "touchstart"].forEach(ev =>
    window.addEventListener(ev, initAudio, { once: true }));

// --- boot -------------------------------------------------------------------
(async function boot() {
    if (!playerName) await promptForName();
    await join();
    poll();
    setInterval(poll, 1000);
})();
