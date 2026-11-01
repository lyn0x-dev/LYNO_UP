// ====== Starfield Background Animation ======
function initStarfield() {
  const canvas = document.getElementById('stars-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let width, height;
  let stars = [];
  const COUNT = 90;

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  for (let i = 0; i < COUNT; i++) {
    stars.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 1.5 + 0.4,
      alpha: Math.random(),
      speed: Math.random() * 0.015 + 0.005,
      direction: Math.random() > 0.5 ? 1 : -1
    });
  }

  function render() {
    ctx.clearRect(0, 0, width, height);
    for (let s of stars) {
      s.alpha += s.speed * s.direction;
      if (s.alpha >= 1) { s.alpha = 1; s.direction = -1; }
      else if (s.alpha <= 0.05) { s.alpha = 0.05; s.direction = 1; }
      ctx.fillStyle = `rgba(196, 181, 253, ${s.alpha * 0.75})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}

// ====== Boot ======
(function initFromUrl() {
  const params = new URLSearchParams(location.search);
  const u = params.get('u');
  if (u) $('#auth-username').value = u;
  const s = params.get('server');
  if (s) state.pendingServer = s;
})();

initStarfield();
checkAuth();
