import { API_BASE } from "/utils.js";

let gridData = null;
let state = null;
let currentQuestion = null;
const STORAGE_PREFIX = "dmj-trivia-";
const HISTORY_COOKIE = "dmj-trivia-history";
const HISTORY_COOKIE_DAYS = 365;
const HISTORY_MAX_ENTRIES = 60;

function setCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 86400000).toUTCString();
    document.cookie = name + "=" + encodeURIComponent(value) +
        "; expires=" + expires + "; path=/; SameSite=Lax";
}

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

function loadHistory() {
    const raw = getCookie(HISTORY_COOKIE);
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
    setCookie(HISTORY_COOKIE, JSON.stringify(trimmed), HISTORY_COOKIE_DAYS);
}

function recordGameResult(date, score, maxScore) {
    const history = loadHistory().filter(e => e.d !== date);
    history.push({ d: date, s: score, m: maxScore });
    history.sort((a, b) => a.d.localeCompare(b.d));
    saveHistory(history);
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

function computeStreak(history) {
    if (!history.length) return 0;
    const dates = new Set(history.map(e => e.d));
    const today = todayStr();
    const yesterday = shiftDate(today, -1);
    let cursor = dates.has(today) ? today : (dates.has(yesterday) ? yesterday : null);
    if (!cursor) return 0;
    let streak = 0;
    while (dates.has(cursor)) {
        streak++;
        cursor = shiftDate(cursor, -1);
    }
    return streak;
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

function getOrCreatePlayerId() {
    const key = "dmj-player-id";
    let id = localStorage.getItem(key);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
    return id;
}
const playerId = getOrCreatePlayerId();

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
    const streak = computeStreak(history);
    document.getElementById("stat-average").textContent =
        history.length ? avg.toFixed(1) : "-";
    document.getElementById("stat-streak").textContent =
        streak + (streak === 1 ? " day" : " days");
    document.getElementById("gameover-chart").innerHTML = renderSevenDayChart(history);

    document.getElementById("gameover-overlay").classList.remove("hidden");
}

function copyResults() {
    const emoji = buildEmojiGrid();
    const maxScore = gridData.questions.reduce((sum, q) => sum + q.points, 0);
    const text =
        "Daily Trivia " + state.date + "\n" +
        "Score: " + state.score + "/" + maxScore + "\n\n" +
        emoji;

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

async function init() {
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
}

init();
