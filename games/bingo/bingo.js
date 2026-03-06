// ---- Module-level state (player mode) ----
let boardId = null;
let gameState = null;
let gameEntries = null;

// ---- Init ----
function route() {
    const hash = window.location.hash.slice(1);
    if (hash) {
        const data = decodeBoard(hash);
        if (data && data.title && Array.isArray(data.entries) && data.entries.length >= 24) {
            startPlayerMode(data);
        } else {
            showError('This bingo link is invalid or corrupted.');
        }
    } else {
        document.getElementById('player-view').classList.add('hidden');
        document.getElementById('creator-view').classList.remove('hidden');
        startCreatorMode();
    }
}

route();
window.addEventListener('popstate', route);

// ---- Encoding ----
function encodeBoard(data) {
    const json = JSON.stringify(data);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
}

function decodeBoard(hash) {
    try {
        const binary = atob(hash);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const json = new TextDecoder().decode(bytes);
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

// ---- Cookie helpers ----
function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + days * 86400000);
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/`;
}

function getCookie(name) {
    const prefix = name + '=';
    for (const part of document.cookie.split(';')) {
        const c = part.trim();
        if (c.startsWith(prefix)) return decodeURIComponent(c.slice(prefix.length));
    }
    return null;
}

// ---- String hash (stable, deterministic) ----
function hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return (h >>> 0).toString(36);
}

// ---- Shuffle ----
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ---- HTML escape ----
function esc(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ---- Creator mode ----
function startCreatorMode() {
    const view = document.getElementById('creator-view');
    view.innerHTML = `
        <h1>Bingo Board Generator</h1>

        <div class="how-to-play">
            <h3>How it works</h3>
            <ol>
                <li><strong>Host:</strong> Enter a board title and at least 24 entries below (one per line)</li>
                <li><strong>Host:</strong> Click "Generate Board" to create a shareable link</li>
                <li><strong>Host:</strong> Share that link with your players</li>
                <li><strong>Players:</strong> Open the link to receive a unique randomized 5&times;5 bingo board</li>
                <li><strong>Players:</strong> Tap a square when it is called &mdash; it turns green</li>
                <li><strong>Players:</strong> Use the buttons below the board to clear marks or reshuffle at any time</li>
            </ol>
        </div>

        <div class="creator-form">
            <div class="form-group">
                <label for="board-title">Board Title</label>
                <input type="text" id="board-title" placeholder="e.g. Office Party Bingo" maxlength="100">
            </div>
            <div class="form-group">
                <label for="board-entries">
                    Entries
                    <span id="entry-count" class="entry-count">0 entries</span>
                </label>
                <textarea id="board-entries" placeholder="Enter one item per line&#10;&#10;e.g.&#10;Someone brings donuts&#10;The printer breaks&#10;Meeting runs over time&#10;..."></textarea>
            </div>
            <p id="entry-warning" class="entry-warning hidden">At least 24 non-empty entries are required.</p>
            <button id="generate-btn" class="btn-primary" disabled>Generate Board</button>
        </div>

        <div id="share-section" class="share-section hidden">
            <h3>Board Ready!</h3>
            <p>Share this link with your players:</p>
            <div class="share-link-row">
                <input type="text" id="share-link" readonly>
                <button id="copy-link-btn" class="btn-primary">Copy</button>
            </div>
            <p id="copy-confirm" class="copy-confirm hidden">Copied!</p>
            <button id="go-to-board-btn" class="btn-primary" style="margin-top:10px;">Open My Board</button>
        </div>
    `;

    const titleInput = document.getElementById('board-title');
    const entriesArea = document.getElementById('board-entries');
    const entryCountEl = document.getElementById('entry-count');
    const entryWarning = document.getElementById('entry-warning');
    const generateBtn = document.getElementById('generate-btn');
    const shareSection = document.getElementById('share-section');
    const shareLinkInput = document.getElementById('share-link');
    const copyLinkBtn = document.getElementById('copy-link-btn');
    const copyConfirm = document.getElementById('copy-confirm');
    const goToBoardBtn = document.getElementById('go-to-board-btn');

    // Restore cached values
    const cachedTitle = localStorage.getItem('bingo-creator-title');
    const cachedEntries = localStorage.getItem('bingo-creator-entries');
    if (cachedTitle) titleInput.value = cachedTitle;
    if (cachedEntries) entriesArea.value = cachedEntries;

    function getValidEntries() {
        return entriesArea.value.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    }

    function updateValidation() {
        const entries = getValidEntries();
        const count = entries.length;
        entryCountEl.textContent = `${count} ${count === 1 ? 'entry' : 'entries'}`;
        entryCountEl.className = 'entry-count ' + (count >= 24 ? 'valid' : 'invalid');

        const hasTitle = titleInput.value.trim().length > 0;
        const hasEnough = count >= 24;
        generateBtn.disabled = !(hasTitle && hasEnough);
        entryWarning.classList.toggle('hidden', count === 0 || hasEnough);
    }

    titleInput.addEventListener('input', () => {
        localStorage.setItem('bingo-creator-title', titleInput.value);
        updateValidation();
    });
    entriesArea.addEventListener('input', () => {
        localStorage.setItem('bingo-creator-entries', entriesArea.value);
        updateValidation();
    });

    // Run on load to reflect restored values
    updateValidation();

    let lastEncoded = null;

    generateBtn.addEventListener('click', () => {
        const title = titleInput.value.trim();
        const entries = getValidEntries();
        if (!title || entries.length < 24) return;

        lastEncoded = encodeBoard({ title, entries });
        const url = `${location.origin}${location.pathname}#${lastEncoded}`;

        shareLinkInput.value = url;
        shareSection.classList.remove('hidden');
        shareSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    goToBoardBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!lastEncoded) return;
        const data = decodeBoard(lastEncoded);
        const url = `${location.origin}${location.pathname}#${lastEncoded}`;
        history.pushState(null, '', url);
        startPlayerMode(data);
    });

    copyLinkBtn.addEventListener('click', () => {
        // Use clipboard API with fallback for non-secure contexts
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(shareLinkInput.value).then(showCopied).catch(fallbackCopy);
        } else {
            fallbackCopy();
        }
    });

    function fallbackCopy() {
        shareLinkInput.select();
        shareLinkInput.setSelectionRange(0, 99999);
        try {
            document.execCommand('copy');
            showCopied();
        } catch (e) {}
    }

    function showCopied() {
        copyConfirm.classList.remove('hidden');
        setTimeout(() => copyConfirm.classList.add('hidden'), 2000);
    }
}

// ---- Player mode ----
function startPlayerMode(data) {
    boardId = 'bingo_' + hashStr(JSON.stringify(data));
    gameEntries = data.entries;

    const saved = loadState(boardId);
    gameState = saved || createNewState(data.entries);
    if (!saved) saveState(boardId, gameState);

    document.getElementById('creator-view').classList.add('hidden');
    const playerView = document.getElementById('player-view');
    playerView.classList.remove('hidden');

    playerView.innerHTML = `
        <h1>${esc(data.title)}</h1>
        <div id="bingo-grid-wrapper">
            <div class="bingo-col-headers">
                <div class="bingo-col-header">B</div>
                <div class="bingo-col-header">I</div>
                <div class="bingo-col-header">N</div>
                <div class="bingo-col-header">G</div>
                <div class="bingo-col-header">O</div>
            </div>
            <div id="bingo-grid"></div>
        </div>
        <div id="action-buttons">
            <div class="action-group">
                <button id="clear-btn" class="btn-secondary">Clear Board</button>
                <div id="clear-confirm" class="confirm-row hidden">
                    <span>Clear all marks?</span>
                    <button id="clear-cancel" class="btn-ghost">Cancel</button>
                    <button id="clear-yes" class="btn-danger">Yes, Clear</button>
                </div>
            </div>
            <div class="action-group">
                <button id="reshuffle-btn" class="btn-secondary">Reshuffle</button>
                <div id="reshuffle-confirm" class="confirm-row hidden">
                    <span>Get a new random board?</span>
                    <button id="reshuffle-cancel" class="btn-ghost">Cancel</button>
                    <button id="reshuffle-yes" class="btn-danger">Yes, Reshuffle</button>
                </div>
            </div>
            <div class="action-group">
                <button id="back-to-generator-btn" class="btn-secondary">Back to Generator</button>
            </div>
        </div>
    `;

    renderGrid();
    setupPlayerActions();
}

function createNewState(entries) {
    const order = shuffle(entries).slice(0, 24);
    const marked = new Array(25).fill(false);
    marked[12] = true; // FREE space always marked
    return { order, marked };
}

function loadState(id) {
    const raw = getCookie(id);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

function saveState(id, state) {
    setCookie(id, JSON.stringify(state), 30);
}

function renderGrid() {
    const grid = document.getElementById('bingo-grid');
    grid.innerHTML = '';

    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'bingo-cell';
        cell.dataset.index = i;

        if (i === 12) {
            cell.classList.add('free-space');
            cell.innerHTML = '<span class="cell-text">FREE</span>';
        } else {
            const orderIdx = i < 12 ? i : i - 1;
            cell.innerHTML = `<span class="cell-text">${esc(gameState.order[orderIdx])}</span>`;
            if (gameState.marked[i]) cell.classList.add('gotten');
            cell.addEventListener('click', onCellClick);
        }

        grid.appendChild(cell);
    }
}

function onCellClick(e) {
    const cell = e.currentTarget;
    const idx = parseInt(cell.dataset.index);
    gameState.marked[idx] = !gameState.marked[idx];
    cell.classList.toggle('gotten', gameState.marked[idx]);
    saveState(boardId, gameState);
}

function setupPlayerActions() {
    document.getElementById('clear-btn').addEventListener('click', () => showConfirm('clear'));
    document.getElementById('clear-cancel').addEventListener('click', () => hideConfirm('clear'));
    document.getElementById('clear-yes').addEventListener('click', () => {
        gameState.marked = new Array(25).fill(false);
        gameState.marked[12] = true;
        saveState(boardId, gameState);
        renderGrid();
        hideConfirm('clear');
    });

    document.getElementById('reshuffle-btn').addEventListener('click', () => showConfirm('reshuffle'));
    document.getElementById('reshuffle-cancel').addEventListener('click', () => hideConfirm('reshuffle'));
    document.getElementById('reshuffle-yes').addEventListener('click', () => {
        gameState = createNewState(gameEntries);
        saveState(boardId, gameState);
        renderGrid();
        hideConfirm('reshuffle');
    });

    document.getElementById('back-to-generator-btn').addEventListener('click', () => {
        history.pushState(null, '', location.pathname);
        document.getElementById('player-view').classList.add('hidden');
        document.getElementById('creator-view').classList.remove('hidden');
        startCreatorMode();
    });
}

function showConfirm(type) {
    document.getElementById(`${type}-btn`).classList.add('hidden');
    document.getElementById(`${type}-confirm`).classList.remove('hidden');
}

function hideConfirm(type) {
    document.getElementById(`${type}-btn`).classList.remove('hidden');
    document.getElementById(`${type}-confirm`).classList.add('hidden');
}

// ---- Error ----
function showError(msg) {
    document.getElementById('creator-view').innerHTML = `
        <h1>Bingo</h1>
        <p class="error-msg">${esc(msg)}</p>
        <a href="/games/bingo/" class="btn-primary" style="display:inline-block;text-decoration:none;">Create a Board</a>
    `;
}
