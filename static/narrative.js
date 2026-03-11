(function() {
  'use strict';

  var sections = [
    { id: 'hero', label: 'Home' },
    { id: 'sec-problem', label: 'The Problem' },
    { id: 'sec-evaluation', label: 'Evaluation' },
    { id: 'sec-minimax', label: 'Minimax' },
    { id: 'sec-alphabeta', label: 'Alpha-Beta' },
    { id: 'sec-nnue', label: 'NNUE' },
    { id: 'sec-opponent-modeling', label: 'Profiling' },
    { id: 'sec-archetypes', label: 'Archetypes' },
    { id: 'sec-counter', label: 'Counter' },
    { id: 'sec-simulation', label: 'Simulation' },
    { id: 'sec-conclusion', label: 'Architecture' },
  ];

  // ==================
  // TOC sidebar
  // ==================
  function buildToc() {
    var toc = document.getElementById('toc');
    if (!toc) return;

    sections.forEach(function(sec) {
      var dot = document.createElement('div');
      dot.className = 'toc-dot';
      dot.dataset.section = sec.id;

      var label = document.createElement('span');
      label.className = 'toc-label';
      label.textContent = sec.label;
      dot.appendChild(label);

      dot.addEventListener('click', function() {
        var el = document.getElementById(sec.id);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      });

      toc.appendChild(dot);
    });
  }

  function updateToc(activeId) {
    var dots = document.querySelectorAll('.toc-dot');
    dots.forEach(function(d) {
      d.classList.toggle('active', d.dataset.section === activeId);
    });
  }

  // ==================
  // Scroll observer
  // ==================
  var initializedSections = {};

  function initScrollObserver() {
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          updateToc(entry.target.id);
          initSectionDemo(entry.target.id);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    document.querySelectorAll('.narrative-section').forEach(function(sec) {
      observer.observe(sec);
    });
  }

  function initSectionDemo(sectionId) {
    if (initializedSections[sectionId]) return;
    initializedSections[sectionId] = true;

    // Dispatch to interactive.js demos if they exist
    if (typeof window.InteractiveDemos === 'undefined') return;
    var demos = window.InteractiveDemos;

    switch (sectionId) {
      case 'sec-evaluation':
        if (demos.PieceValueDemo) demos.PieceValueDemo.init();
        break;
      case 'sec-minimax':
        if (demos.MinimaxTreeDemo) demos.MinimaxTreeDemo.init();
        break;
      case 'sec-alphabeta':
        if (demos.AlphaBetaDemo) demos.AlphaBetaDemo.init();
        break;
      case 'sec-nnue':
        if (demos.NNUEDemo) demos.NNUEDemo.init();
        break;
      case 'sec-archetypes':
        if (demos.ArchetypeCards) demos.ArchetypeCards.init();
        if (demos.ClassifierDemo) demos.ClassifierDemo.init();
        break;
      case 'sec-counter':
        if (demos.MultiPVDemo) demos.MultiPVDemo.init();
        break;
      case 'sec-conclusion':
        if (demos.ArchitectureDemo) demos.ArchitectureDemo.init();
        break;
    }
  }

  // ==================
  // Reading progress bar
  // ==================
  function initProgressBar() {
    var bar = document.getElementById('reading-progress');
    if (!bar) return;

    var ticking = false;
    window.addEventListener('scroll', function() {
      if (!ticking) {
        requestAnimationFrame(function() {
          var scrollTop = window.scrollY;
          var docHeight = document.body.scrollHeight - window.innerHeight;
          var pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
          bar.style.width = pct + '%';
          ticking = false;
        });
        ticking = true;
      }
    });
  }

  // ==================
  // Hero canvas
  // ==================
  function initHeroCanvas() {
    var canvas = document.getElementById('hero-bg-canvas');
    if (!canvas) return;

    var ctx = canvas.getContext('2d');
    var pieces = ['\u2654', '\u2655', '\u2656', '\u2657', '\u2658', '\u2659',
                  '\u265A', '\u265B', '\u265C', '\u265D', '\u265E', '\u265F'];
    var particles = [];

    function resize() {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Spawn particles
    for (var i = 0; i < 25; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        piece: pieces[Math.floor(Math.random() * pieces.length)],
        size: 16 + Math.random() * 20,
        opacity: 0.04 + Math.random() * 0.06,
      });
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach(function(p) {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < -30) p.x = canvas.width + 30;
        if (p.x > canvas.width + 30) p.x = -30;
        if (p.y < -30) p.y = canvas.height + 30;
        if (p.y > canvas.height + 30) p.y = -30;

        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.font = p.size + 'px serif';
        ctx.fillStyle = '#e0e0e0';
        ctx.fillText(p.piece, p.x, p.y);
        ctx.restore();
      });

      requestAnimationFrame(animate);
    }
    animate();
  }

  // ==================
  // KaTeX formula
  // ==================
  function renderFormulas() {
    var el = document.getElementById('elo-formula');
    if (el && typeof katex !== 'undefined') {
      katex.render(
        '\\Delta\\text{Elo} = -400 \\cdot \\log_{10}\\left(\\frac{1}{S} - 1\\right)',
        el,
        { displayMode: true, throwOnError: false }
      );
    }
  }

  // ==================
  // Architecture flow click
  // ==================
  function initArchitectureLinks() {
    document.querySelectorAll('.arch-node[data-section]').forEach(function(node) {
      node.addEventListener('click', function() {
        var target = document.getElementById(node.dataset.section);
        if (target) target.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  // ==================
  // Prism re-highlight
  // ==================
  function highlightCode() {
    if (typeof Prism !== 'undefined') {
      Prism.highlightAll();
    }
  }

  // ==================
  // Init
  // ==================
  document.addEventListener('DOMContentLoaded', function() {
    buildToc();
    initScrollObserver();
    initProgressBar();
    initHeroCanvas();
    renderFormulas();
    initArchitectureLinks();
    highlightCode();
  });
})();
