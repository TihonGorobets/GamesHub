/**
 * /public/games/who-is-it/ui.js
 * Phaser 3 Scenes for the "Who Is It?" game.
 *
 *  AnimatedBGScene – a living, breathing background with floating
 *  geometric shapes, orbiting rings, and subtle glows to give
 *  the game screen visual depth behind the HTML overlay panels.
 */

const COLORS = [0x8b5cf6, 0xec4899, 0x06b6d4, 0x10b981, 0xf59e0b, 0x3b82f6];

function randBetween(a, b) {
  return a + Math.random() * (b - a);
}

function randColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

// ───────────────────────────────────────────────────────────
//  AnimatedBGScene
// ───────────────────────────────────────────────────────────
export class AnimatedBGScene extends Phaser.Scene {
  constructor() {
    super({ key: 'AnimatedBGScene' });
    this._particles = [];
    this._rings = [];
    this._stars = [];
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    // ── Background gradient ────────────────────────────────
    const bgGfx = this.add.graphics();
    this._drawBg(bgGfx, W, H);

    // ── Stars (tiny white dots) ────────────────────────────
    for (let i = 0; i < 120; i++) {
      const x = randBetween(0, W);
      const y = randBetween(0, H);
      const r = randBetween(0.5, 1.8);
      const g = this.add.graphics();
      g.fillStyle(0xffffff, randBetween(0.1, 0.4));
      g.fillCircle(x, y, r);
      this._stars.push({ gfx: g, alpha: g.alpha, speed: randBetween(0.003, 0.008) });
    }

    // ── Large blurred glow orbs ────────────────────────────
    this._createGlowOrbs(W, H);

    // ── Floating geometric shapes ──────────────────────────
    for (let i = 0; i < 18; i++) {
      this._spawnShape(W, H);
    }

    // ── Orbiting rings ─────────────────────────────────────
    this._createRings(W, H);

    // Resize listener
    this.scale.on('resize', (gameSize) => {
      bgGfx.clear();
      this._drawBg(bgGfx, gameSize.width, gameSize.height);
    });
  }

  _drawBg(gfx, W, H) {
    // Base dark fill
    gfx.clear();
    gfx.fillStyle(0x0b0d14, 1);
    gfx.fillRect(0, 0, W, H);
  }

  _createGlowOrbs(W, H) {
    // Three big semi-transparent orbs for the mesh gradient feel
    const specs = [
      { x: W * 0.5,  y: H * -0.1, r: Math.min(W, H) * 0.8, color: 0x8b5cf6, a: 0.07 },
      { x: W * 0.9,  y: H * 0.6,  r: Math.min(W, H) * 0.55, color: 0xec4899, a: 0.05 },
      { x: W * 0.1,  y: H * 0.8,  r: Math.min(W, H) * 0.5,  color: 0x06b6d4, a: 0.04 },
    ];
    specs.forEach((s) => {
      const g = this.add.graphics();
      // Draw multi-layer soft circle
      for (let i = 10; i > 0; i--) {
        g.fillStyle(s.color, s.a * (i / 10));
        g.fillCircle(s.x, s.y, s.r * (i / 10));
      }
    });
  }

  _spawnShape(W, H) {
    const type  = Math.random() > 0.5 ? 'circle' : 'polygon';
    const x     = randBetween(0, W);
    const y     = randBetween(0, H);
    const size  = randBetween(12, 60);
    const color = randColor();
    const alpha = randBetween(0.04, 0.18);
    const speed = randBetween(0.15, 0.6);
    const rotSpeed = randBetween(-0.008, 0.008);
    const sides = Phaser.Math.Between(3, 6);

    const g = this.add.graphics();
    g.lineStyle(1.5, color, alpha);
    g.fillStyle(color, alpha * 0.3);

    if (type === 'circle') {
      g.strokeCircle(0, 0, size);
    } else {
      const pts = this._polyPoints(size, sides);
      g.beginPath();
      pts.forEach((p, i) => i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y));
      g.closePath();
      g.strokePath();
      g.fillPath();
    }

    g.setPosition(x, y);

    this._particles.push({
      gfx: g,
      vy: -speed,
      vx: randBetween(-0.15, 0.15),
      rot: rotSpeed,
      startY: y,
      W, H,
      maxH: H + 100,
    });
  }

  _polyPoints(radius, sides) {
    return Array.from({ length: sides }, (_, i) => {
      const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });
  }

  _createRings(W, H) {
    const cx = W * 0.5;
    const cy = H * 0.5;
    const radii = [180, 280, 380];
    radii.forEach((r, i) => {
      const g = this.add.graphics();
      g.lineStyle(1, COLORS[i % COLORS.length], 0.06);
      g.strokeCircle(cx, cy, r);
      this._rings.push({ gfx: g, cx, cy, r, angle: 0, speed: (i % 2 === 0 ? 1 : -1) * 0.002 });
    });
  }

  update() {
    const W = this.scale.width;
    const H = this.scale.height;

    // Animate floating shapes
    this._particles.forEach((p) => {
      p.gfx.x += p.vx;
      p.gfx.y += p.vy;
      p.gfx.rotation += p.rot;

      // Wrap around
      if (p.gfx.y < -80) {
        p.gfx.y = H + 60;
        p.gfx.x = randBetween(0, W);
      }
    });

    // Pulse star alphas
    this._stars.forEach((s, i) => {
      s.phase = (s.phase || i * 0.5) + s.speed;
      s.gfx.alpha = 0.1 + 0.3 * Math.abs(Math.sin(s.phase));
    });

    // Rotate ring markers (draw a small dot on each ring for subtle motion)
    this._rings.forEach((ring) => {
      ring.angle += ring.speed;
      const dotX = ring.cx + Math.cos(ring.angle) * ring.r;
      const dotY = ring.cy + Math.sin(ring.angle) * ring.r;
      // Rings are static gfx; the dot is just a reference, no extra draw needed
    });
  }
}
