/* PDSO Dashboard — all frontend logic */

let board = null;
let radarChart = null;
let resultsChart = null;
let ws = null;
let currentMoves = [];

// -- Playback state --
let presetGames = [];
let playbackMoves = [];   // full move list for current game
let playbackIndex = -1;   // current position (-1 = start)
let playbackTimer = null;
let playbackSpeed = 1.0;  // seconds per move
let isPlaying = false;

// -- Metrics state --
const ARCHETYPE_COLORS = {
    aggressive: '#e94560',
    materialistic: '#f0c040',
    positional: '#4ecca3',
    tactical: '#a855f7',
    passive: '#8892a0',
};
let evalHistory = [];
let sparklineChart = null;
let currentGameMeta = null;

// -- Archetype centroids for classification --
const CENTROIDS = {
    aggressive: {
        name: 'Aggressive', color: '#e94560',
        values: { material_greed: 0.21, sacrifice_rate: 0.005, avg_piece_advancement: 0.22, king_pressure_index: 0.11, center_control: 0.42, pawn_storm_frequency: 0.13, trade_when_ahead: 0.00, complexity_preference: 0.40 }
    },
    materialistic: {
        name: 'Materialistic', color: '#f0c040',
        values: { material_greed: 0.20, sacrifice_rate: 0.000, avg_piece_advancement: 0.25, king_pressure_index: 0.14, center_control: 0.32, pawn_storm_frequency: 0.09, trade_when_ahead: 0.00, complexity_preference: 0.38 }
    },
    positional: {
        name: 'Positional', color: '#4ecca3',
        values: { material_greed: 0.16, sacrifice_rate: 0.000, avg_piece_advancement: 0.25, king_pressure_index: 0.07, center_control: 0.44, pawn_storm_frequency: 0.11, trade_when_ahead: 0.00, complexity_preference: 0.28 }
    },
    tactical: {
        name: 'Tactical', color: '#a855f7',
        values: { material_greed: 0.17, sacrifice_rate: 0.000, avg_piece_advancement: 0.30, king_pressure_index: 0.16, center_control: 0.29, pawn_storm_frequency: 0.04, trade_when_ahead: 0.05, complexity_preference: 0.37 }
    },
    passive: {
        name: 'Passive', color: '#8892a0',
        values: { material_greed: 0.10, sacrifice_rate: 0.000, avg_piece_advancement: 0.12, king_pressure_index: 0.01, center_control: 0.28, pawn_storm_frequency: 0.10, trade_when_ahead: 0.00, complexity_preference: 0.16 }
    },
};

const FEATURE_KEYS = [
    'material_greed', 'sacrifice_rate', 'avg_piece_advancement',
    'king_pressure_index', 'center_control', 'pawn_storm_frequency',
    'trade_when_ahead', 'complexity_preference',
];
const FEATURE_LABELS = {
    material_greed: 'Greed',
    sacrifice_rate: 'Sacrifice',
    avg_piece_advancement: 'Activity',
    king_pressure_index: 'King Press.',
    center_control: 'Center',
    pawn_storm_frequency: 'Pawn Storm',
    trade_when_ahead: 'Trade Ahead',
    complexity_preference: 'Complexity',
};

// -- Init --

document.addEventListener('DOMContentLoaded', () => {
    try {
        board = Chessboard('board', {
            position: 'start',
            pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
        });
    } catch (e) {
        console.warn('Board init deferred:', e.message);
    }

    const el = (id) => document.getElementById(id);

    if (el('pgn-file')) el('pgn-file').addEventListener('change', onFileSelect);
    if (el('player-name')) el('player-name').addEventListener('input', onNameInput);
    if (el('btn-profile')) el('btn-profile').addEventListener('click', runProfile);
    if (el('btn-simulate')) el('btn-simulate').addEventListener('click', runSimulation);
    if (el('btn-demo')) el('btn-demo').addEventListener('click', loadDemo);

    // Playback controls
    if (el('btn-play')) el('btn-play').addEventListener('click', togglePlay);
    if (el('btn-back')) el('btn-back').addEventListener('click', stepBack);
    if (el('btn-forward')) el('btn-forward').addEventListener('click', stepForward);
    if (el('btn-start')) el('btn-start').addEventListener('click', goToStart);
    if (el('btn-end')) el('btn-end').addEventListener('click', goToEnd);
    if (el('speed-slider')) el('speed-slider').addEventListener('input', onSpeedChange);
    if (el('move-scrubber')) el('move-scrubber').addEventListener('input', onScrub);

    // Load presets and auto-show banner
    loadPresets();
});

// -- Preset loading --

async function loadPresets() {
    try {
        const resp = await fetch('/presets.json');
        if (!resp.ok) return;
        presetGames = await resp.json();
        if (presetGames.length > 0) {
            showPresetBanner();
        }
    } catch (e) {
        // No presets available
    }
}

function showPresetBanner() {
    const banner = document.getElementById('preset-banner');
    const list = document.getElementById('preset-list');
    if (!banner || !list || presetGames.length === 0) return;

    list.innerHTML = '';
    presetGames.forEach((game, i) => {
        const card = document.createElement('button');
        card.className = 'preset-card';
        card.dataset.index = i;
        const resultTag = game.adaptive_won ? 'win' : (game.result === '1/2-1/2' ? 'draw' : 'loss');
        card.innerHTML = `
            <span class="preset-archetype">${game.archetype}</span>
            <span class="preset-meta">${game.condition} &middot; ${game.num_moves} moves</span>
            <span class="preset-result preset-${resultTag}">${game.result}</span>
        `;
        card.addEventListener('click', () => startPresetGame(i));
        list.appendChild(card);
    });

    banner.classList.remove('hidden');
}

// Legacy function — kept for index.html narrative page compatibility
function showPresetPicker() {
    // Try the new banner first (dashboard page)
    if (document.getElementById('preset-banner')) {
        showPresetBanner();
        return;
    }
    // Fallback: old picker inside game-panel (narrative page)
    const picker = document.getElementById('preset-picker');
    const list = document.getElementById('preset-list');
    if (!picker || !list || presetGames.length === 0) return;

    list.innerHTML = '';
    presetGames.forEach((game, i) => {
        const card = document.createElement('button');
        card.className = 'preset-card';
        card.dataset.index = i;
        const resultTag = game.adaptive_won ? 'win' : (game.result === '1/2-1/2' ? 'draw' : 'loss');
        card.innerHTML = `
            <span class="preset-archetype">${game.archetype}</span>
            <span class="preset-meta">${game.condition} &middot; ${game.num_moves} moves</span>
            <span class="preset-result preset-${resultTag}">${game.result}</span>
        `;
        card.addEventListener('click', () => startPresetGame(i));
        list.appendChild(card);
    });

    const gameEmpty = document.getElementById('game-empty');
    if (gameEmpty) gameEmpty.classList.add('hidden');
    picker.classList.remove('hidden');
}

function startPresetGame(index) {
    const game = presetGames[index];
    if (!game || !game.moves || game.moves.length === 0) return;

    // Stop any current playback
    stopPlayback();

    // Highlight active card in banner
    document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('preset-card-active'));
    const activeCard = document.querySelector(`.preset-card[data-index="${index}"]`);
    if (activeCard) activeCard.classList.add('preset-card-active');

    // Show game panel
    showGamePanel();

    // Set game metadata
    currentGameMeta = {
        archetype: game.archetype,
        condition: game.condition,
        result: game.result,
        adaptive_won: game.adaptive_won,
    };

    // Set label
    const label = document.getElementById('game-label');
    if (label) label.textContent = `${game.archetype} (${game.condition}) — ${game.result}`;

    // Set opponent archetype metric
    const archEl = document.getElementById('opponent-archetype');
    if (archEl) {
        archEl.textContent = game.archetype;
        archEl.style.background = (ARCHETYPE_COLORS[game.archetype] || '#8892a0') + '22';
        archEl.style.color = ARCHETYPE_COLORS[game.archetype] || '#8892a0';
    }

    // Load moves for playback
    playbackMoves = game.moves;
    playbackIndex = -1;

    // Reset board
    board.position('start');
    document.getElementById('move-list').innerHTML = '';
    resetEvalDisplay();
    resetMetrics();

    // Reset sparkline
    evalHistory = [];
    initSparkline();

    // Setup scrubber
    const scrubber = document.getElementById('move-scrubber');
    if (scrubber) {
        scrubber.max = playbackMoves.length;
        scrubber.value = 0;
    }

    // Show playback controls
    const controls = document.getElementById('playback-controls');
    if (controls) controls.classList.remove('hidden');

    // Show and reset feature cards
    showFeatureCards();
    resetFeatureCards();

    updatePlaybackButtons();
}

// -- Sparkline chart --

function initSparkline() {
    const canvas = document.getElementById('eval-sparkline');
    if (!canvas) return;

    if (sparklineChart) {
        sparklineChart.destroy();
        sparklineChart = null;
    }

    const ctx = canvas.getContext('2d');
    sparklineChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                data: [],
                borderColor: '#4ecca3',
                borderWidth: 1.5,
                pointRadius: 0,
                tension: 0.2,
                fill: {
                    target: { value: 0 },
                    above: 'rgba(78, 204, 163, 0.15)',
                    below: 'rgba(233, 69, 96, 0.15)',
                },
                segment: {
                    borderColor: function(ctx) {
                        return ctx.p1.parsed.y >= 0 ? '#4ecca3' : '#e94560';
                    },
                },
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: {
                    display: false,
                },
                y: {
                    display: true,
                    position: 'right',
                    grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
                    ticks: {
                        color: '#8892a0',
                        font: { size: 9, family: "'SF Mono', monospace" },
                        callback: (v) => (v / 100).toFixed(0),
                        maxTicksLimit: 5,
                    },
                },
            },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false },
            },
        },
    });
}

function updateSparkline() {
    if (!sparklineChart) return;
    sparklineChart.data.labels = evalHistory.map((_, i) => i + 1);
    sparklineChart.data.datasets[0].data = evalHistory.map(e => e.eval);
    sparklineChart.update('none');
}

// -- Playback engine --

function togglePlay() {
    if (isPlaying) {
        stopPlayback();
    } else {
        if (playbackIndex >= playbackMoves.length - 1) {
            goToStart();
        }
        startPlayback();
    }
}

function startPlayback() {
    isPlaying = true;
    updatePlayButton();
    scheduleNextMove();
}

function stopPlayback() {
    isPlaying = false;
    if (playbackTimer) {
        clearTimeout(playbackTimer);
        playbackTimer = null;
    }
    updatePlayButton();
}

function scheduleNextMove() {
    if (!isPlaying) return;
    if (playbackIndex >= playbackMoves.length - 1) {
        stopPlayback();
        return;
    }
    playbackTimer = setTimeout(() => {
        stepForward();
        scheduleNextMove();
    }, playbackSpeed * 1000);
}

function stepForward() {
    if (playbackIndex >= playbackMoves.length - 1) return;
    playbackIndex++;
    showMoveAtIndex(playbackIndex);
    syncScrubber();
    updatePlaybackButtons();
}

function stepBack() {
    if (playbackIndex < 0) return;
    playbackIndex--;
    rebuildBoardToIndex(playbackIndex);
    syncScrubber();
    updatePlaybackButtons();
}

function goToStart() {
    stopPlayback();
    playbackIndex = -1;
    board.position('start');
    document.getElementById('move-list').innerHTML = '';
    resetEvalDisplay();
    resetMetrics();
    resetFeatureCards();
    evalHistory = [];
    updateSparkline();
    syncScrubber();
    updatePlaybackButtons();
}

function goToEnd() {
    stopPlayback();
    rebuildBoardToIndex(playbackMoves.length - 1);
    syncScrubber();
    updatePlaybackButtons();
}

function onScrub() {
    const scrubber = document.getElementById('move-scrubber');
    if (!scrubber) return;
    const target = parseInt(scrubber.value) - 1;
    stopPlayback();
    rebuildBoardToIndex(target);
    updatePlaybackButtons();
}

function onSpeedChange() {
    const slider = document.getElementById('speed-slider');
    const display = document.getElementById('speed-display');
    if (!slider) return;

    const val = parseInt(slider.value);
    const speeds = [2.0, 1.5, 1.2, 1.0, 0.8, 0.6, 0.4, 0.25, 0.15, 0.08];
    playbackSpeed = speeds[val - 1] || 1.0;

    if (display) display.textContent = val <= 3 ? 'Slow' : val <= 7 ? (val === 5 ? '1.0x' : 'Fast') : 'Blitz';
}

function showMoveAtIndex(idx) {
    const move = playbackMoves[idx];
    if (!move) return;

    // Update board position
    if (move.fen) board.position(move.fen);

    // Update eval bar
    const evalCp = move.eval || 0;
    const pct = Math.min(Math.max(50 + evalCp / 10, 5), 95);
    document.getElementById('eval-fill').style.width = pct + '%';
    document.getElementById('eval-text').textContent = (evalCp / 100).toFixed(1);

    // Phase with colored dot
    const phaseEl = document.getElementById('phase-text');
    if (phaseEl) {
        const phase = move.phase || '—';
        const dotClass = phase === 'opening' ? 'phase-opening' : phase === 'midgame' ? 'phase-midgame' : phase === 'endgame' ? 'phase-endgame' : '';
        phaseEl.innerHTML = dotClass ? `<span class="phase-dot ${dotClass}"></span>${phase}` : phase;
    }

    // Move counter
    document.getElementById('move-counter').textContent = Math.floor(idx / 2) + 1;

    // Side indicator
    const sideEl = document.getElementById('side-text');
    if (sideEl && move.side) {
        const isAdaptive = move.side === 'adaptive';
        sideEl.textContent = isAdaptive ? 'Adaptive' : 'Proxy';
        sideEl.className = 'metric-value ' + (isAdaptive ? 'side-adaptive' : 'side-proxy');
    }

    // Eval history + sparkline
    evalHistory.push({ move: idx, eval: evalCp });
    updateSparkline();

    // Update feature cards
    if (move.white_features) updateFeatureCard('white', move.white_features);
    if (move.black_features) updateFeatureCard('black', move.black_features);

    // Append move to list
    const list = document.getElementById('move-list');
    const moveNum = Math.floor(idx / 2) + 1;
    const isWhite = idx % 2 === 0;
    if (isWhite) list.innerHTML += `<span class="move-num">${moveNum}.</span>`;
    list.innerHTML += `<span class="san">${move.san}</span> `;
    list.scrollTop = list.scrollHeight;
}

function rebuildBoardToIndex(targetIdx) {
    document.getElementById('move-list').innerHTML = '';

    if (targetIdx < 0) {
        board.position('start');
        playbackIndex = -1;
        resetEvalDisplay();
        resetMetrics();
        resetFeatureCards();
        evalHistory = [];
        updateSparkline();
        return;
    }

    playbackIndex = targetIdx;

    // Show final position
    const finalMove = playbackMoves[targetIdx];
    if (finalMove && finalMove.fen) board.position(finalMove.fen);

    // Rebuild move list
    const list = document.getElementById('move-list');
    for (let i = 0; i <= targetIdx; i++) {
        const m = playbackMoves[i];
        const moveNum = Math.floor(i / 2) + 1;
        if (i % 2 === 0) list.innerHTML += `<span class="move-num">${moveNum}.</span>`;
        list.innerHTML += `<span class="san">${m.san}</span> `;
    }
    list.scrollTop = list.scrollHeight;

    // Update eval display
    const evalCp = finalMove?.eval || 0;
    const pct = Math.min(Math.max(50 + evalCp / 10, 5), 95);
    document.getElementById('eval-fill').style.width = pct + '%';
    document.getElementById('eval-text').textContent = (evalCp / 100).toFixed(1);

    // Phase with dot
    const phaseEl = document.getElementById('phase-text');
    if (phaseEl) {
        const phase = finalMove?.phase || '—';
        const dotClass = phase === 'opening' ? 'phase-opening' : phase === 'midgame' ? 'phase-midgame' : phase === 'endgame' ? 'phase-endgame' : '';
        phaseEl.innerHTML = dotClass ? `<span class="phase-dot ${dotClass}"></span>${phase}` : phase;
    }

    document.getElementById('move-counter').textContent = Math.floor(targetIdx / 2) + 1;

    // Side
    const sideEl = document.getElementById('side-text');
    if (sideEl && finalMove?.side) {
        const isAdaptive = finalMove.side === 'adaptive';
        sideEl.textContent = isAdaptive ? 'Adaptive' : 'Proxy';
        sideEl.className = 'metric-value ' + (isAdaptive ? 'side-adaptive' : 'side-proxy');
    }

    // Rebuild eval history
    evalHistory = [];
    for (let i = 0; i <= targetIdx; i++) {
        evalHistory.push({ move: i, eval: playbackMoves[i]?.eval || 0 });
    }
    updateSparkline();

    // Update feature cards to target position
    if (finalMove?.white_features) updateFeatureCard('white', finalMove.white_features);
    if (finalMove?.black_features) updateFeatureCard('black', finalMove.black_features);
}

function syncScrubber() {
    const scrubber = document.getElementById('move-scrubber');
    if (scrubber) scrubber.value = playbackIndex + 1;
}

function updatePlayButton() {
    const btn = document.getElementById('btn-play');
    if (btn) btn.innerHTML = isPlaying ? '&#x23F8;' : '&#x25B6;';
}

function updatePlaybackButtons() {
    const btnBack = document.getElementById('btn-back');
    const btnStart = document.getElementById('btn-start');
    const btnForward = document.getElementById('btn-forward');
    const btnEnd = document.getElementById('btn-end');

    const atStart = playbackIndex < 0;
    const atEnd = playbackIndex >= playbackMoves.length - 1;

    if (btnBack) btnBack.disabled = atStart;
    if (btnStart) btnStart.disabled = atStart;
    if (btnForward) btnForward.disabled = atEnd;
    if (btnEnd) btnEnd.disabled = atEnd;
}

function resetEvalDisplay() {
    const evalFill = document.getElementById('eval-fill');
    const evalText = document.getElementById('eval-text');
    const phaseText = document.getElementById('phase-text');
    const moveCounter = document.getElementById('move-counter');

    if (evalFill) evalFill.style.width = '50%';
    if (evalText) evalText.textContent = '0.0';
    if (phaseText) phaseText.textContent = '—';
    if (moveCounter) moveCounter.textContent = '0';
}

function resetMetrics() {
    const sideEl = document.getElementById('side-text');
    if (sideEl) {
        sideEl.textContent = '—';
        sideEl.className = 'metric-value';
    }
}

// -- PGN profiling --

function onFileSelect() { toggleProfileBtn(); }
function onNameInput() { toggleProfileBtn(); }

function toggleProfileBtn() {
    const fileEl = document.getElementById('pgn-file');
    const nameEl = document.getElementById('player-name');
    const btnEl = document.getElementById('btn-profile');
    if (!fileEl || !nameEl || !btnEl) return;
    const hasFile = fileEl.files.length > 0;
    const hasName = nameEl.value.trim().length > 0;
    btnEl.disabled = !(hasFile && hasName);
}

async function runProfile() {
    const fileInput = document.getElementById('pgn-file');
    const name = document.getElementById('player-name').value.trim();
    if (!fileInput.files[0] || !name) return;

    const btn = document.getElementById('btn-profile');
    btn.disabled = true;
    btn.textContent = 'Analyzing...';

    const form = new FormData();
    form.append('file', fileInput.files[0]);

    try {
        const resp = await fetch(`/api/profile?player_name=${encodeURIComponent(name)}&quick=true`, {
            method: 'POST',
            body: form,
        });
        const data = await resp.json();

        if (resp.ok) {
            displayProfile(data);
        } else {
            alert(data.error || 'Profile analysis failed');
        }
    } catch (e) {
        alert('Request failed: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Analyze';
    }
}

function displayProfile(profile) {
    document.getElementById('profile-empty').classList.add('hidden');
    document.getElementById('profile-content').classList.remove('hidden');

    const badge = document.getElementById('archetype-label');
    badge.textContent = profile.primary_archetype;

    const meta = document.getElementById('profile-meta');
    meta.innerHTML = `${profile.games_analyzed} games &middot; avg ${Math.round(profile.avg_game_length)} moves`;

    const tbody = document.querySelector('#feature-table tbody');
    tbody.innerHTML = '';
    const labels = {
        material_greed: 'Greed',
        sacrifice_rate: 'Sacrifice',
        avg_piece_advancement: 'Activity',
        king_pressure_index: 'K. Pressure',
        center_control: 'Center',
        pawn_storm_frequency: 'Pawn Storm',
        trade_when_ahead: 'Trade Ahead',
        complexity_preference: 'Complexity',
    };
    for (const [key, label] of Object.entries(labels)) {
        const val = profile.raw_features[key];
        if (val === undefined) continue;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${label}</td><td>${val.toFixed(3)}</td>`;
        tbody.appendChild(tr);
    }

    drawRadarChart(profile);
}

function drawRadarChart(profile) {
    const ctx = document.getElementById('radar-chart').getContext('2d');
    if (radarChart) radarChart.destroy();

    const featureKeys = [
        'material_greed', 'sacrifice_rate', 'avg_piece_advancement',
        'king_pressure_index', 'center_control', 'pawn_storm_frequency',
        'trade_when_ahead', 'complexity_preference',
    ];
    const featureLabels = ['Greed', 'Sacrifice', 'Activity', 'K.Press', 'Center', 'P.Storm', 'Trade', 'Complex'];
    const playerData = featureKeys.map(k => profile.raw_features[k] || 0);

    radarChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: featureLabels,
            datasets: [{
                label: profile.player_name || 'Player',
                data: playerData,
                borderColor: '#e94560',
                backgroundColor: 'rgba(233, 69, 96, 0.15)',
                pointBackgroundColor: '#e94560',
                borderWidth: 2,
                pointRadius: 2,
            }],
        },
        options: {
            responsive: false,
            scales: {
                r: {
                    min: 0, max: 1,
                    ticks: { display: false },
                    grid: { color: 'rgba(255,255,255,0.08)' },
                    angleLines: { color: 'rgba(255,255,255,0.08)' },
                    pointLabels: {
                        color: '#8892a0',
                        font: { size: 8, family: "'SF Mono', monospace" },
                    },
                },
            },
            plugins: { legend: { display: false } },
        },
    });
}

// -- Simulation --

async function runSimulation() {
    // Always run live simulation from sidebar
    runLiveSimulation();
}

async function runLiveSimulation() {
    const archetype = document.getElementById('sim-archetype').value;
    const numGames = parseInt(document.getElementById('sim-games').value) || 5;

    const btn = document.getElementById('btn-simulate');
    btn.disabled = true;
    btn.textContent = 'Starting...';

    try {
        const params = new URLSearchParams({ num_games: numGames, time_per_move: 0.3 });
        if (archetype) params.set('archetype', archetype);

        const resp = await fetch(`/api/simulate?${params}`, { method: 'POST' });
        const data = await resp.json();

        if (!resp.ok) {
            alert(data.error || 'Failed to start simulation');
            return;
        }

        const controls = document.getElementById('playback-controls');
        if (controls) controls.classList.add('hidden');

        // Reset sparkline for live mode
        evalHistory = [];
        initSparkline();

        showGamePanel();
        showProgressBar();
        connectWs(data.sim_id);
        pollSimulation(data.sim_id);
    } catch (e) {
        alert('Request failed: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Run Simulation';
    }
}

function connectWs(simId) {
    if (ws) ws.close();

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws/game/${simId}`);

    ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data);
        handleWsMessage(msg);
    };

    ws.onclose = () => { ws = null; };
}

function handleWsMessage(msg) {
    switch (msg.type) {
        case 'game_start':
            currentMoves = [];
            evalHistory = [];
            if (sparklineChart) updateSparkline();
            board.position('start');
            document.getElementById('game-label').textContent =
                `Game ${msg.game_num + 1} — ${msg.archetype} (${msg.condition || ''})`;
            document.getElementById('move-list').innerHTML = '';

            // Set opponent archetype for live sim
            const archEl = document.getElementById('opponent-archetype');
            if (archEl) {
                archEl.textContent = msg.archetype || '—';
                archEl.style.background = (ARCHETYPE_COLORS[msg.archetype] || '#8892a0') + '22';
                archEl.style.color = ARCHETYPE_COLORS[msg.archetype] || '#8892a0';
            }
            break;

        case 'move':
            updateBoard(msg);
            break;

        case 'game_end':
            appendToMoveList(` [${msg.result}]`);
            break;

        case 'sim_end':
            if (msg.results) displayResults(msg.results);
            hideProgressBar();
            break;

        case 'matchup_start':
            document.getElementById('progress-text').textContent =
                `${msg.archetype} — ${msg.condition}`;
            break;
    }
}

function updateBoard(moveData) {
    currentMoves.push(moveData);
    if (moveData.fen) board.position(moveData.fen);

    // Eval bar
    const evalCp = moveData.eval || 0;
    const pct = Math.min(Math.max(50 + evalCp / 10, 5), 95);
    document.getElementById('eval-fill').style.width = pct + '%';
    document.getElementById('eval-text').textContent = (evalCp / 100).toFixed(1);

    // Phase
    const phaseEl = document.getElementById('phase-text');
    if (phaseEl) {
        const phase = moveData.phase || '—';
        const dotClass = phase === 'opening' ? 'phase-opening' : phase === 'midgame' ? 'phase-midgame' : phase === 'endgame' ? 'phase-endgame' : '';
        phaseEl.innerHTML = dotClass ? `<span class="phase-dot ${dotClass}"></span>${phase}` : phase;
    }

    document.getElementById('move-counter').textContent = moveData.move_num || currentMoves.length;

    // Side
    const sideEl = document.getElementById('side-text');
    if (sideEl && moveData.side) {
        const isAdaptive = moveData.side === 'adaptive';
        sideEl.textContent = isAdaptive ? 'Adaptive' : 'Proxy';
        sideEl.className = 'metric-value ' + (isAdaptive ? 'side-adaptive' : 'side-proxy');
    }

    // Sparkline
    evalHistory.push({ move: currentMoves.length, eval: evalCp });
    updateSparkline();

    appendMove(moveData);
}

function appendMove(moveData) {
    const list = document.getElementById('move-list');
    const moveNum = Math.floor(currentMoves.length / 2) + 1;
    const isWhite = currentMoves.length % 2 === 1;

    if (isWhite) list.innerHTML += `<span class="move-num">${moveNum}.</span>`;
    list.innerHTML += `<span class="san">${moveData.san}</span> `;
    list.scrollTop = list.scrollHeight;
}

function appendToMoveList(text) {
    document.getElementById('move-list').innerHTML += `<span class="muted">${text}</span>`;
}

async function pollSimulation(simId) {
    const poll = async () => {
        try {
            const resp = await fetch(`/api/simulate/${simId}`);
            const data = await resp.json();
            if (data.progress) updateProgress(data.progress);
            if (data.status === 'completed') {
                if (data.results) displayResults(data.results);
                hideProgressBar();
                return;
            }
        } catch (e) { /* ignore */ }
        setTimeout(poll, 2000);
    };
    poll();
}

function updateProgress(progress) {
    const entries = Object.values(progress);
    if (!entries.length) return;
    let totalDone = 0, totalAll = 0;
    for (const p of entries) { totalDone += p.completed; totalAll += p.total; }
    const pct = totalAll > 0 ? (totalDone / totalAll * 100) : 0;
    document.getElementById('progress-fill').style.width = pct + '%';
}

// -- Demo mode --

async function loadDemo() {
    const btn = document.getElementById('btn-demo');
    btn.disabled = true;
    btn.textContent = 'Loading...';

    try {
        const resp = await fetch('/api/demo-results');
        if (!resp.ok) {
            const allResp = await fetch('/api/results');
            const allResults = await allResp.json();
            if (allResults.length > 0) {
                const detailResp = await fetch(`/api/results/${allResults[0].sim_id}`);
                const detail = await detailResp.json();
                displayResults(detail);
            } else {
                alert('No cached results available. Run a simulation first.');
            }
            return;
        }
        const data = await resp.json();
        displayResults(data);
    } catch (e) {
        alert('Failed to load demo: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Demo Mode';
    }
}

// -- Results display --

function displayResults(results) {
    document.getElementById('results-empty').classList.add('hidden');
    document.getElementById('results-content').classList.remove('hidden');

    const matchups = results.matchups || {};
    const archetypes = Object.keys(matchups);

    drawResultsChart(matchups, archetypes);
    fillResultsTable(matchups, archetypes);
    writeSummary(matchups, archetypes, results);
}

function drawResultsChart(matchups, archetypes) {
    const ctx = document.getElementById('results-chart').getContext('2d');
    if (resultsChart) resultsChart.destroy();

    const adaptiveScores = archetypes.map(a => matchups[a]?.adaptive?.score ?? 0);
    const baselineScores = archetypes.map(a => matchups[a]?.baseline?.score ?? 0);

    resultsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: archetypes.map(a => a.charAt(0).toUpperCase() + a.slice(1)),
            datasets: [
                {
                    label: 'Adaptive',
                    data: adaptiveScores,
                    backgroundColor: 'rgba(78, 204, 163, 0.7)',
                    borderColor: '#4ecca3',
                    borderWidth: 1,
                },
                {
                    label: 'Baseline',
                    data: baselineScores,
                    backgroundColor: 'rgba(233, 69, 96, 0.5)',
                    borderColor: '#e94560',
                    borderWidth: 1,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    min: 0, max: 1,
                    title: { display: true, text: 'Score', color: '#8892a0', font: { size: 11 } },
                    ticks: { color: '#8892a0', font: { size: 10 } },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                },
                x: {
                    ticks: { color: '#8892a0', font: { size: 10 } },
                    grid: { display: false },
                },
            },
            plugins: {
                legend: {
                    labels: { color: '#e0e0e0', font: { size: 11, family: "'SF Mono', monospace" } },
                },
            },
        },
    });
}

function fillResultsTable(matchups, archetypes) {
    const tbody = document.querySelector('#results-table tbody');
    tbody.innerHTML = '';

    for (const arch of archetypes) {
        const m = matchups[arch];
        const aScore = m?.adaptive?.score ?? 0;
        const bScore = m?.baseline?.score ?? 0;
        const delta = m?.improvement?.score_delta ?? (aScore - bScore);
        const eloDiff = m?.improvement?.elo_diff_estimate ?? 0;
        const deltaClass = delta > 0.01 ? 'delta-positive' : delta < -0.01 ? 'delta-negative' : 'delta-neutral';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${arch.charAt(0).toUpperCase() + arch.slice(1)}</td>
            <td>${aScore.toFixed(2)}</td>
            <td>${bScore.toFixed(2)}</td>
            <td class="${deltaClass}">${delta > 0 ? '+' : ''}${delta.toFixed(2)}</td>
            <td class="${deltaClass}">${eloDiff > 0 ? '+' : ''}${eloDiff.toFixed(0)}</td>
        `;
        tbody.appendChild(tr);
    }
}

function writeSummary(matchups, archetypes, results) {
    const div = document.getElementById('summary-text');
    const totalArchetypes = archetypes.length;
    let improved = 0, totalDelta = 0;

    for (const arch of archetypes) {
        const delta = matchups[arch]?.improvement?.score_delta ?? 0;
        totalDelta += delta;
        if (delta > 0) improved++;
    }

    const avgDelta = totalDelta / totalArchetypes;
    const config = results.config || {};
    const gpm = config.games_per_matchup || '?';

    div.innerHTML = `
        Adaptation improved score in <strong>${improved}/${totalArchetypes}</strong> matchups.<br>
        Average score delta: <strong class="${avgDelta > 0 ? 'delta-positive' : 'delta-negative'}">${avgDelta > 0 ? '+' : ''}${avgDelta.toFixed(3)}</strong><br>
        Games per matchup: ${gpm} &middot; Timestamp: ${results.timestamp || '—'}
    `;
}

// -- UI helpers --

function showGamePanel() {
    document.getElementById('game-empty').classList.add('hidden');
    document.getElementById('game-content').classList.remove('hidden');

    if (!board) {
        try {
            board = Chessboard('board', {
                position: 'start',
                pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
            });
        } catch (e) {
            console.warn('Board init failed:', e.message);
        }
    }
}

function showProgressBar() {
    document.getElementById('progress-bar-container').classList.remove('hidden');
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-text').textContent = 'Starting...';
}

function hideProgressBar() {
    document.getElementById('progress-bar-container').classList.add('hidden');
}

// ========================================
// Feature Cards (flanking the board)
// ========================================

function initFeatureCards() {
    ['white', 'black'].forEach(side => {
        const container = document.getElementById(`${side}-sliders`);
        if (!container || container.children.length > 0) return;

        FEATURE_KEYS.forEach(feat => {
            const row = document.createElement('div');
            row.className = 'slider-row';

            const label = document.createElement('label');
            label.textContent = FEATURE_LABELS[feat];

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = '1';
            slider.step = '0.001';
            slider.value = '0';
            slider.disabled = true;
            slider.dataset.feature = feat;

            const valSpan = document.createElement('span');
            valSpan.className = 'slider-val';
            valSpan.textContent = '—';

            row.appendChild(label);
            row.appendChild(slider);
            row.appendChild(valSpan);
            container.appendChild(row);
        });
    });
}

function classifyFeatures(features) {
    if (!features) return { best: null, distances: {} };

    let bestArch = null;
    let bestDist = Infinity;
    const distances = {};

    Object.keys(CENTROIDS).forEach(key => {
        const centroid = CENTROIDS[key].values;
        let distSq = 0;
        for (const feat of FEATURE_KEYS) {
            const diff = (features[feat] || 0) - (centroid[feat] || 0);
            distSq += diff * diff;
        }
        const dist = Math.sqrt(distSq);
        distances[key] = dist;
        if (dist < bestDist) {
            bestDist = dist;
            bestArch = key;
        }
    });

    return { best: bestArch, distances };
}

function updateFeatureCard(side, features) {
    const card = document.getElementById(`${side}-features-card`);
    if (!card) return;

    // Update sliders
    const sliders = document.querySelectorAll(`#${side}-sliders input[type="range"]`);
    sliders.forEach(slider => {
        const feat = slider.dataset.feature;
        const val = features ? (features[feat] || 0) : 0;
        animateSlider(slider, val);
        const valSpan = slider.nextElementSibling;
        if (valSpan) valSpan.textContent = features ? val.toFixed(2) : '—';
    });

    // Classify and update archetype label in the title
    const { best, distances } = classifyFeatures(features);
    const archLabel = document.getElementById(`${side}-archetype-label`);
    if (archLabel) {
        if (best && features) {
            archLabel.textContent = CENTROIDS[best].name;
            archLabel.style.color = CENTROIDS[best].color;
        } else {
            archLabel.textContent = '';
        }
    }

    // Update distance bars (mirrors writeup's ClassifierDemo.classify)
    const distContainer = document.getElementById(`${side}-distances`);
    if (distContainer && features) {
        const archKeys = Object.keys(distances);
        const maxDist = Math.max(...archKeys.map(k => distances[k]), 0.001);

        if (distContainer.children.length === 0) {
            // Build distance bars once — same markup as writeup
            archKeys.forEach(key => {
                const row = document.createElement('div');
                row.className = 'dist-row';
                row.dataset.arch = key;

                const label = document.createElement('span');
                label.className = 'dist-label';
                label.textContent = CENTROIDS[key].name;

                const barWrap = document.createElement('div');
                barWrap.className = 'dist-bar-wrap';

                const fill = document.createElement('div');
                fill.className = 'dist-bar-fill';
                fill.style.background = CENTROIDS[key].color;

                barWrap.appendChild(fill);
                row.appendChild(label);
                row.appendChild(barWrap);
                distContainer.appendChild(row);
            });
        }

        // Update bar widths
        distContainer.querySelectorAll('.dist-row').forEach(row => {
            const key = row.dataset.arch;
            const similarity = maxDist > 0 ? (1 - distances[key] / maxDist) : 0.5;
            const fill = row.querySelector('.dist-bar-fill');
            if (fill) fill.style.width = (similarity * 100).toFixed(0) + '%';
        });
    }
}

function showFeatureCards() {
    const white = document.getElementById('white-features-card');
    const black = document.getElementById('black-features-card');
    if (white) white.classList.remove('hidden');
    if (black) black.classList.remove('hidden');
    initFeatureCards();
}

function hideFeatureCards() {
    const white = document.getElementById('white-features-card');
    const black = document.getElementById('black-features-card');
    if (white) white.classList.add('hidden');
    if (black) black.classList.add('hidden');
}

function resetFeatureCards() {
    updateFeatureCard('white', null);
    updateFeatureCard('black', null);
}

// Animate a range slider value smoothly
function animateSlider(slider, targetVal, duration) {
    duration = duration || 300;
    const startVal = parseFloat(slider.value) || 0;
    const diff = targetVal - startVal;
    if (Math.abs(diff) < 0.001) {
        slider.value = targetVal;
        return;
    }
    const startTime = performance.now();
    function tick(now) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        // ease-out quad
        const eased = t * (2 - t);
        slider.value = startVal + diff * eased;
        if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}
