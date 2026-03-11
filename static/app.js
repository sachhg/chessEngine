/* PDSO Dashboard — all frontend logic */

let board = null;
let radarChart = null;
let resultsChart = null;
let ws = null;
let currentMoves = [];

// -- Init --

document.addEventListener('DOMContentLoaded', () => {
    board = Chessboard('board', {
        position: 'start',
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
    });

    document.getElementById('pgn-file').addEventListener('change', onFileSelect);
    document.getElementById('player-name').addEventListener('input', onNameInput);
    document.getElementById('btn-profile').addEventListener('click', runProfile);
    document.getElementById('btn-simulate').addEventListener('click', runSimulation);
    document.getElementById('btn-demo').addEventListener('click', loadDemo);
});

// -- PGN profiling --

function onFileSelect() {
    toggleProfileBtn();
}

function onNameInput() {
    toggleProfileBtn();
}

function toggleProfileBtn() {
    const hasFile = document.getElementById('pgn-file').files.length > 0;
    const hasName = document.getElementById('player-name').value.trim().length > 0;
    document.getElementById('btn-profile').disabled = !(hasFile && hasName);
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

    // Archetype badge
    const badge = document.getElementById('archetype-label');
    badge.textContent = profile.primary_archetype;

    // Meta
    const meta = document.getElementById('profile-meta');
    meta.innerHTML = `${profile.games_analyzed} games analyzed &middot; avg length: ${Math.round(profile.avg_game_length)} moves`;

    // Feature table
    const tbody = document.querySelector('#feature-table tbody');
    tbody.innerHTML = '';
    const labels = {
        material_greed: 'Material Greed',
        sacrifice_rate: 'Sacrifice Rate',
        avg_piece_advancement: 'Piece Activity',
        king_pressure_index: 'King Pressure',
        center_control: 'Center Control',
        pawn_storm_frequency: 'Pawn Storms',
        trade_when_ahead: 'Trades When Ahead',
        complexity_preference: 'Complexity Pref.',
    };
    for (const [key, label] of Object.entries(labels)) {
        const val = profile.raw_features[key];
        if (val === undefined) continue;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${label}</td><td>${val.toFixed(3)}</td>`;
        tbody.appendChild(tr);
    }

    // Radar chart
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
    const featureLabels = [
        'Greed', 'Sacrifice', 'Activity', 'King Pressure',
        'Center', 'Pawn Storm', 'Trade Ahead', 'Complexity',
    ];

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
                pointRadius: 3,
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
                        font: { size: 10, family: "'SF Mono', monospace" },
                    },
                },
            },
            plugins: {
                legend: { display: false },
            },
        },
    });
}

// -- Simulation --

async function runSimulation() {
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
            board.position('start');
            document.getElementById('game-label').textContent =
                `Game ${msg.game_num + 1} — ${msg.archetype} (${msg.condition || ''})`;
            document.getElementById('move-list').innerHTML = '';
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
    if (moveData.fen) {
        board.position(moveData.fen);
    }

    // Eval bar
    const evalCp = moveData.eval || 0;
    const pct = Math.min(Math.max(50 + evalCp / 10, 5), 95);
    document.getElementById('eval-fill').style.width = pct + '%';
    document.getElementById('eval-text').textContent = (evalCp / 100).toFixed(1);

    // Phase
    document.getElementById('phase-text').textContent = moveData.phase || '—';
    document.getElementById('move-counter').textContent = moveData.move_num || currentMoves.length;

    // Move list
    appendMove(moveData);
}

function appendMove(moveData) {
    const list = document.getElementById('move-list');
    const moveNum = Math.floor(currentMoves.length / 2) + 1;
    const isWhite = currentMoves.length % 2 === 1;

    if (isWhite) {
        list.innerHTML += `<span class="move-num">${moveNum}.</span>`;
    }
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
    for (const p of entries) {
        totalDone += p.completed;
        totalAll += p.total;
    }

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
}

function showProgressBar() {
    document.getElementById('progress-bar-container').classList.remove('hidden');
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-text').textContent = 'Starting...';
}

function hideProgressBar() {
    document.getElementById('progress-bar-container').classList.add('hidden');
}
