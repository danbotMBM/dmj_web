// Race results visualizations — vanilla SVG, no deps.
// Toggle between Division / Gender / Overall scopes.

const DEFAULT_BIB = '3361';
const SVG_NS = 'http://www.w3.org/2000/svg';

const SEX_LABELS = { M: 'Men', F: 'Women' };

let ALL = [];   // all finishers with parsed times
let ME = null;
let MY_NET = 0;
let activeScope = 'div';

function divisionLabel(div) {
    // Format e.g. "M2529" -> "M25-29"
    if (!div) return '';
    const m = div.match(/^([MF])(\d{2})(\d{2})$/);
    if (!m) return div;
    return `${m[1]}${m[2]}–${m[3]}`;
}

function getScopes() {
    return [
        { key: 'div', label: `Division (${divisionLabel(ME.div)})` },
        { key: 'sex', label: SEX_LABELS[ME.sex] || ME.sex },
        { key: 'all', label: 'Overall' },
    ];
}

function timeToSeconds(t) {
    if (!t) return null;
    const parts = t.split(':').map(Number);
    if (parts.some(isNaN)) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return null;
}

function fmtTime(secs) {
    secs = Math.round(secs);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtPace(secsPerMile) {
    const m = Math.floor(secsPerMile / 60);
    const s = Math.round(secsPerMile % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function el(tag, attrs = {}, children = []) {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    for (const c of children) e.appendChild(c);
    return e;
}

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function text(s) {
    return document.createTextNode(s);
}

function firstName(runner) {
    return (runner.name || '').trim().split(/\s+/)[0] || runner.name || '';
}

function getScopeRows(scope) {
    if (scope === 'div') return ALL.filter(r => r.div === ME.div);
    if (scope === 'sex') return ALL.filter(r => r.sex === ME.sex && r.sex);
    return ALL;
}

function getScopeRank(scope) {
    // Rank within the scope by net time
    const rows = getScopeRows(scope);
    rows.sort((a, b) => a._net - b._net);
    const place = rows.findIndex(r => r.bib === ME.bib) + 1;
    return { place, total: rows.length };
}

async function main() {
    const data = await fetch('race_results_all.json').then(r => r.json());
    ALL = data.results
        .map(r => ({ ...r, _net: timeToSeconds(r.net_time) }))
        .filter(r => r._net != null);

    setFocus(ALL.find(r => r.bib === DEFAULT_BIB) || ALL[0]);
    renderSearch();
}

function setFocus(runner) {
    if (!runner) return;
    ME = runner;
    MY_NET = runner._net;
    renderStatCards();
    renderToggle();
    renderForScope(activeScope);
}

function renderSearch() {
    const c = document.getElementById('participant-search');
    if (!c) return;
    c.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'search-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'search-input';
    input.placeholder = 'Search by name or bib…';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-label', 'Search participants');

    const results = document.createElement('div');
    results.className = 'search-results';
    results.style.display = 'none';

    function renderMatches(query) {
        results.innerHTML = '';
        const q = query.trim().toLowerCase();
        if (!q) { results.style.display = 'none'; return; }

        let matches;
        if (/^\d+$/.test(q)) {
            // bib search — exact then prefix
            const exact = ALL.filter(r => r.bib === q);
            const prefix = ALL.filter(r => r.bib !== q && r.bib.startsWith(q));
            matches = exact.concat(prefix).slice(0, 20);
        } else {
            matches = ALL.filter(r => r.name.toLowerCase().includes(q)).slice(0, 20);
        }

        if (matches.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'search-empty';
            empty.textContent = 'No matches';
            results.appendChild(empty);
        } else {
            for (const m of matches) {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'search-item';
                item.innerHTML = `
                    <span class="search-item-name">${escapeHtml(m.name)}</span>
                    <span class="search-item-meta">Bib ${m.bib} · Age ${m.age || '—'} · ${divisionLabel(m.div) || '—'} · ${m.net_time}</span>
                `;
                item.addEventListener('click', () => {
                    input.value = m.name;
                    results.style.display = 'none';
                    setFocus(m);
                });
                results.appendChild(item);
            }
        }
        results.style.display = 'block';
    }

    input.addEventListener('input', () => renderMatches(input.value));
    input.addEventListener('focus', () => {
        if (input.value.trim()) renderMatches(input.value);
    });
    document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target)) results.style.display = 'none';
    });

    wrap.appendChild(input);
    wrap.appendChild(results);
    c.appendChild(wrap);
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderStatCards() {
    const container = document.getElementById('stat-cards');
    const divRank = getScopeRank('div');
    const sexRank = getScopeRank('sex');
    const allRank = getScopeRank('all');
    const sexLabel = SEX_LABELS[ME.sex] || 'Sex';
    const cards = [
        { label: 'Runner', value: ME.name, sub: `Age ${ME.age || '—'} · Bib #${ME.bib}` },
        { label: 'Net Time', value: ME.net_time, sub: `Gun ${ME.gun_time}` },
        { label: 'Net Pace', value: `${ME.net_pace}/mi`, sub: `13.1 mi` },
        { label: 'Division', value: `${divRank.place} / ${divRank.total}`, sub: divisionLabel(ME.div) || '—' },
        { label: sexLabel, value: `${sexRank.place} / ${sexRank.total}`, sub: `All ${sexLabel.toLowerCase()} finishers` },
        { label: 'Overall', value: `${allRank.place} / ${allRank.total}`, sub: `${ALL.length.toLocaleString()} finishers` },
    ];
    container.innerHTML = '';
    for (const c of cards) {
        const div = document.createElement('div');
        div.className = 'stat-card';
        div.innerHTML = `
            <div class="stat-label">${c.label}</div>
            <div class="stat-value">${c.value}</div>
            <div class="stat-sub">${c.sub}</div>
        `;
        container.appendChild(div);
    }
}

function renderToggle() {
    const c = document.getElementById('scope-toggle');
    c.innerHTML = '';
    const scopes = getScopes();
    // If active scope no longer applies (e.g. no division), fall back to 'all'
    if (!scopes.find(s => s.key === activeScope)) activeScope = 'all';
    for (const s of scopes) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'scope-btn' + (s.key === activeScope ? ' active' : '');
        btn.textContent = s.label;
        btn.addEventListener('click', () => {
            if (activeScope === s.key) return;
            activeScope = s.key;
            c.querySelectorAll('.scope-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderForScope(activeScope);
        });
        c.appendChild(btn);
    }
}

function renderForScope(scope) {
    const rows = getScopeRows(scope);
    const rank = getScopeRank(scope);
    const scopeLabel = getScopes().find(s => s.key === scope).label;

    // Summary line
    const summary = document.getElementById('scope-summary');
    const beats = rank.total - rank.place;
    const beatsPct = ((beats / rank.total) * 100).toFixed(0);
    summary.textContent = `${rank.total.toLocaleString()} finishers in ${scopeLabel}. ${firstName(ME)} placed ${ordinal(rank.place)}, ahead of ${beatsPct}% of the group.`;

    renderHistogram(rows, scopeLabel);
    renderPaceChart(rows, scopeLabel);
    renderRankBars(rank, scopeLabel);
}

function renderHistogram(rows, scopeLabel) {
    const times = rows.map(r => r._net);
    const min = Math.min(...times);
    const max = Math.max(...times);
    const binSize = 5 * 60;
    const start = Math.floor(min / binSize) * binSize;
    const end = Math.ceil(max / binSize) * binSize;
    const nBins = Math.max(1, Math.round((end - start) / binSize));
    const bins = new Array(nBins).fill(0);
    for (const t of times) {
        const idx = Math.min(nBins - 1, Math.floor((t - start) / binSize));
        bins[idx]++;
    }
    const myBin = Math.min(nBins - 1, Math.floor((MY_NET - start) / binSize));

    const W = 720, H = 320, M = { l: 40, r: 16, t: 16, b: 56 };
    const innerW = W - M.l - M.r;
    const innerH = H - M.t - M.b;
    const maxCount = Math.max(...bins);
    const barW = innerW / nBins;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });

    const grid = el('g', { class: 'chart-grid' });
    const yAxis = el('g', { class: 'chart-axis' });
    const yTicks = 4;
    for (let i = 0; i <= yTicks; i++) {
        const v = Math.round((maxCount * i) / yTicks);
        const y = M.t + innerH - (innerH * i) / yTicks;
        grid.appendChild(el('line', { x1: M.l, x2: M.l + innerW, y1: y, y2: y }));
        yAxis.appendChild(el('text', { x: M.l - 6, y: y + 3, 'text-anchor': 'end' }, [text(String(v))]));
    }
    svg.appendChild(grid);
    svg.appendChild(yAxis);

    const barsG = el('g');
    for (let i = 0; i < nBins; i++) {
        const h = maxCount === 0 ? 0 : (bins[i] / maxCount) * innerH;
        const x = M.l + i * barW;
        const y = M.t + innerH - h;
        barsG.appendChild(el('rect', {
            x: x + 1, y, width: Math.max(1, barW - 2), height: h,
            class: 'chart-bar' + (i === myBin ? ' me' : ''),
            rx: 2,
        }));
    }
    svg.appendChild(barsG);

    const xAxis = el('g', { class: 'chart-axis' });
    xAxis.appendChild(el('line', { x1: M.l, x2: M.l + innerW, y1: M.t + innerH, y2: M.t + innerH }));
    // Adaptive label step so we don't crowd
    const minPxBetween = 60;
    const labelStep = Math.max(1, Math.ceil(minPxBetween / barW));
    for (let i = 0; i <= nBins; i += labelStep) {
        const x = M.l + i * barW;
        const v = start + i * binSize;
        xAxis.appendChild(el('line', { x1: x, x2: x, y1: M.t + innerH, y2: M.t + innerH + 4 }));
        xAxis.appendChild(el('text', { x, y: M.t + innerH + 18, 'text-anchor': 'middle' }, [text(fmtTime(v))]));
    }
    svg.appendChild(xAxis);

    const myX = M.l + ((MY_NET - start) / binSize) * barW;
    svg.appendChild(el('line', {
        x1: myX, x2: myX, y1: M.t, y2: M.t + innerH,
        stroke: '#c2185b', 'stroke-width': 2, 'stroke-dasharray': '4 4',
    }));
    const lbl = el('text', {
        x: myX, y: M.t + 14, 'text-anchor': 'middle', class: 'chart-label me',
    }, [text(`${firstName(ME)} — ${fmtTime(MY_NET)}`)]);
    if (myX < M.l + 60) lbl.setAttribute('text-anchor', 'start');
    if (myX > M.l + innerW - 60) lbl.setAttribute('text-anchor', 'end');
    svg.appendChild(lbl);

    const xt = el('text', {
        x: M.l + innerW / 2, y: H - 8, 'text-anchor': 'middle',
        fill: 'var(--fgColor-muted, #636c76)', 'font-size': 11,
    }, [text('Net finish time (5-min bins)')]);
    svg.appendChild(xt);

    document.getElementById('hist-chart').innerHTML = '';
    document.getElementById('hist-chart').appendChild(svg);

    const median = sortedMedian(times);
    const myPct = ((times.filter(t => t > MY_NET).length / times.length) * 100).toFixed(0);
    document.getElementById('hist-caption').textContent =
        `${times.length.toLocaleString()} finishers in ${scopeLabel}. Median ${fmtTime(median)}. ${firstName(ME)} beat ${myPct}% of the group.`;
}

function sortedMedian(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function renderPaceChart(rows, scopeLabel) {
    // My segments
    const s1Time = timeToSeconds(ME.split_6_78);
    const s2Cum = timeToSeconds(ME.split_12);
    const s3Time = timeToSeconds(ME.last_1_1);
    const segments = [
        { label: 'Mi 0 – 6.78', dist: 6.78, time: s1Time },
        { label: 'Mi 6.78 – 12', dist: 5.22, time: s2Cum - s1Time },
        { label: 'Mi 12 – 13.1', dist: 1.1, time: s3Time },
    ];
    for (const s of segments) s.pace = s.time / s.dist;
    const myAvg = MY_NET / 13.1;

    // Group avg pace per segment
    const segCounts = [0, 0, 0];
    const segSums = [0, 0, 0];
    for (const r of rows) {
        const a = timeToSeconds(r.split_6_78);
        const b = timeToSeconds(r.split_12);
        const c = timeToSeconds(r.last_1_1);
        if (a != null) { segSums[0] += a / 6.78; segCounts[0]++; }
        if (a != null && b != null && b > a) { segSums[1] += (b - a) / 5.22; segCounts[1]++; }
        if (c != null) { segSums[2] += c / 1.1; segCounts[2]++; }
    }
    const groupPaces = segCounts.map((c, i) => c ? segSums[i] / c : null);

    const W = 720, H = 300, M = { l: 56, r: 16, t: 24, b: 64 };
    const innerW = W - M.l - M.r;
    const innerH = H - M.t - M.b;
    const allP = segments.map(s => s.pace).concat([myAvg]).concat(groupPaces.filter(p => p != null));
    const minP = Math.min(...allP) - 20;
    const maxP = Math.max(...allP) + 20;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });

    const grid = el('g', { class: 'chart-grid' });
    const yAxis = el('g', { class: 'chart-axis' });
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
        const v = minP + ((maxP - minP) * i) / ticks;
        const y = M.t + innerH - (innerH * i) / ticks;
        grid.appendChild(el('line', { x1: M.l, x2: M.l + innerW, y1: y, y2: y }));
        yAxis.appendChild(el('text', { x: M.l - 8, y: y + 3, 'text-anchor': 'end' }, [text(fmtPace(v) + '/mi')]));
    }
    svg.appendChild(grid);
    svg.appendChild(yAxis);

    // Grouped bars: me + group per segment
    const barW = innerW / segments.length;
    const barsG = el('g');
    segments.forEach((s, i) => {
        const slotX = M.l + i * barW;
        const meX = slotX + barW * 0.18;
        const grpX = slotX + barW * 0.52;
        const w = barW * 0.30;

        // Me bar
        const myY = M.t + innerH - ((s.pace - minP) / (maxP - minP)) * innerH;
        const myH = M.t + innerH - myY;
        barsG.appendChild(el('rect', { x: meX, y: myY, width: w, height: myH, class: 'chart-bar me', rx: 3 }));
        barsG.appendChild(el('text', {
            x: meX + w / 2, y: myY - 4, 'text-anchor': 'middle', class: 'chart-label',
        }, [text(fmtPace(s.pace))]));

        // Group bar
        if (groupPaces[i] != null) {
            const gp = groupPaces[i];
            const gy = M.t + innerH - ((gp - minP) / (maxP - minP)) * innerH;
            const gh = M.t + innerH - gy;
            barsG.appendChild(el('rect', { x: grpX, y: gy, width: w, height: gh, class: 'chart-bar', rx: 3 }));
            barsG.appendChild(el('text', {
                x: grpX + w / 2, y: gy - 4, 'text-anchor': 'middle', class: 'chart-label',
            }, [text(fmtPace(gp))]));
        }
    });
    svg.appendChild(barsG);

    const xAxis = el('g', { class: 'chart-axis' });
    xAxis.appendChild(el('line', { x1: M.l, x2: M.l + innerW, y1: M.t + innerH, y2: M.t + innerH }));
    segments.forEach((s, i) => {
        const x = M.l + i * barW + barW / 2;
        xAxis.appendChild(el('text', { x, y: M.t + innerH + 18, 'text-anchor': 'middle' }, [text(s.label)]));
        xAxis.appendChild(el('text', {
            x, y: M.t + innerH + 34, 'text-anchor': 'middle',
        }, [text(`${s.dist} mi · ${fmtTime(s.time)}`)]));
    });
    svg.appendChild(xAxis);

    // Legend
    const legend = el('g');
    const lx = M.l + 6, ly = M.t + 4;
    legend.appendChild(el('rect', { x: lx, y: ly, width: 12, height: 12, class: 'chart-bar me', rx: 2 }));
    legend.appendChild(el('text', {
        x: lx + 18, y: ly + 10, class: 'chart-label',
    }, [text(firstName(ME))]));
    legend.appendChild(el('rect', { x: lx + 60, y: ly, width: 12, height: 12, class: 'chart-bar', rx: 2 }));
    legend.appendChild(el('text', {
        x: lx + 78, y: ly + 10, class: 'chart-label',
    }, [text(scopeLabel + ' avg')]));
    svg.appendChild(legend);

    document.getElementById('pace-chart').innerHTML = '';
    document.getElementById('pace-chart').appendChild(svg);

    const drift = segments[2].pace - segments[0].pace;
    const fn = firstName(ME);
    const driftStr = drift >= 0
        ? `Positive split: ${fn} slowed ${Math.round(drift)}s/mi from start to finish.`
        : `Negative split: ${fn} sped up ${Math.round(-drift)}s/mi from start to finish.`;
    document.getElementById('pace-caption').textContent = driftStr;
}

function renderRankBars(rank, scopeLabel) {
    const container = document.getElementById('rank-chart');
    container.innerHTML = '';
    const beats = rank.total - rank.place;
    const pct = ((beats / rank.total) * 100).toFixed(1);

    const row = document.createElement('div');
    row.className = 'rank-row';
    row.innerHTML = `
        <div class="rank-label">${scopeLabel}</div>
        <div class="rank-bar-track">
            <div class="rank-bar-fill" style="width: ${pct}%"></div>
        </div>
        <div class="rank-text">${ordinal(rank.place)} of ${rank.total.toLocaleString()}</div>
    `;
    container.appendChild(row);

    const note = document.createElement('div');
    note.className = 'rank-note';
    note.textContent = `Better than ${pct}% of ${scopeLabel.toLowerCase()}.`;
    container.appendChild(note);
}

main();
