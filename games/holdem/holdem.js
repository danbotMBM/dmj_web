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
    READY: "Ready to play — press Start game",
    BET_PREFLOP: "Pre-flop betting",
    BET_FLOP: "Flop betting",
    BET_TURN: "Turn betting",
    BET_RIVER: "River betting",
    SHOWDOWN_SUBMIT: "Showdown — submit your best word!",
    SHOWDOWN: "Showdown",
};

// Letter distribution (points + how many of each tile are in the bag), fetched
// once from the server so it isn't duplicated here. LETTER_POINTS is derived
// from it for instant client-side scoring as a word is typed.
let letterSpecs = [];
const LETTER_POINTS = {};
async function loadLetters() {
    try {
        const r = await fetch(API_BASE + "/holdem/letters");
        if (r.ok) {
            letterSpecs = await r.json();
            letterSpecs.forEach(s => { LETTER_POINTS[s.letter] = s.points; });
            renderLetterTable();
        }
    } catch (e) { /* scoring still works via the server on submit */ }
}

// Render the reference table: each letter, its point value, and how many tiles
// of it exist in the bag.
function renderLetterTable() {
    const el = document.getElementById("letter-table");
    if (!el) return;
    el.innerHTML = letterSpecs.map(s => `
        <div class="letter-cell">
            ${tileHTML({ letter: s.letter, points: s.points })}
            <span class="letter-count">×${s.count}</span>
        </div>`).join("");
}

// The accepted word list, fetched once so typing feedback is instant. The server
// still re-validates every submission, so this is purely for UX.
let wordSet = new Set();
async function loadWords() {
    try {
        const r = await fetch(API_BASE + "/holdem/words");
        if (r.ok) {
            const txt = await r.text();
            wordSet = new Set(txt.split(/\s+/).filter(Boolean));
        }
    } catch (e) { /* fall back to server-only validation */ }
}

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
const nameTitle = document.getElementById("name-title");
const nameSubtitle = document.getElementById("name-subtitle");
const nameSubmitBtn = document.getElementById("name-submit");
const nameCancelBtn = document.getElementById("name-cancel");
const nameErrorEl = document.getElementById("name-error");

function showNameError(msg) {
    nameErrorEl.textContent = msg;
    nameErrorEl.classList.remove("hidden");
}
function clearNameError() {
    nameErrorEl.textContent = "";
    nameErrorEl.classList.add("hidden");
}

// mode: "join" (initial entry, no cancel) or "rename" (cancellable, calls /holdem/rename)
function promptForName(mode = "join") {
    return new Promise((resolve) => {
        clearNameError();
        nameInput.value = playerName || "";
        if (mode === "rename") {
            nameTitle.textContent = "Change your name";
            nameSubtitle.textContent = "Pick a new display name.";
            nameSubmitBtn.textContent = "Save";
            nameCancelBtn.classList.remove("hidden");
        } else {
            nameTitle.textContent = "Take a seat";
            nameSubtitle.textContent = "Pick a name to join the table.";
            nameSubmitBtn.textContent = "Join table";
            nameCancelBtn.classList.add("hidden");
        }
        nameOverlay.classList.remove("hidden");
        nameInput.focus();
        nameInput.select();

        const cleanup = () => {
            nameOverlay.classList.add("hidden");
            nameSubmitBtn.onclick = null;
            nameCancelBtn.onclick = null;
            nameInput.onkeydown = null;
        };
        const submit = async () => {
            const v = nameInput.value.trim();
            if (!v) { showNameError("Please enter a name."); return; }
            initAudio(); // unlock audio on this user gesture
            const newName = v.slice(0, 16);
            if (mode === "rename") {
                if (newName === playerName) { cleanup(); resolve(); return; }
                nameSubmitBtn.disabled = true;
                try {
                    const r = await api("/holdem/rename", "POST", { name: newName });
                    if (!r.ok) {
                        showNameError("Couldn't change name — try again.");
                        nameSubmitBtn.disabled = false;
                        return;
                    }
                    const data = await r.json();
                    playerName = data.name || newName;
                } catch (e) {
                    showNameError("Network error — try again.");
                    nameSubmitBtn.disabled = false;
                    return;
                } finally {
                    nameSubmitBtn.disabled = false;
                }
            } else {
                playerName = newName;
            }
            localStorage.setItem(NAME_KEY, playerName);
            cleanup();
            if (mode === "rename") poll(); // refresh immediately so the new name shows
            resolve();
        };
        nameSubmitBtn.onclick = submit;
        nameCancelBtn.onclick = () => { cleanup(); resolve(); };
        nameInput.onkeydown = (e) => {
            if (e.key === "Enter") submit();
            else if (e.key === "Escape" && mode === "rename") { cleanup(); resolve(); }
        };
    });
}

// --- rendering --------------------------------------------------------------
const seatsEl = document.getElementById("seats");
const communityEl = document.getElementById("community");
const potEl = document.getElementById("pot-display");
const boardMsgEl = document.getElementById("board-msg");
const bannerEl = document.getElementById("status-banner");
const holeEl = document.getElementById("your-hole");
const showdownEl = document.getElementById("showdown");
const startArea = document.getElementById("start-area");

function tileHTML(t, extraClass = "") {
    if (!t) return "";
    if (t.blank) {
        return `<span class="tile blank ${extraClass}"><span class="tile-letter">★</span></span>`;
    }
    return `<span class="tile ${extraClass}"><span class="tile-letter">${t.letter}</span><span class="tile-pts">${t.points}</span></span>`;
}

// Render a best play's word(s) as tiles. River-origin tiles get an accent ring.
function playWordsHTML(play, sizeClass = "") {
    if (!play || !play.words || !play.words.length) return "";
    return play.words.map(word =>
        `<span class="play-word">${word.map(t =>
            tileHTML(t, sizeClass + (t.river ? " from-river" : ""))).join("")}</span>`
    ).join(`<span class="play-plus">+</span>`);
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

// Whether the add-CPU difficulty popup is currently expanded at the open seat.
let addMenuOpen = false;
// Most recent state, so UI-only toggles (opening the add menu) can re-render
// without waiting for the next poll.
let lastState = null;

function render(st) {
    lastState = st;
    handleSoundEvents(st);

    // Banner / queue status.
    let banner = PHASE_LABELS[st.phase] || st.phase;
    // During the showdown submit window, nudge a different message if you've
    // already submitted — you can still resubmit a higher-scoring word.
    if (st.phase === "SHOWDOWN_SUBMIT" && st.yourWord) {
        banner = "Showdown — resubmit a better word!";
    }
    if (!st.seated && st.joined) {
        banner = st.queuePos > 0
            ? `You're #${st.queuePos} in the queue — you'll be seated when a spot opens.`
            : "Spectating — waiting for a seat.";
    } else if (st.queueLen > 0) {
        banner += ` · ${st.queueLen} waiting`;
    }
    bannerEl.textContent = banner;

    // Seats. CPU management ("+" to add, "x" to remove) is only available to a
    // seated player while the table is between rounds — mirrors the server's
    // betweenRounds() guard so we don't show controls the server would reject.
    seatsEl.innerHTML = "";
    // Rotate the seating so you're always at the bottom (index 0), while
    // preserving everyone's relative (cyclic) order around the table.
    const rawSeated = st.seats || [];
    const youIdx = rawSeated.findIndex(s => s.isYou);
    const seated = youIdx > 0
        ? rawSeated.slice(youIdx).concat(rawSeated.slice(0, youIdx))
        : rawSeated;
    const betweenRounds = ["WAITING", "READY", "SHOWDOWN"].includes(st.phase);
    const canManage = st.seated && betweenRounds;
    const showAdd = canManage && seated.length < (st.maxSeats || 10);
    if (!showAdd) addMenuOpen = false; // close a stale menu if conditions change

    // The add-CPU placeholder occupies one extra position so seats stay evenly
    // spread around the oval while it's shown.
    const total = Math.max(seated.length + (showAdd ? 1 : 0), 2);
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

        // Any seated human may remove a CPU between rounds.
        const removeBtn = (canManage && s.isCpu)
            ? `<button class="cpu-remove" data-action="remove-cpu" data-seat="${s.seat}" title="Remove this CPU">×</button>`
            : "";

        el.innerHTML = `
            ${removeBtn}
            ${s.isButton ? '<span class="dealer-btn">D</span>' : ""}
            <div class="seat-name${s.isYou ? " seat-name--editable" : ""}"${s.isYou ? ' data-action="rename" title="Click to change your name"' : ""}>${escapeHTML(s.name)}</div>
            <div class="seat-chips">${s.chips} chips</div>
            ${s.bet > 0 ? `<div class="seat-bet">bet ${s.bet}</div>` : ""}
            ${s.allIn ? '<div class="seat-tag">ALL IN</div>' : ""}
            ${s.folded ? '<div class="seat-tag">folded</div>' : ""}
            ${holeMini}
        `;
        seatsEl.appendChild(el);
    });

    // On the mobile carousel layout, keep the acting player centered in the
    // strip. We scroll the #seats container directly (rather than
    // scrollIntoView, which also scrolls ancestors and yanks the viewport).
    if (window.matchMedia("(max-width: 768px)").matches) {
        const actingEl = seatsEl.querySelector(".seat.acting");
        if (actingEl) {
            const target = actingEl.offsetLeft - (seatsEl.clientWidth - actingEl.offsetWidth) / 2;
            seatsEl.scrollTo({ left: target, behavior: "smooth" });
        }
    }

    if (showAdd) {
        const pos = seatPosition(seated.length, total);
        const el = document.createElement("div");
        el.className = "seat seat-add" + (addMenuOpen ? " open" : "");
        el.style.left = pos.x + "%";
        el.style.top = pos.y + "%";
        el.innerHTML = addMenuOpen
            ? `<div class="cpu-add-menu">
                   <div class="cpu-add-title">Add CPU</div>
                   <button class="cpu-diff" data-action="add-cpu" data-diff="low">Easy</button>
                   <button class="cpu-diff" data-action="add-cpu" data-diff="medium">Medium</button>
                   <button class="cpu-diff" data-action="add-cpu" data-diff="high">Hard</button>
               </div>`
            : `<button class="cpu-add-plus" data-action="open-add" title="Add a CPU player">+</button>`;
        seatsEl.appendChild(el);
    }

    // Pot + community. Tiles consumed by your typed/locked word are shaded by
    // updateWordArea() once the board is rendered.
    potEl.textContent = st.pot > 0 ? `Pot: ${st.pot}` : "";
    communityEl.innerHTML = (st.community || []).map((t) => tileHTML(t)).join("");

    // Board message + showdown panel revealing every player's best word. The
    // panel lingers through the READY phase so players can see the last result
    // while deciding to start the next hand.
    if (st.result && (st.phase === "SHOWDOWN" || st.phase === "READY")) {
        boardMsgEl.textContent = st.phase === "SHOWDOWN" ? (st.result.winnerMsg || "") : "";
        lastResultMsg = st.result.winnerMsg;
        renderShowdown(st.result);
    } else {
        boardMsgEl.textContent = "";
        lastResultMsg = null;
        showdownEl.classList.add("hidden");
        showdownEl.innerHTML = "";
    }

    // Start button: any seated player may deal the next hand when ready.
    startArea.classList.toggle("hidden", !st.canStart);

    renderYourArea(st);
    renderActions(st);
}

// --- word composition -------------------------------------------------------
const wordZone = document.getElementById("word-zone");
const wordKept = document.getElementById("word-kept");
const wordPreview = document.getElementById("word-preview");
const wordFeedback = document.getElementById("word-feedback");
const wordInput = document.getElementById("word-input");
const btnSubmitWord = document.getElementById("btn-submit-word");
const submitTimer = document.getElementById("submit-timer");
const submitTimerText = document.getElementById("submit-timer-text");
const submitTimerBar = document.getElementById("submit-timer-bar");

// Signature of your current hole tiles, used to detect a fresh hand and clear
// any half-typed word from the previous one.
let lastHoleSig = null;
let suppressLockedWordPreview = false;

// analyzeWord greedily binds each typed letter to one of your available tiles
// (hole tiles first, then community — matching the server), and reports which
// tiles get used, the score, and whether the word is playable + a real word.
function analyzeWord(raw, hole, community) {
    const letters = (raw || "").toUpperCase().replace(/[^A-Z]/g, "").split("");
    const usedHole = new Set();
    const usedComm = new Set();
    const preview = [];
    let score = 0;
    let formable = true;

    letters.forEach(ch => {
        let bound = false;
        for (let i = 0; i < hole.length; i++) {
            if (!usedHole.has(i) && hole[i].letter === ch) {
                usedHole.add(i);
                preview.push({ letter: ch, points: hole[i].points, river: false });
                score += hole[i].points;
                bound = true;
                break;
            }
        }
        if (!bound) {
            for (let i = 0; i < community.length; i++) {
                if (!usedComm.has(i) && community[i].letter === ch) {
                    usedComm.add(i);
                    preview.push({ letter: ch, points: community[i].points, river: true });
                    score += community[i].points;
                    bound = true;
                    break;
                }
            }
        }
        if (!bound) {
            formable = false;
            preview.push({ letter: ch, points: LETTER_POINTS[ch] ?? 0, missing: true });
        }
    });

    const clean = letters.join("");
    // If the list failed to load, don't block on the dictionary — let the server decide.
    const inDict = wordSet.size === 0 ? true : wordSet.has(clean);
    const valid = clean.length >= 2 && clean.length <= 10 && formable && inDict;
    return { clean, preview, usedHole, usedComm, score, formable, inDict, valid };
}

function renderYourArea(st) {
    const you = (st.seats || []).find(s => s.isYou);
    const hole = (you && you.hole) || [];

    // Detect a new hand (your hole tiles changed) and reset the input.
    const sig = hole.map(t => t.letter).join("");
    if (sig !== lastHoleSig) {
        lastHoleSig = sig;
        wordInput.value = "";
    }

    updateWordArea(st);
}

// updateWordArea renders the hole tiles, the live word preview, validity
// feedback, your locked-in word, and the showdown countdown — and shades the
// tiles (hole + community) used by the word in focus. Safe to call on every poll
// and on every keystroke without disturbing the input field.
function updateWordArea(st) {
    st = st || lastState;
    if (!st) return;
    const you = (st.seats || []).find(s => s.isYou);
    const hole = (you && you.hole) || [];
    const community = st.community || [];

    // The word in focus: what you're typing, or your locked word when idle.
    const typed = wordInput.value;
    const lockedWord = suppressLockedWordPreview ? "" : (st.yourWord || "");
    const focusRaw = typed.trim().length ? typed : lockedWord;
    const focus = analyzeWord(focusRaw, hole, community);

    // "Your tiles" = the full pool you can spell from: your private hole tiles
    // plus the shared community tiles. Hole tiles come first, then community
    // tiles (marked with the river accent ring). Tiles consumed by the word in
    // focus are highlighted in both groups.
    if (hole.length || community.length) {
        const holeHTML = hole.map((t, i) =>
            tileHTML(t, "big" + (focus.usedHole.has(i) ? " used" : ""))).join("");
        const commHTML = community.map((t, i) =>
            tileHTML(t, "big from-river" + (focus.usedComm.has(i) ? " used" : ""))).join("");
        // Subtle divider between your private hole tiles and the shared
        // community tiles, only when both groups are present.
        const sep = hole.length && community.length
            ? `<div class="hole-sep" aria-hidden="true"></div>`
            : "";
        holeEl.innerHTML =
            `<div class="hole-label">Available Tiles</div>` +
            `<div class="hole-tiles">${holeHTML}${sep}${commHTML}</div>`;
    } else {
        holeEl.innerHTML = "";
    }

    // Shade community tiles used by the focus word (on the table board too).
    Array.from(communityEl.children).forEach((el, i) => {
        el.classList.toggle("used", focus.usedComm.has(i));
    });

    // Show the composition zone only while you can submit.
    wordZone.classList.toggle("hidden", !st.canSubmitWord);
    if (st.canSubmitWord) {
        wordKept.innerHTML = st.yourWord
            ? `Submitted: <strong>${escapeHTML(st.yourWord)}</strong> <span class="best-score">${st.yourWordScore} pts</span> — submit a better one to replace it`
            : `<span class="best-none">No word submitted yet</span>`;

        // Live preview of the word currently being typed (or the locked word).
        // The tile block doubles as the input surface, so when nothing is typed
        // blinking caret while the block is focused.
        const caret = wordZone.classList.contains("focused") 
            ? `<span class="word-caret" aria-hidden="true"></span>` : "";
        const show_placeholder = !wordZone.classList.contains("focused");
        const placeholder = show_placeholder ? `<span class="word-placeholder">Tap and type your word…</span>` : "";

        wordPreview.innerHTML = focus.preview.length
            ? focus.preview.map(t => tileHTML(
                { letter: t.letter, points: t.points },
                "big" + (t.river ? " from-river" : "") + (t.missing ? " missing" : ""))).join("") + caret
            : placeholder + caret;

        // Feedback reflects what you've typed (not the idle/locked word).
        const live = typed.trim().length ? analyzeWord(typed, hole, community) : null;
        if (!live) {
            wordFeedback.className = "word-feedback";
            wordFeedback.textContent = " ";
        } else if (live.valid) {
            wordFeedback.className = "word-feedback ok";
            wordFeedback.textContent = `Valid · ${live.score} pts` +
                (st.yourWord && live.score < st.yourWordScore ? " (lower than your submitted word)" : "");
        } else if (!live.formable) {
            // Still surface the dictionary verdict so the player learns whether
            // the typed word at least exists, even though they can't play it.
            wordFeedback.className = "word-feedback bad";
            if (wordSet.size === 0) {
                wordFeedback.textContent = "You don't have the tiles for that.";
            } else if (live.inDict) {
                wordFeedback.textContent = `${live.clean} is a word, but you don't have the tiles.`;
            } else {
                wordFeedback.textContent = "Not in the word list — and you don't have the tiles.";
            }
        } else if (!live.inDict) {
            wordFeedback.className = "word-feedback bad";
            wordFeedback.textContent = "Not in the word list.";
        } else {
            wordFeedback.className = "word-feedback bad";
            wordFeedback.textContent = "Words must be 2–10 letters.";
        }
        btnSubmitWord.disabled = !(live && live.valid);
    }

    // Showdown countdown to submit a word. If you've already submitted one,
    // the countdown nudges you to resubmit a higher-scoring word instead.
    if (st.submitOpen) {
        submitTimer.classList.remove("hidden");
        const secs = Math.max(0, Math.ceil((st.submitMsLeft || 0) / 1000));
        submitTimerText.textContent = st.yourWord
            ? `Resubmit a better word — ${secs}s`
            : `Submit a word — ${secs}s`;
        const total = (st.submitSeconds || 20) * 1000;
        const pct = Math.max(0, Math.min(100, ((st.submitMsLeft || 0) / total) * 100));
        submitTimerBar.style.width = pct + "%";
    } else {
        submitTimer.classList.add("hidden");
    }
}

async function submitWord() {
    const word = wordInput.value.trim();
    if (!word) return;
    initAudio();
    try {
        const r = await api("/holdem/word", "POST", { word });
        if (r.ok) {
            const data = await r.json();
            if (lastState) {
                lastState.yourWord = data.word;
                lastState.yourWordScore = data.score;
            }
            wordInput.value = "";
            suppressLockedWordPreview = false;
            playSfx("call");
            updateWordArea();
        } else {
            wordFeedback.className = "word-feedback bad";
            wordFeedback.textContent = await r.text();
        }
    } catch (e) { console.error(e); }
    poll();
}

// Reveal every contender's best word at the end of the round.
function renderShowdown(result) {
    const entries = result.entries || [];
    if (!entries.length) {
        showdownEl.classList.add("hidden");
        showdownEl.innerHTML = "";
        return;
    }
    const rows = entries.map(e => {
        const play = (e.play && e.play.words && e.play.words.length)
            ? `<span class="sd-play">${playWordsHTML(e.play, "sd")}</span>`
            : `<span class="sd-play sd-noword">— no word —</span>`;
        const win = e.won ? ' <span class="sd-badge">WIN</span>' : "";
        const fold = e.folded ? ' <span class="sd-fold-mark">(fold)</span>' : "";
        const cls = (e.won ? " sd-winner" : "") + (e.folded ? " sd-folded" : "");
        return `<div class="sd-row${cls}">
            <span class="sd-name">${escapeHTML(e.name)}${win}</span>
            ${play}
            <span class="sd-score">${e.score} pts${fold}</span>
        </div>`;
    }).join("");
    showdownEl.innerHTML =
        `<div class="sd-title">${escapeHTML(result.winnerMsg || "Showdown")}</div>${rows}`;
    showdownEl.classList.remove("hidden");
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
const timerText = document.getElementById("turn-timer-text");

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

    // Timer bar + countdown text inside the action bar, so the time pressure
    // is part of the same visual block as the choices.
    if (st.timeLeftMs > 0) {
        timerWrap.classList.remove("hidden");
        const total = (st.turnSeconds || 60) * 1000;
        const pct = Math.max(0, Math.min(100, (st.timeLeftMs / total) * 100));
        const secs = Math.max(0, Math.ceil(st.timeLeftMs / 1000));
        timerBar.style.width = pct + "%";
        timerText.textContent = `Your turn — ${secs}s`;
        timerWrap.classList.toggle("warn", pct <= 50 && pct > 25);
        timerWrap.classList.toggle("danger", pct <= 25);
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

// --- CPU management ---------------------------------------------------------
async function addCPU(difficulty) {
    addMenuOpen = false;
    try {
        const r = await api("/holdem/addcpu", "POST", { difficulty });
        if (!r.ok) console.warn("addcpu rejected:", await r.text());
    } catch (e) { console.error(e); }
    poll();
}

async function removeCPU(seat) {
    try {
        const r = await api("/holdem/removecpu", "POST", { seat });
        if (!r.ok) console.warn("removecpu rejected:", await r.text());
    } catch (e) { console.error(e); }
    poll();
}

// Seats are rebuilt every render, so delegate clicks from the stable container.
seatsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    switch (btn.dataset.action) {
        case "open-add": addMenuOpen = true; render(lastState); break;
        case "add-cpu": addCPU(btn.dataset.diff); break;
        case "remove-cpu": removeCPU(+btn.dataset.seat); break;
        case "rename": promptForName("rename"); break;
    }
});

btnFold.onclick = () => sendAction("fold");
btnCheck.onclick = () => sendAction("check");
btnCall.onclick = () => sendAction("call");
btnRaise.onclick = () => sendAction("raise", +raiseSlider.value);

// Live word feedback as you type; Enter submits.
wordInput.addEventListener("input", () => {
    if (wordInput.value.length > 0) suppressLockedWordPreview = false;
    updateWordArea();
});
wordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !btnSubmitWord.disabled) submitWord();
    else if (e.key === "Backspace" && wordInput.value === "") {
        suppressLockedWordPreview = true;
        updateWordArea();
    }
});
btnSubmitWord.onclick = submitWord;

// The tile block is the input surface: focus styling drives the accent ring and
// blinking caret, and tapping anywhere on the block opens the keyboard.
wordInput.addEventListener("focus", () => { wordZone.classList.add("focused"); updateWordArea(); });
wordInput.addEventListener("blur", () => {
    suppressLockedWordPreview = false;
    wordZone.classList.remove("focused");
    updateWordArea();
});
wordZone.addEventListener("click", () => {
    // Any click into the block clears the previous word so you start fresh.
    wordInput.value = "";
    wordInput.focus();
    updateWordArea();
});
// Don't let the zone-level click wipe the word the player is submitting.
btnSubmitWord.addEventListener("click", (e) => e.stopPropagation());

document.getElementById("btn-start").onclick = async () => {
    initAudio(); // unlock audio on this user gesture
    startArea.classList.add("hidden"); // optimistic hide to prevent double-click
    try {
        const r = await api("/holdem/start", "POST");
        if (!r.ok) console.warn("start rejected:", await r.text());
    } catch (e) {
        console.error(e);
    }
    poll();
};

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
    await Promise.all([join(), loadWords(), loadLetters()]);
    poll();
    setInterval(poll, 1000);
})();
