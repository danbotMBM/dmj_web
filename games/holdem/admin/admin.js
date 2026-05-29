import { API_BASE } from "/utils.js";

const TOKEN_KEY = "dmj-auth-token";

const authGate = document.getElementById("auth-gate");
const adminContent = document.getElementById("admin-content");
const daysSelect = document.getElementById("days-select");
const refreshBtn = document.getElementById("refresh-btn");
const loadingMsg = document.getElementById("loading-msg");
const summary = document.getElementById("summary");
const timeline = document.getElementById("timeline");
const tooltip = document.getElementById("tooltip");

function getToken() { return localStorage.getItem(TOKEN_KEY); }

function showTooltip(html, evt) {
    tooltip.innerHTML = html;
    tooltip.classList.remove("hidden");
    const x = evt.clientX + 12;
    const y = evt.clientY + 12;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
}
function hideTooltip() { tooltip.classList.add("hidden"); }

function fmtDuration(seconds) {
    if (seconds < 60) return Math.round(seconds) + "s";
    if (seconds < 3600) return Math.round(seconds / 60) + "m";
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
}

function fmtTime(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleString();
}

// Collapse a per-player event stream into presence sessions + word ticks.
// A session = join -> next leave (or windowEnd if still seated).
// Words that arrive without a preceding join start an implicit session at the
// first word timestamp (defensive: handles backfill / lost join events).
function buildSessions(events, windowStart, windowEnd) {
    const sessions = [];
    const words = [];
    let openStart = null;
    for (const ev of events) {
        if (ev.type === "join") {
            if (openStart === null) openStart = ev.ts;
        } else if (ev.type === "leave") {
            if (openStart !== null) {
                sessions.push({ start: openStart, end: ev.ts, openEnded: false });
                openStart = null;
            } else {
                // Leave without a join in window — assume joined before window.
                sessions.push({ start: windowStart, end: ev.ts, openEnded: false });
            }
        } else if (ev.type === "word") {
            if (openStart === null) openStart = ev.ts;
            words.push({ ts: ev.ts, word: ev.word || "", score: ev.score || 0 });
        }
    }
    if (openStart !== null) {
        sessions.push({ start: openStart, end: windowEnd, openEnded: true });
    }
    return { sessions, words };
}

function svgEl(name, attrs = {}) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
}

function render(data) {
    const { window_start: ws, window_end: we, players, total_words } = data;
    const span = we - ws;

    // Compute per-player sessions, sort by total time descending.
    const rows = players.map(p => {
        const { sessions, words } = buildSessions(p.events, ws, we);
        const totalSecs = sessions.reduce((a, s) => a + (s.end - s.start), 0);
        return { name: p.name || "(unnamed)", playerId: p.player_id, sessions, words, totalSecs };
    });
    rows.sort((a, b) => b.totalSecs - a.totalSecs);

    const totalSessions = rows.reduce((a, r) => a + r.sessions.length, 0);

    summary.innerHTML = `
        <div class="stat"><span class="value">${rows.length}</span><span class="label">Players</span></div>
        <div class="stat"><span class="value">${totalSessions}</span><span class="label">Sessions</span></div>
        <div class="stat"><span class="value">${total_words || 0}</span><span class="label">Words submitted</span></div>
    `;

    timeline.innerHTML = "";

    if (rows.length === 0) {
        timeline.innerHTML = `<p style="padding:2rem;text-align:center;color:var(--fgColor-muted,#8b949e)">No activity in this window yet.</p>`;
        return;
    }

    // Layout constants.
    const labelW = 140;
    const rightPad = 20;
    const topPad = 28;
    const bottomPad = 12;
    const rowH = 28;
    const barH = 14;
    const barYOffset = (rowH - barH) / 2;
    const minWidth = 720;
    const wrapW = Math.max(timeline.parentElement.clientWidth, minWidth);
    const plotW = wrapW - labelW - rightPad;
    const totalH = topPad + rows.length * rowH + bottomPad;

    const xOf = ts => labelW + ((ts - ws) / span) * plotW;

    const svg = svgEl("svg", { width: wrapW, height: totalH, viewBox: `0 0 ${wrapW} ${totalH}` });

    // Day gridlines + labels.
    const dayStart = new Date(ws * 1000);
    dayStart.setHours(0, 0, 0, 0);
    for (let t = dayStart.getTime() / 1000; t <= we; t += 86400) {
        if (t < ws) continue;
        const x = xOf(t);
        svg.appendChild(svgEl("line", {
            x1: x, x2: x, y1: topPad - 8, y2: totalH - bottomPad,
            class: "day-grid",
        }));
        const lbl = svgEl("text", { x: x, y: topPad - 12, class: "day-label" });
        lbl.textContent = new Date(t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        svg.appendChild(lbl);
    }

    // "Now" marker.
    const nowX = xOf(we);
    svg.appendChild(svgEl("line", {
        x1: nowX, x2: nowX, y1: topPad - 8, y2: totalH - bottomPad,
        stroke: "#cf222e", "stroke-width": 1,
    }));

    // Per-row content.
    rows.forEach((row, i) => {
        const y = topPad + i * rowH;

        // Alternating row background.
        svg.appendChild(svgEl("rect", {
            x: 0, y: y, width: wrapW, height: rowH,
            class: "lane-bg" + (i % 2 ? " alt" : ""),
        }));

        // Label (truncate).
        const label = svgEl("text", {
            x: 10, y: y + rowH / 2, class: "lane-label",
        });
        const displayName = row.name.length > 16 ? row.name.slice(0, 15) + "…" : row.name;
        label.textContent = displayName;
        label.appendChild(svgEl("title")).textContent = `${row.name} (${row.playerId}) — ${fmtDuration(row.totalSecs)} total`;
        svg.appendChild(label);

        // Session bars.
        for (const s of row.sessions) {
            const x1 = xOf(s.start);
            const x2 = xOf(s.end);
            const w = Math.max(2, x2 - x1);
            const bar = svgEl("rect", {
                x: x1, y: y + barYOffset, width: w, height: barH,
                rx: 2, ry: 2,
                class: "session-bar" + (s.openEnded ? " open-ended" : ""),
            });
            const dur = s.end - s.start;
            bar.addEventListener("mousemove", (e) => showTooltip(
                `<b>${row.name}</b><br>` +
                `${fmtTime(s.start)} → ${s.openEnded ? "now" : fmtTime(s.end)}<br>` +
                `Duration: ${fmtDuration(dur)}`,
                e,
            ));
            bar.addEventListener("mouseleave", hideTooltip);
            svg.appendChild(bar);
        }

        // Word ticks.
        for (const w of row.words) {
            const x = xOf(w.ts);
            const tick = svgEl("rect", {
                x: x - 1.5, y: y + barYOffset - 2, width: 3, height: barH + 4,
                class: "word-tick",
            });
            tick.addEventListener("mousemove", (e) => showTooltip(
                `<b>${row.name}</b> · ${fmtTime(w.ts)}<br>` +
                `Word: <b>${w.word}</b> (${w.score} pts)`,
                e,
            ));
            tick.addEventListener("mouseleave", hideTooltip);
            svg.appendChild(tick);
        }
    });

    timeline.appendChild(svg);
}

async function load() {
    const token = getToken();
    if (!token) {
        authGate.classList.remove("hidden");
        adminContent.classList.add("hidden");
        return;
    }
    authGate.classList.add("hidden");
    adminContent.classList.remove("hidden");

    loadingMsg.textContent = "Loading…";
    const days = daysSelect.value;
    try {
        const r = await fetch(`${API_BASE}/holdem/admin/timeline?days=${days}`, {
            headers: { "Authorization": "Bearer " + token },
        });
        if (r.status === 401) {
            localStorage.removeItem(TOKEN_KEY);
            authGate.classList.remove("hidden");
            adminContent.classList.add("hidden");
            loadingMsg.textContent = "";
            return;
        }
        if (!r.ok) {
            loadingMsg.textContent = "Error: " + r.status;
            return;
        }
        const data = await r.json();
        loadingMsg.textContent = "";
        render(data);
    } catch (err) {
        loadingMsg.textContent = "Connection error";
    }
}

refreshBtn.addEventListener("click", load);
daysSelect.addEventListener("change", load);
window.addEventListener("resize", () => { /* keep simple — only re-layout on next load */ });

load();
