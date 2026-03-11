// interactive.js — Demo components, lazy-initialized by narrative.js
(function() {
  'use strict';

  var PIECE_THEME = 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png';
  var pieceValues = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

  // ===========================================
  // Piece Value Calculator
  // ===========================================
  var PieceValueDemo = {
    board: null,

    init: function() {
      var container = document.getElementById('eval-board');
      if (!container || this.board) return;

      this.board = Chessboard('eval-board', {
        position: 'start',
        draggable: true,
        dropOffBoard: 'trash',
        sparePieces: false,
        pieceTheme: PIECE_THEME,
        onChange: this.recalculate.bind(this),
      });

      var self = this;
      var btn = document.getElementById('reset-eval-board');
      if (btn) {
        btn.addEventListener('click', function() {
          self.board.start();
          self.recalculate();
        });
      }
      this.recalculate();
    },

    recalculate: function(oldPos, newPos) {
      var pos = newPos || (this.board ? this.board.position() : {});
      var white = 0, black = 0;
      for (var sq in pos) {
        var piece = pos[sq];
        var val = pieceValues[piece[1].toLowerCase()] || 0;
        if (piece[0] === 'w') white += val;
        else black += val;
      }
      var wEl = document.getElementById('white-material');
      var bEl = document.getElementById('black-material');
      var evalEl = document.getElementById('demo-eval-value');
      var fillEl = document.getElementById('demo-eval-fill');

      if (wEl) wEl.textContent = white;
      if (bEl) bEl.textContent = black;

      var diff = (white - black) / 100;
      if (evalEl) evalEl.textContent = (diff >= 0 ? '+' : '') + diff.toFixed(1);

      // Eval bar: 50% = equal, more = white advantage
      var pct = 50 + Math.max(-50, Math.min(50, diff * 5));
      if (fillEl) {
        fillEl.style.width = pct + '%';
        fillEl.style.background = diff >= 0 ? 'var(--accent-green)' : 'var(--accent)';
      }
    }
  };

  // ===========================================
  // Minimax Tree Visualization
  // ===========================================
  var MinimaxTreeDemo = {
    canvas: null,
    ctx: null,
    tree: null,
    nodesExplored: 0,

    init: function() {
      this.canvas = document.getElementById('minimax-canvas');
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');

      var self = this;
      var slider = document.getElementById('depth-slider');
      var display = document.getElementById('depth-display');
      if (slider) {
        slider.addEventListener('input', function() {
          if (display) display.textContent = slider.value;
        });
      }

      var btn = document.getElementById('btn-run-minimax');
      if (btn) {
        btn.addEventListener('click', function() {
          self.run(parseInt(slider ? slider.value : 3));
        });
      }

      this.run(3);
    },

    run: function(depth) {
      this.tree = this.buildTree(depth, 3);
      this.nodesExplored = 0;
      this.minimax(this.tree, depth, true);
      this.render();

      var stats = document.getElementById('minimax-stats');
      if (stats) {
        stats.textContent = 'Nodes explored: ' + this.nodesExplored +
          ' | Tree depth: ' + depth + ' | Branching factor: 3';
      }
    },

    buildTree: function(depth, branching) {
      var node = { value: null, children: [], x: 0, y: 0, explored: false, isMax: (depth % 2 === 0) };
      if (depth === 0) {
        node.value = Math.floor(Math.random() * 20) - 10;
        return node;
      }
      for (var i = 0; i < branching; i++) {
        node.children.push(this.buildTree(depth - 1, branching));
      }
      return node;
    },

    minimax: function(node, depth, maximizing) {
      this.nodesExplored++;
      node.explored = true;
      node.isMax = maximizing;

      if (node.children.length === 0) return node.value;

      if (maximizing) {
        var best = -Infinity;
        for (var i = 0; i < node.children.length; i++) {
          var val = this.minimax(node.children[i], depth - 1, false);
          best = Math.max(best, val);
        }
        node.value = best;
        return best;
      } else {
        var best = Infinity;
        for (var i = 0; i < node.children.length; i++) {
          var val = this.minimax(node.children[i], depth - 1, true);
          best = Math.min(best, val);
        }
        node.value = best;
        return best;
      }
    },

    render: function() {
      var c = this.canvas;
      var ctx = this.ctx;
      var dpr = window.devicePixelRatio || 1;
      c.width = c.offsetWidth * dpr;
      c.height = 400 * dpr;
      ctx.scale(dpr, dpr);

      var w = c.offsetWidth;
      var h = 400;
      ctx.clearRect(0, 0, w, h);

      this.layoutTree(this.tree, 0, w, 30, h);
      this.drawTree(ctx, this.tree);
    },

    layoutTree: function(node, left, right, y, maxH) {
      node.x = (left + right) / 2;
      node.y = y;
      var childCount = node.children.length;
      if (childCount === 0) return;

      var childWidth = (right - left) / childCount;
      var nextY = y + (maxH - 60) / this.getDepth(this.tree);
      for (var i = 0; i < childCount; i++) {
        this.layoutTree(node.children[i], left + i * childWidth, left + (i + 1) * childWidth, nextY, maxH);
      }
    },

    getDepth: function(node) {
      if (node.children.length === 0) return 1;
      return 1 + this.getDepth(node.children[0]);
    },

    drawTree: function(ctx, node) {
      // Draw edges
      for (var i = 0; i < node.children.length; i++) {
        var child = node.children[i];
        ctx.beginPath();
        ctx.moveTo(node.x, node.y);
        ctx.lineTo(child.x, child.y);
        ctx.strokeStyle = child.explored ? '#4a5568' : '#2a3a5c';
        ctx.lineWidth = 1;
        ctx.stroke();
        this.drawTree(ctx, child);
      }

      // Draw node
      var r = 14;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      if (node.isMax) {
        ctx.fillStyle = node.explored ? '#2d6a4f' : '#1a3a2f';
      } else {
        ctx.fillStyle = node.explored ? '#9b2c2c' : '#4a1a1a';
      }
      ctx.fill();
      ctx.strokeStyle = node.explored ? '#e0e0e0' : '#4a5568';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw value
      if (node.value !== null) {
        ctx.fillStyle = '#e0e0e0';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.value, node.x, node.y);
      }
    }
  };

  // ===========================================
  // Alpha-Beta Pruning
  // ===========================================
  var AlphaBetaDemo = {
    canvas: null,
    ctx: null,
    tree: null,
    nodesExplored: 0,
    nodesPruned: 0,

    init: function() {
      this.canvas = document.getElementById('alphabeta-canvas');
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');

      var self = this;
      var slider = document.getElementById('ab-depth-slider');
      var display = document.getElementById('ab-depth-display');
      if (slider) {
        slider.addEventListener('input', function() {
          if (display) display.textContent = slider.value;
        });
      }

      var btn = document.getElementById('btn-run-alphabeta');
      if (btn) {
        btn.addEventListener('click', function() {
          self.run(parseInt(slider ? slider.value : 3));
        });
      }

      var cmpBtn = document.getElementById('btn-compare');
      if (cmpBtn) {
        cmpBtn.addEventListener('click', function() {
          self.compare(parseInt(slider ? slider.value : 3));
        });
      }

      this.run(3);
    },

    run: function(depth) {
      // Use seeded random for reproducibility with minimax comparison
      var seed = 42;
      var rng = function() {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };

      this.tree = this.buildTree(depth, 3, rng);
      this.nodesExplored = 0;
      this.nodesPruned = 0;
      this.alphaBeta(this.tree, depth, true, -Infinity, Infinity);
      this.countPruned(this.tree);
      this.render();
      this.updateStats();
    },

    buildTree: function(depth, branching, rng) {
      var node = { value: null, children: [], x: 0, y: 0, explored: false, pruned: false, isMax: false };
      if (depth === 0) {
        node.value = Math.floor(rng() * 20) - 10;
        return node;
      }
      for (var i = 0; i < branching; i++) {
        node.children.push(this.buildTree(depth - 1, branching, rng));
      }
      return node;
    },

    alphaBeta: function(node, depth, maximizing, alpha, beta) {
      this.nodesExplored++;
      node.explored = true;
      node.isMax = maximizing;

      if (node.children.length === 0) return node.value;

      if (maximizing) {
        var val = -Infinity;
        for (var i = 0; i < node.children.length; i++) {
          val = Math.max(val, this.alphaBeta(node.children[i], depth - 1, false, alpha, beta));
          alpha = Math.max(alpha, val);
          if (alpha >= beta) {
            // Mark remaining children as pruned
            for (var j = i + 1; j < node.children.length; j++) {
              this.markPruned(node.children[j]);
            }
            break;
          }
        }
        node.value = val;
        return val;
      } else {
        var val = Infinity;
        for (var i = 0; i < node.children.length; i++) {
          val = Math.min(val, this.alphaBeta(node.children[i], depth - 1, true, alpha, beta));
          beta = Math.min(beta, val);
          if (alpha >= beta) {
            for (var j = i + 1; j < node.children.length; j++) {
              this.markPruned(node.children[j]);
            }
            break;
          }
        }
        node.value = val;
        return val;
      }
    },

    markPruned: function(node) {
      node.pruned = true;
      for (var i = 0; i < node.children.length; i++) {
        this.markPruned(node.children[i]);
      }
    },

    countPruned: function(node) {
      if (node.pruned) this.nodesPruned++;
      for (var i = 0; i < node.children.length; i++) {
        this.countPruned(node.children[i]);
      }
    },

    countTotal: function(node) {
      var count = 1;
      for (var i = 0; i < node.children.length; i++) {
        count += this.countTotal(node.children[i]);
      }
      return count;
    },

    compare: function(depth) {
      this.run(depth);
      var total = this.countTotal(this.tree);
      var stats = document.getElementById('ab-stats');
      if (stats) {
        var pct = total > 0 ? Math.round((this.nodesPruned / total) * 100) : 0;
        stats.innerHTML = 'Alpha-Beta explored: <strong>' + this.nodesExplored + '</strong> | ' +
          'Pruned: <strong>' + this.nodesPruned + '</strong> (' + pct + '%) | ' +
          'Minimax would explore: <strong>' + total + '</strong>';
      }
    },

    updateStats: function() {
      var total = this.countTotal(this.tree);
      var pct = total > 0 ? Math.round((this.nodesPruned / total) * 100) : 0;
      var stats = document.getElementById('ab-stats');
      if (stats) {
        stats.textContent = 'Nodes explored: ' + this.nodesExplored +
          ' | Pruned: ' + this.nodesPruned + ' (' + pct + '%)';
      }
    },

    render: function() {
      var c = this.canvas;
      var ctx = this.ctx;
      var dpr = window.devicePixelRatio || 1;
      c.width = c.offsetWidth * dpr;
      c.height = 400 * dpr;
      ctx.scale(dpr, dpr);

      var w = c.offsetWidth;
      ctx.clearRect(0, 0, w, 400);

      MinimaxTreeDemo.layoutTree(this.tree, 0, w, 30, 400);
      this.drawTree(ctx, this.tree);
    },

    drawTree: function(ctx, node) {
      for (var i = 0; i < node.children.length; i++) {
        var child = node.children[i];
        ctx.beginPath();
        ctx.moveTo(node.x, node.y);
        ctx.lineTo(child.x, child.y);
        ctx.strokeStyle = child.pruned ? 'rgba(42, 58, 92, 0.3)' : '#4a5568';
        ctx.lineWidth = child.pruned ? 1 : 1;
        ctx.stroke();
        this.drawTree(ctx, child);
      }

      var r = 14;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);

      if (node.pruned) {
        ctx.fillStyle = 'rgba(42, 58, 92, 0.3)';
        ctx.strokeStyle = 'rgba(42, 58, 92, 0.4)';
      } else if (node.isMax) {
        ctx.fillStyle = '#2d6a4f';
        ctx.strokeStyle = '#e0e0e0';
      } else {
        ctx.fillStyle = '#9b2c2c';
        ctx.strokeStyle = '#e0e0e0';
      }
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.stroke();

      if (node.value !== null && !node.pruned) {
        ctx.fillStyle = '#e0e0e0';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.value, node.x, node.y);
      }

      // Pruning indicator
      if (node.pruned && node.children.length === 0) {
        ctx.fillStyle = 'rgba(233, 69, 96, 0.5)';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('x', node.x, node.y);
      }
    }
  };

  // ===========================================
  // NNUE Diagram
  // ===========================================
  var NNUEDemo = {
    init: function() {
      var container = document.getElementById('nnue-diagram');
      if (!container || container.children.length > 0) return;

      var layers = [
        { name: 'Input', count: 24, label: '768 (12x64)' },
        { name: 'Hidden 1', count: 16, label: '256' },
        { name: 'Hidden 2', count: 16, label: '256' },
        { name: 'Output', count: 1, label: '1' },
      ];

      layers.forEach(function(layer, li) {
        if (li > 0) {
          var conn = document.createElement('div');
          conn.className = 'nn-connector';
          container.appendChild(conn);
        }

        var layerEl = document.createElement('div');
        layerEl.className = 'nn-layer';

        var labelEl = document.createElement('div');
        labelEl.className = 'nn-layer-label';
        labelEl.textContent = layer.label;
        layerEl.appendChild(labelEl);

        var nodesEl = document.createElement('div');
        nodesEl.className = 'nn-nodes';

        for (var i = 0; i < layer.count; i++) {
          var node = document.createElement('div');
          node.className = 'nn-node';
          node.dataset.layer = li;
          node.dataset.index = i;

          node.addEventListener('mouseenter', function() {
            // Highlight this node and connected nodes in adjacent layers
            this.classList.add('active');
            var layerIdx = parseInt(this.dataset.layer);
            var allNodes = container.querySelectorAll('.nn-node');
            allNodes.forEach(function(n) {
              var nLayer = parseInt(n.dataset.layer);
              if (nLayer === layerIdx + 1 || nLayer === layerIdx - 1) {
                if (Math.random() > 0.6) n.classList.add('active');
              }
            });
          });

          node.addEventListener('mouseleave', function() {
            container.querySelectorAll('.nn-node').forEach(function(n) {
              n.classList.remove('active');
            });
          });

          nodesEl.appendChild(node);
        }

        // Show "..." for input layer
        if (layer.count < 768 && li === 0) {
          var dots = document.createElement('div');
          dots.style.cssText = 'font-size: 10px; color: var(--text-muted); padding: 4px 0;';
          dots.textContent = '...';
          nodesEl.appendChild(dots);
        }

        layerEl.appendChild(nodesEl);
        container.appendChild(layerEl);
      });
    }
  };

  // ===========================================
  // Archetype Cards
  // ===========================================
  var CENTROIDS = {
    aggressive: {
      name: 'Aggressive', player: 'Inspired by Tal',
      color: '#e94560',
      desc: 'High piece activity, king pressure, and pawn storms. Willing to sacrifice material for attacking chances.',
      values: { material_greed: 0.21, sacrifice_rate: 0.005, avg_piece_advancement: 0.22, king_pressure_index: 0.11, center_control: 0.42, pawn_storm_frequency: 0.13, trade_when_ahead: 0.00, complexity_preference: 0.40 }
    },
    materialistic: {
      name: 'Materialistic', player: 'Inspired by Karpov',
      color: '#f0c040',
      desc: 'Captures everything available. Trades when ahead to convert material advantage into a win.',
      values: { material_greed: 0.20, sacrifice_rate: 0.000, avg_piece_advancement: 0.25, king_pressure_index: 0.14, center_control: 0.32, pawn_storm_frequency: 0.09, trade_when_ahead: 0.00, complexity_preference: 0.38 }
    },
    positional: {
      name: 'Positional', player: 'Inspired by Petrosian',
      color: '#4ecca3',
      desc: 'Focuses on center control and slow maneuvering. Avoids sharp positions, prefers structural advantages.',
      values: { material_greed: 0.16, sacrifice_rate: 0.000, avg_piece_advancement: 0.25, king_pressure_index: 0.07, center_control: 0.44, pawn_storm_frequency: 0.11, trade_when_ahead: 0.00, complexity_preference: 0.28 }
    },
    tactical: {
      name: 'Tactical', player: 'Inspired by Kasparov',
      color: '#a855f7',
      desc: 'Thrives in complex, sharp positions. Pushes pieces forward aggressively and targets the enemy king.',
      values: { material_greed: 0.17, sacrifice_rate: 0.000, avg_piece_advancement: 0.30, king_pressure_index: 0.16, center_control: 0.29, pawn_storm_frequency: 0.04, trade_when_ahead: 0.05, complexity_preference: 0.37 }
    },
    passive: {
      name: 'Passive', player: 'Defensive style',
      color: '#8892a0',
      desc: 'Low piece activity, avoids complications. Keeps pieces back and plays for safety.',
      values: { material_greed: 0.10, sacrifice_rate: 0.000, avg_piece_advancement: 0.12, king_pressure_index: 0.01, center_control: 0.28, pawn_storm_frequency: 0.10, trade_when_ahead: 0.00, complexity_preference: 0.16 }
    }
  };

  var FEATURE_LABELS = {
    material_greed: 'Greed',
    sacrifice_rate: 'Sacrifice',
    avg_piece_advancement: 'Activity',
    king_pressure_index: 'King Press.',
    center_control: 'Center',
    pawn_storm_frequency: 'Pawn Storm',
    trade_when_ahead: 'Trade Ahead',
    complexity_preference: 'Complexity'
  };

  var ArchetypeCards = {
    charts: {},

    init: function() {
      var container = document.getElementById('archetype-cards-container');
      if (!container || container.children.length > 0) return;

      var self = this;
      Object.keys(CENTROIDS).forEach(function(key) {
        var arch = CENTROIDS[key];
        var card = document.createElement('div');
        card.className = 'arch-card';
        card.dataset.arch = key;

        var name = document.createElement('div');
        name.className = 'arch-card-name';
        name.style.color = arch.color;
        name.textContent = arch.name;
        card.appendChild(name);

        var player = document.createElement('div');
        player.className = 'arch-card-player';
        player.textContent = arch.player;
        card.appendChild(player);

        var canvasWrap = document.createElement('div');
        var canvas = document.createElement('canvas');
        canvas.width = 150;
        canvas.height = 150;
        canvas.id = 'radar-' + key;
        canvasWrap.appendChild(canvas);
        card.appendChild(canvasWrap);

        var desc = document.createElement('div');
        desc.className = 'arch-card-desc';
        desc.textContent = arch.desc;
        card.appendChild(desc);

        card.addEventListener('click', function() {
          container.querySelectorAll('.arch-card').forEach(function(c) {
            c.classList.remove('selected');
          });
          card.classList.toggle('selected');
        });

        container.appendChild(card);

        // Draw mini radar chart
        setTimeout(function() {
          self.drawRadar(canvas, arch.values, arch.color);
        }, 100);
      });
    },

    drawRadar: function(canvas, values, color) {
      var features = Object.keys(FEATURE_LABELS);
      var data = features.map(function(f) { return (values[f] || 0) / 0.5; }); // normalize to 0-1 range where 0.5 is max

      var ctx = canvas.getContext('2d');
      var cx = canvas.width / 2;
      var cy = canvas.height / 2;
      var r = Math.min(cx, cy) - 20;
      var n = features.length;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Grid
      for (var ring = 1; ring <= 3; ring++) {
        ctx.beginPath();
        for (var i = 0; i <= n; i++) {
          var angle = (Math.PI * 2 * (i % n)) / n - Math.PI / 2;
          var x = cx + Math.cos(angle) * r * (ring / 3);
          var y = cy + Math.sin(angle) * r * (ring / 3);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(42, 58, 92, 0.5)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // Data polygon
      ctx.beginPath();
      for (var i = 0; i <= n; i++) {
        var angle = (Math.PI * 2 * (i % n)) / n - Math.PI / 2;
        var val = Math.min(data[i % n], 1);
        var x = cx + Math.cos(angle) * r * val;
        var y = cy + Math.sin(angle) * r * val;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  // ===========================================
  // Classifier Demo
  // ===========================================
  var ClassifierDemo = {
    init: function() {
      var container = document.getElementById('classifier-sliders');
      if (!container || container.children.length > 0) return;

      var self = this;
      var features = Object.keys(FEATURE_LABELS);

      features.forEach(function(feat) {
        var row = document.createElement('div');
        row.className = 'slider-row';

        var label = document.createElement('label');
        label.textContent = FEATURE_LABELS[feat];

        var slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '0.5';
        slider.step = '0.01';
        slider.value = '0.2';
        slider.dataset.feature = feat;

        var valSpan = document.createElement('span');
        valSpan.className = 'slider-val';
        valSpan.textContent = '0.20';

        slider.addEventListener('input', function() {
          valSpan.textContent = parseFloat(slider.value).toFixed(2);
          self.classify();
        });

        row.appendChild(label);
        row.appendChild(slider);
        row.appendChild(valSpan);
        container.appendChild(row);
      });

      this.classify();
    },

    classify: function() {
      var sliders = document.querySelectorAll('#classifier-sliders input[type="range"]');
      var features = {};
      sliders.forEach(function(s) {
        features[s.dataset.feature] = parseFloat(s.value);
      });

      var bestArch = null, bestDist = Infinity;
      var distances = {};

      Object.keys(CENTROIDS).forEach(function(key) {
        var centroid = CENTROIDS[key].values;
        var distSq = 0;
        for (var feat in centroid) {
          var pv = features[feat] !== undefined ? features[feat] : 0.2;
          distSq += Math.pow(pv - centroid[feat], 2);
        }
        distances[key] = Math.sqrt(distSq);
        if (distances[key] < bestDist) {
          bestDist = distances[key];
          bestArch = key;
        }
      });

      this.renderResult(bestArch, distances);
    },

    renderResult: function(bestArch, distances) {
      var container = document.getElementById('classifier-result');
      if (!container) return;

      var maxDist = 0;
      Object.keys(distances).forEach(function(k) {
        if (distances[k] > maxDist) maxDist = distances[k];
      });

      var html = '<div class="result-archetype" style="color: ' + CENTROIDS[bestArch].color + '">' +
        CENTROIDS[bestArch].name + '</div><div class="distance-bars">';

      var archKeys = Object.keys(distances);
      // Sort by distance ascending
      archKeys.sort(function(a, b) { return distances[a] - distances[b]; });

      archKeys.forEach(function(key) {
        var arch = CENTROIDS[key];
        var similarity = maxDist > 0 ? (1 - distances[key] / maxDist) : 0.5;
        var pct = (similarity * 100).toFixed(0);
        var isMatch = key === bestArch;

        html += '<div class="dist-row">' +
          '<span class="dist-label">' + arch.name + '</span>' +
          '<div class="dist-bar-wrap"><div class="dist-bar-fill" style="width: ' + pct + '%; background: ' +
          (isMatch ? arch.color : 'var(--border)') + '"></div></div>' +
          '<span class="dist-value">' + pct + '%</span></div>';
      });

      html += '</div>';
      container.innerHTML = html;
    }
  };

  // ===========================================
  // MultiPV Demo
  // ===========================================
  var MultiPVDemo = {
    board: null,

    // Hardcoded position with candidate moves
    position: {
      fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
      candidates: [
        { san: 'Qf3', eval: '+0.5', tags: ['quiet', 'defensive'], desc: 'Retreats the queen to a safe square. Solid and safe.' },
        { san: 'Bxf7+', eval: '+0.3', tags: ['sacrifice', 'aggressive'], desc: 'Sacrifices the bishop to destroy king safety. Creates chaos.' },
        { san: 'Qe2', eval: '+0.4', tags: ['positional', 'developing'], desc: 'Develops while protecting e4. Maintains tension.' },
      ],
      recommendations: {
        aggressive: { move: 0, reason: 'Against an aggressive player, retreat the queen to deny them attacking targets. Let them overextend.' },
        materialistic: { move: 1, reason: 'Against a materialistic player, sacrifice with Bxf7+! They\'ll grab the bishop, but their king is exposed and they won\'t know how to defend.' },
        positional: { move: 1, reason: 'Against a positional player, Bxf7+ injects chaos into the position. They prefer quiet maneuvering — deny them that.' },
        tactical: { move: 0, reason: 'Against a tactical player, play solid with Qf3. Simplify the position and deny them complications.' },
        passive: { move: 1, reason: 'Against a passive player, Bxf7+ creates maximum pressure. They won\'t fight back effectively.' },
      }
    },

    init: function() {
      var container = document.getElementById('multipv-board');
      if (!container || this.board) return;

      this.board = Chessboard('multipv-board', {
        position: this.position.fen,
        draggable: false,
        pieceTheme: PIECE_THEME,
      });

      var self = this;
      var select = document.getElementById('multipv-archetype');
      if (select) {
        select.addEventListener('change', function() {
          self.updateRecommendation(select.value);
        });
      }

      this.renderCandidates();
      this.updateRecommendation('aggressive');
    },

    renderCandidates: function() {
      var container = document.getElementById('multipv-candidates');
      if (!container) return;

      var self = this;
      var html = '';

      this.position.candidates.forEach(function(c, i) {
        var tags = c.tags.map(function(t) {
          return '<span class="candidate-tag">' + t + '</span>';
        }).join('');

        html += '<div class="candidate-move" id="candidate-' + i + '">' +
          '<span class="candidate-san">' + c.san + '</span>' +
          '<span class="candidate-eval">' + c.eval + '</span>' +
          '<div class="candidate-tags">' + tags + '</div></div>';
      });

      container.innerHTML = html;
    },

    updateRecommendation: function(archetype) {
      var rec = this.position.recommendations[archetype];
      if (!rec) return;

      // Highlight recommended candidate
      document.querySelectorAll('.candidate-move').forEach(function(el, i) {
        el.classList.toggle('recommended', i === rec.move);
      });

      var explEl = document.getElementById('multipv-explanation');
      if (explEl) {
        explEl.textContent = rec.reason;
      }
    }
  };

  // ===========================================
  // Architecture Demo
  // ===========================================
  var ArchitectureDemo = {
    init: function() {
      // Links are handled by narrative.js initArchitectureLinks
    }
  };

  // ===========================================
  // Expose to narrative.js
  // ===========================================
  window.InteractiveDemos = {
    PieceValueDemo: PieceValueDemo,
    MinimaxTreeDemo: MinimaxTreeDemo,
    AlphaBetaDemo: AlphaBetaDemo,
    NNUEDemo: NNUEDemo,
    ArchetypeCards: ArchetypeCards,
    ClassifierDemo: ClassifierDemo,
    MultiPVDemo: MultiPVDemo,
    ArchitectureDemo: ArchitectureDemo,
  };
})();
