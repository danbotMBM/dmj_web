import { API_BASE } from "/utils.js";

let gridData = null;
let state = null;
let currentQuestion = null;
const STORAGE_PREFIX = "dmj-trivia-";
const HISTORY_COOKIE = "dmj-trivia-history";
const HISTORY_KEY = "dmj-trivia-history";
const STATS_UPDATED_KEY = "dmj-stats-updated";
const HISTORY_MAX_ENTRIES = 60;

function getCookie(name) {
    const prefix = name + "=";
    for (const part of document.cookie.split(";")) {
        const trimmed = part.trim();
        if (trimmed.startsWith(prefix)) {
            return decodeURIComponent(trimmed.slice(prefix.length));
        }
    }
    return null;
}

function migrateHistoryFromCookie() {
    if (localStorage.getItem(HISTORY_KEY)) return;
    const raw = getCookie(HISTORY_COOKIE);
    if (raw) {
        localStorage.setItem(HISTORY_KEY, raw);
        document.cookie = HISTORY_COOKIE + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax";
    }
}

function loadHistory() {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function saveHistory(history) {
    const trimmed = history.slice(-HISTORY_MAX_ENTRIES);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}

function recordGameResult(date, score, maxScore) {
    const history = loadHistory().filter(e => e.d !== date);
    history.push({ d: date, s: score, m: maxScore });
    history.sort((a, b) => a.d.localeCompare(b.d));
    saveHistory(history);
    const now = new Date().toISOString();
    localStorage.setItem(STATS_UPDATED_KEY, now);
    uploadStats(history, now);
}

function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0");
}

function shiftDate(dateStr, deltaDays) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + deltaDays);
    return date.getFullYear() + "-" +
        String(date.getMonth() + 1).padStart(2, "0") + "-" +
        String(date.getDate()).padStart(2, "0");
}

function formatDateShort(dateStr) {
    const [, m, d] = dateStr.split("-").map(Number);
    return m + "/" + d;
}

function computeAverage(history) {
    if (!history.length) return 0;
    const sum = history.reduce((a, e) => a + e.s, 0);
    return sum / history.length;
}


function renderSevenDayChart(history) {
    const byDate = {};
    for (const e of history) byDate[e.d] = e;

    const days = [];
    for (let i = 6; i >= 0; i--) days.push(shiftDate(todayStr(), -i));

    let maxVal = 0;
    for (const d of days) {
        const e = byDate[d];
        if (e && e.s > maxVal) maxVal = e.s;
    }
    if (maxVal === 0) maxVal = 1;

    const w = 320, chartH = 110, labelH = 16, valueH = 12;
    const totalH = chartH + labelH + valueH;
    const slot = w / 7;
    const barW = slot - 10;

    const parts = [];
    parts.push('<svg viewBox="0 0 ' + w + ' ' + totalH + '" xmlns="http://www.w3.org/2000/svg" class="score-chart" role="img" aria-label="Score over past 7 days">');
    for (let i = 0; i < 7; i++) {
        const d = days[i];
        const e = byDate[d];
        const score = e ? e.s : 0;
        const barH = e ? Math.max(2, (score / maxVal) * chartH) : 0;
        const x = i * slot + (slot - barW) / 2;
        const y = valueH + (chartH - barH);
        const fill = e ? "#3b82f6" : "#d1d5db";
        parts.push('<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
            '" width="' + barW.toFixed(1) + '" height="' + barH.toFixed(1) +
            '" fill="' + fill + '" rx="3"/>');
        if (e) {
            parts.push('<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (y - 2).toFixed(1) +
                '" text-anchor="middle" class="chart-value">' + score + '</text>');
        }
        parts.push('<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (valueH + chartH + labelH - 3) +
            '" text-anchor="middle" class="chart-label">' + formatDateShort(d) + '</text>');
    }
    parts.push('</svg>');
    return parts.join("");
}

function generatePlayerId() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => chars[b % chars.length]).join("");
}

function getOrCreatePlayerId() {
    const key = "dmj-player-id";
    let id = localStorage.getItem(key);
    if (!id || id.includes("-")) {
        id = generatePlayerId();
        localStorage.setItem(key, id);
    }
    return id;
}
let playerId = getOrCreatePlayerId();

async function uploadStats(history, lastUpdated) {
    try {
        await fetch(API_BASE + "/trivia/player-stats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                player_id: playerId,
                history: history,
                last_updated: lastUpdated,
            }),
        });
    } catch (e) {
        // best-effort, silent fail
    }
}

async function syncRemoteStats() {
    const localUpdated = localStorage.getItem(STATS_UPDATED_KEY) || "";
    try {
        const resp = await fetch(API_BASE + "/trivia/player-stats/" + playerId);
        if (!resp.ok) return;
        const remote = await resp.json();
        if (remote.last_updated > localUpdated) {
            saveHistory(remote.history);
            localStorage.setItem(STATS_UPDATED_KEY, remote.last_updated);
        }
    } catch (e) {
        // best-effort, silent fail
    }
}

const NAME_KEY = "dmj-trivia-name";

async function fetchResults() {
    try {
        const resp = await fetch(API_BASE + "/trivia/results", {
            headers: { "X-Player-ID": playerId },
        });
        if (!resp.ok) return null;
        return await resp.json();
    } catch (e) {
        return null;
    }
}

async function fetchName() {
    try {
        const resp = await fetch(API_BASE + "/trivia/name", {
            headers: { "X-Player-ID": playerId },
        });
        if (!resp.ok) return "";
        const data = await resp.json();
        return data.name || "";
    } catch (e) {
        return "";
    }
}

// saveName posts the display name to the server (with profanity check) and reports status.
// onSuccess receives the stored name so callers can refresh dependent UI (e.g. leaderboard).
async function saveName(name, statusEl, onSuccess) {
    name = name.trim();
    statusEl.classList.remove("hidden");
    if (!name) {
        statusEl.style.color = "#ef4444";
        statusEl.textContent = "Please enter a name.";
        return;
    }
    statusEl.style.color = "var(--fgColor-muted)";
    statusEl.textContent = "Saving…";
    try {
        const resp = await fetch(API_BASE + "/trivia/name", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Player-ID": playerId },
            body: JSON.stringify({ name: name }),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
            const saved = data.name || name;
            localStorage.setItem(NAME_KEY, saved);
            statusEl.style.color = "#22c55e";
            statusEl.textContent = "Saved!";
            if (onSuccess) onSuccess(saved);
        } else {
            statusEl.style.color = "#ef4444";
            statusEl.textContent = data.error || "Could not save name.";
        }
    } catch (e) {
        statusEl.style.color = "#ef4444";
        statusEl.textContent = "Network error. Please try again.";
    }
}

// flagEmoji turns a 2-letter ISO country code into its regional-indicator flag.
function flagEmoji(code) {
    if (typeof code !== "string" || code.length !== 2) return "";
    const cc = code.toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return "";
    return String.fromCodePoint(
        0x1f1e6 + cc.charCodeAt(0) - 65,
        0x1f1e6 + cc.charCodeAt(1) - 65
    );
}

// geoLabel builds the compact location tag shown beside a leaderboard name,
// e.g. "🇺🇸 New York". Returns null when the server had no location for the player.
function geoLabel(geo) {
    if (!geo) return null;
    const place = geo.region || geo.country || "";
    const text = [flagEmoji(geo.country_code), place].filter(Boolean).join(" ");
    if (!text) return null;
    const parts = [geo.region, geo.country].filter(Boolean);
    return { text: text, title: parts.length ? parts.join(", ") : text };
}

function renderLeaderboard(results) {
    const list = document.getElementById("gameover-leaderboard");
    list.innerHTML = "";
    if (!results.top3 || results.top3.length === 0) {
        const li = document.createElement("li");
        li.className = "leaderboard-empty";
        li.textContent = "No scores yet — be the first!";
        list.appendChild(li);
    } else {
        for (const entry of results.top3) {
            const li = document.createElement("li");
            const name = document.createElement("span");
            name.className = "lb-name";
            name.textContent = entry.name;
            const score = document.createElement("span");
            score.className = "lb-score";
            score.textContent = entry.score;
            li.appendChild(name);
            const geo = geoLabel(entry.geo);
            if (geo) {
                const tag = document.createElement("span");
                tag.className = "lb-geo";
                tag.textContent = geo.text;
                tag.title = geo.title;
                li.appendChild(tag);
            }
            li.appendChild(score);
            list.appendChild(li);
        }
    }
    const rankEl = document.getElementById("gameover-rank");
    if (results.rank && results.total_players) {
        rankEl.textContent = "Your rank: " + results.rank + " of " + results.total_players;
    } else {
        rankEl.textContent = "";
    }
}

async function fetchScoreboard() {
    try {
        const resp = await fetch(API_BASE + "/trivia/scoreboard" + dateQuery, {
            headers: { "X-Player-ID": playerId },
        });
        if (!resp.ok) return null;
        return await resp.json();
    } catch (e) {
        return null;
    }
}

function renderScoreboard(data) {
    const list = document.getElementById("scoreboard-list");
    const dateEl = document.getElementById("scoreboard-date");
    list.innerHTML = "";
    dateEl.textContent = data && data.date ? data.date : "";

    const entries = (data && data.entries) || [];
    if (!entries.length) {
        const li = document.createElement("li");
        li.className = "leaderboard-empty";
        li.textContent = "No one has played yet today — be the first!";
        list.appendChild(li);
        return;
    }
    for (const entry of entries) {
        const li = document.createElement("li");
        if (entry.me) li.classList.add("lb-me");
        const name = document.createElement("span");
        name.className = "lb-name";
        name.textContent = entry.name;
        li.appendChild(name);
        const geo = geoLabel(entry.geo);
        if (geo) {
            const tag = document.createElement("span");
            tag.className = "lb-geo";
            tag.textContent = geo.text;
            tag.title = geo.title;
            li.appendChild(tag);
        }
        const score = document.createElement("span");
        score.className = "lb-score";
        score.textContent = entry.score;
        li.appendChild(score);
        list.appendChild(li);
    }
}

function openScoreboard() {
    const list = document.getElementById("scoreboard-list");
    list.innerHTML = "";
    const loading = document.createElement("li");
    loading.className = "leaderboard-empty";
    loading.textContent = "Loading…";
    list.appendChild(loading);
    document.getElementById("scoreboard-date").textContent = "";
    document.getElementById("scoreboard-overlay").classList.remove("hidden");
    fetchScoreboard().then(data => renderScoreboard(data));
}

function closeScoreboard() {
    document.getElementById("scoreboard-overlay").classList.add("hidden");
}

// Check for ?date= URL parameter to load a specific day's trivia
const urlParams = new URLSearchParams(window.location.search);
const requestedDate = urlParams.get("date");
const dateQuery = requestedDate ? "?date=" + encodeURIComponent(requestedDate) : "";

function getStorageKey(date) {
    return STORAGE_PREFIX + date;
}

function loadState(date) {
    const key = getStorageKey(date);
    const saved = localStorage.getItem(key);
    if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.date === date) {
            return parsed;
        }
    }
    return null;
}

function initState(date, questions) {
    const cells = {};
    for (const q of questions) {
        cells[q.id] = "unattempted";
    }
    return {
        date: date,
        strikes: 0,
        score: 0,
        gameOver: false,
        cells: cells,
    };
}

function recalcScore() {
    state.score = gridData.questions
        .filter(q => state.cells[q.id] === "correct")
        .reduce((sum, q) => sum + q.points, 0);
}

function saveState() {
    localStorage.setItem(getStorageKey(state.date), JSON.stringify(state));
}

function renderStrikes() {
    const el = document.getElementById("strikes-display");
    const maxStrikes = 3;
    let text = "";
    for (let i = 0; i < maxStrikes; i++) {
        text += i < state.strikes ? "❌" : "⬜";
    }
    el.textContent = text;
}

function renderScore() {
    document.getElementById("score-display").textContent = "Score: " + state.score;
}

function updateResetButton() {
    const container = document.getElementById("reset-container");
    if (state.gameOver) {
        container.classList.remove("hidden");
    } else {
        container.classList.add("hidden");
    }
}

function renderGrid() {
    const container = document.getElementById("grid-container");
    container.innerHTML = "";

    const categories = gridData.categories;
    const questions = gridData.questions;

    // Add category headers
    for (const cat of categories) {
        const header = document.createElement("div");
        header.className = "grid-header";
        header.textContent = cat;
        container.appendChild(header);
    }

    // Questions are stored column-major: cat0(100,200,300), cat1(100,200,300), cat2(100,200,300)
    // Display as row-major: row0(cat0-100, cat1-100, cat2-100), row1(cat0-200, cat1-200, cat2-200), ...
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            const idx = col * 3 + row;
            const q = questions[idx];
            const cell = document.createElement("div");
            cell.className = "grid-cell cell-" + state.cells[q.id];
            cell.textContent = q.points;
            cell.dataset.id = q.id;

            if (state.cells[q.id] === "unattempted" && !state.gameOver) {
                cell.addEventListener("click", () => openQuestion(q.id));
            }

            container.appendChild(cell);
        }
    }
}

async function openQuestion(id) {
    if (state.gameOver) return;

    try {
        const resp = await fetch(API_BASE + "/trivia/question/" + id + dateQuery, {
            headers: { "X-Player-ID": playerId },
        });
        if (!resp.ok) return;
        currentQuestion = await resp.json();
    } catch (e) {
        console.error("Failed to fetch question:", e);
        return;
    }

    document.getElementById("question-category").textContent = currentQuestion.category;
    document.getElementById("question-points").textContent = currentQuestion.points + " points";
    document.getElementById("question-text").textContent = currentQuestion.question;

    // Reset overlay state
    document.getElementById("answer-section").classList.remove("hidden");
    document.getElementById("result-section").classList.add("hidden");
    document.getElementById("answer-input").value = "";

    document.getElementById("question-overlay").classList.remove("hidden");

    // Focus input after overlay is visible
    setTimeout(() => document.getElementById("answer-input").focus(), 50);
}

async function submitAnswer() {
    const input = document.getElementById("answer-input").value.trim();
    if (!input || !currentQuestion) return;

    let result;
    try {
        const resp = await fetch(API_BASE + "/trivia/answer" + dateQuery, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Player-ID": playerId },
            body: JSON.stringify({ id: currentQuestion.id, answer: input }),
        });
        if (!resp.ok) return;
        result = await resp.json();
    } catch (e) {
        console.error("Failed to submit answer:", e);
        return;
    }

    // Update state
    if (result.correct) {
        state.cells[currentQuestion.id] = "correct";
        recalcScore();
    } else {
        state.cells[currentQuestion.id] = "incorrect";
        state.strikes = Object.values(state.cells).filter(s => s === "incorrect").length;
    }

    // Check game over conditions
    const allAnswered = Object.values(state.cells).every((s) => s !== "unattempted");
    if (state.strikes >= 3 || allAnswered) {
        state.gameOver = true;
    }

    saveState();

    // Show result
    document.getElementById("answer-section").classList.add("hidden");
    document.getElementById("result-section").classList.remove("hidden");

    const resultText = document.getElementById("result-text");
    const resultAnswer = document.getElementById("result-answer");

    if (result.correct) {
        resultText.textContent = "Correct! +" + result.points;
        resultText.style.color = "#22c55e";
    } else {
        resultText.textContent = "Incorrect";
        resultText.style.color = "#ef4444";
    }
    resultAnswer.textContent = result.display;
}

function closeQuestionOverlay() {
    document.getElementById("question-overlay").classList.add("hidden");
    currentQuestion = null;
    renderGrid();
    renderScore();
    renderStrikes();
    updateResetButton();

    if (state.gameOver) {
        showGameOver();
    }
}

function buildEmojiGrid() {
    const questions = gridData.questions;
    let lines = [];
    // Row-major display
    for (let row = 0; row < 3; row++) {
        let line = "";
        for (let col = 0; col < 3; col++) {
            const idx = col * 3 + row;
            const q = questions[idx];
            const s = state.cells[q.id];
            if (s === "correct") {
                line += "🟩";
            } else if (s === "incorrect") {
                line += "🟥";
            } else {
                line += "🟦";
            }
        }
        lines.push(line);
    }
    return lines.join("\n");
}

function showGameOver() {
    const maxScore = gridData.questions.reduce((sum, q) => sum + q.points, 0);

    document.getElementById("gameover-title").textContent =
        state.strikes >= 3 ? "Game Over" : "You cleared the board!";
    document.getElementById("gameover-score").textContent =
        "Score: " + state.score + " / " + maxScore;
    document.getElementById("gameover-grid").textContent = buildEmojiGrid();
    document.getElementById("copy-confirm").classList.add("hidden");

    // Only record stats for today's game, not past-trivia replays.
    if (!requestedDate) {
        recordGameResult(state.date, state.score, maxScore);
    }

    const history = loadHistory();
    const avg = computeAverage(history);
    document.getElementById("stat-average").textContent =
        history.length ? avg.toFixed(1) : "-";
    document.getElementById("gameover-chart").innerHTML = renderSevenDayChart(history);

    // Leaderboard + name entry only apply to the live daily board, not past replays.
    const lbWrap = document.getElementById("leaderboard-wrap");
    if (!requestedDate) {
        lbWrap.classList.remove("hidden");
        const nameInput = document.getElementById("gameover-name-input");
        nameInput.value = "";
        document.getElementById("gameover-name-status").classList.add("hidden");
        // Hide the name entry until we know the player has no stored name yet.
        document.getElementById("gameover-name-entry").classList.add("hidden");
        document.getElementById("gameover-leaderboard").innerHTML = "";
        document.getElementById("gameover-rank").textContent = "";
        fetchResults().then(results => {
            if (!results) return;
            renderLeaderboard(results);
            if (!results.name) {
                document.getElementById("gameover-name-entry").classList.remove("hidden");
            }
        });
    } else {
        lbWrap.classList.add("hidden");
    }

    document.getElementById("gameover-overlay").classList.remove("hidden");
}

function copyResults() {
    const emoji = buildEmojiGrid();
    const maxScore = gridData.questions.reduce((sum, q) => sum + q.points, 0);
    const text =
        "The Daily Board " + state.date + "\n" +
        "Score: " + state.score + "/" + maxScore + "\n\n" +
        emoji + "\n\n" +
        "https://danbotlab.com/games/trivia/";

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            document.getElementById("copy-confirm").classList.remove("hidden");
        });
    } else {
        // Fallback
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        document.getElementById("copy-confirm").classList.remove("hidden");
    }
}

function openSettings() {
    document.getElementById("settings-player-id").textContent = playerId;
    document.getElementById("settings-id-input").value = "";
    const nameInput = document.getElementById("settings-name-input");
    nameInput.value = localStorage.getItem(NAME_KEY) || "";
    document.getElementById("settings-name-status").classList.add("hidden");
    fetchName().then(name => { if (name) nameInput.value = name; });
    const statusEl = document.getElementById("settings-status");
    statusEl.textContent = "";
    statusEl.classList.add("hidden");
    document.getElementById("settings-copy-confirm").classList.add("hidden");
    document.getElementById("settings-overlay").classList.remove("hidden");
}

function closeSettings() {
    document.getElementById("settings-overlay").classList.add("hidden");
}

async function syncFromId() {
    const input = document.getElementById("settings-id-input").value.trim();
    const statusEl = document.getElementById("settings-status");
    statusEl.classList.remove("hidden");

    if (!/^[A-Za-z0-9]{16}$/.test(input)) {
        statusEl.style.color = "#ef4444";
        statusEl.textContent = "Invalid ID — must be exactly 16 letters/numbers.";
        return;
    }

    if (input === playerId) {
        statusEl.style.color = "var(--fgColor-muted)";
        statusEl.textContent = "That's already your current ID.";
        return;
    }

    statusEl.style.color = "var(--fgColor-muted)";
    statusEl.textContent = "Syncing…";

    try {
        const resp = await fetch(API_BASE + "/trivia/player-stats/" + input);
        if (resp.ok) {
            const remote = await resp.json();
            localStorage.setItem("dmj-player-id", input);
            playerId = input;
            saveHistory(remote.history);
            localStorage.setItem(STATS_UPDATED_KEY, remote.last_updated);
            document.getElementById("settings-player-id").textContent = playerId;
            statusEl.style.color = "#22c55e";
            statusEl.textContent = "Synced! Stats imported from the other browser.";
        } else if (resp.status === 404) {
            localStorage.setItem("dmj-player-id", input);
            playerId = input;
            document.getElementById("settings-player-id").textContent = playerId;
            statusEl.style.color = "#22c55e";
            statusEl.textContent = "ID adopted. Future completed games will sync to this ID.";
        } else {
            statusEl.style.color = "#ef4444";
            statusEl.textContent = "Could not fetch stats for that ID. Try again.";
        }
    } catch (e) {
        statusEl.style.color = "#ef4444";
        statusEl.textContent = "Network error. Please try again.";
    }
}

async function init() {
    migrateHistoryFromCookie();

    // The scoreboard button is always available, even before (or if) the grid loads.
    document.getElementById("scoreboard-btn").addEventListener("click", openScoreboard);
    document.getElementById("scoreboard-close-btn").addEventListener("click", closeScoreboard);

    await syncRemoteStats();

    try {
        const resp = await fetch(API_BASE + "/trivia/grid" + dateQuery, {
            headers: { "X-Player-ID": playerId },
        });
        if (!resp.ok) {
            document.getElementById("grid-container").textContent = "No trivia available today.";
            return;
        }
        gridData = await resp.json();
    } catch (e) {
        console.error("Failed to fetch trivia grid:", e);
        document.getElementById("grid-container").textContent = "Failed to load trivia.";
        return;
    }

    // Load or init state
    state = loadState(gridData.date);
    if (!state) {
        state = initState(gridData.date, gridData.questions);
        saveState();
    }

    // Show the date
    document.getElementById("date-display").textContent = gridData.date;

    renderGrid();
    renderScore();
    renderStrikes();
    updateResetButton();

    if (state.gameOver) {
        showGameOver();
    }

    // Event listeners
    document.getElementById("submit-btn").addEventListener("click", submitAnswer);
    document.getElementById("answer-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter") submitAnswer();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !document.getElementById("result-section").classList.contains("hidden")) {
            closeQuestionOverlay();
        }
    });
    document.getElementById("continue-btn").addEventListener("click", closeQuestionOverlay);
    document.getElementById("copy-btn").addEventListener("click", copyResults);
    document.getElementById("close-gameover-btn").addEventListener("click", () => {
        document.getElementById("gameover-overlay").classList.add("hidden");
    });
    document.getElementById("reset-btn").addEventListener("click", () => {
        localStorage.removeItem(getStorageKey(state.date));
        state = initState(gridData.date, gridData.questions);
        saveState();
        renderGrid();
        renderScore();
        renderStrikes();
        updateResetButton();
    });

    // Settings
    document.getElementById("settings-btn").addEventListener("click", openSettings);
    document.getElementById("settings-close-btn").addEventListener("click", closeSettings);
    document.getElementById("settings-copy-id-btn").addEventListener("click", () => {
        navigator.clipboard.writeText(playerId).then(() => {
            const el = document.getElementById("settings-copy-confirm");
            el.classList.remove("hidden");
            setTimeout(() => el.classList.add("hidden"), 2000);
        });
    });
    document.getElementById("settings-sync-btn").addEventListener("click", syncFromId);
    document.getElementById("settings-id-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter") syncFromId();
    });

    // Name entry (settings + game over)
    document.getElementById("settings-name-btn").addEventListener("click", () => {
        saveName(
            document.getElementById("settings-name-input").value,
            document.getElementById("settings-name-status"),
        );
    });
    document.getElementById("settings-name-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter") document.getElementById("settings-name-btn").click();
    });
    document.getElementById("gameover-name-btn").addEventListener("click", () => {
        saveName(
            document.getElementById("gameover-name-input").value,
            document.getElementById("gameover-name-status"),
            () => {
                document.getElementById("gameover-name-entry").classList.add("hidden");
                fetchResults().then(results => { if (results) renderLeaderboard(results); });
            },
        );
    });
    document.getElementById("gameover-name-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter") document.getElementById("gameover-name-btn").click();
    });
}

init();
