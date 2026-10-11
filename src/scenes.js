// Interactive canvas backgrounds for the intro section. Plain canvas code, no React.
// Each scene is a factory: (width, height) => { draw(ctx, t, dt, m) }
// m = { x, y (smoothed mouse, -1..1), px, py (mouse in pixels), inside, boost (0..1, set on click) }
const TAU = Math.PI * 2;
const rand = Math.random;

export const HERO_BACKGROUNDS = [
  { id: "saturn", label: "Saturn rings", hint: "Particle rings around a planet" },
  { id: "net", label: "Constellation", hint: "Linked dots that follow your cursor" },
  { id: "galaxy", label: "Galaxy", hint: "A spiral of glowing stars" },
  { id: "warp", label: "Warp speed", hint: "Stars flying past you" },
  { id: "none", label: "Plain", hint: "No animation" },
];

function makeStars(w, h, n) {
  return Array.from({ length: n }, () => ({ x: rand() * w, y: rand() * h, r: 0.5 + rand() * 1.2, p: 0.6 + rand() * 2 }));
}
function drawStars(ctx, stars, t) {
  ctx.fillStyle = "#fff";
  for (const s of stars) {
    ctx.globalAlpha = 0.2 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.p + s.x));
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
  ctx.globalAlpha = 1;
}

// Shared cursor interaction for every animated background: particles part smoothly,
// then spring back to their natural positions as soon as the pointer moves away.
function repel(p, x, y, m, reach, strength, dt) {
  const dx = x - m.px, dy = y - m.py, d = Math.hypot(dx, dy);
  let tx = 0, ty = 0;
  if (m.inside && d > 0.01 && d < reach) {
    const amount = strength * Math.pow(1 - d / reach, 2);
    tx = dx / d * amount; ty = dy / d * amount;
  }
  const ease = 1 - Math.exp(-Math.min(dt, 0.05) * 13);
  p.ox += (tx - p.ox) * ease; p.oy += (ty - p.oy) * ease;

}

/* ───────── Saturn: a particle planet with particle rings orbiting it ───────── */
function saturn(w, h) {
  const mobile = w < 760;
  const cx = mobile ? w * 0.5 : w * 0.75;
  const cy = mobile ? h - 175 : h * 0.5;
  const R = mobile ? Math.min(66, w * 0.17) : Math.max(60, Math.min(h * 0.22, w * 0.14));
  const nRing = mobile ? 950 : 2000;
  const bands = [[1.42, 1.72, 0.55], [1.86, 2.3, 0.45]]; // the gap between them is the Cassini division
  const palette = ["#F4F2FF", "#A78BFA", "#FF896C", "#9B96FF"];
  const shares = [0.4, 0.2, 0.2, 0.2];

  const ring = []; // grouped by colour so fillStyle changes only 4 times per pass
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < nRing * shares[c]; i++) {
      const b = rand() < bands[0][2] ? bands[0] : bands[1];
      ring.push({ r: b[0] + rand() * (b[1] - b[0]), a: rand() * TAU, y: (rand() - 0.5) * 0.03, s: 0.7 + rand() * 1.3, c, ox: 0, oy: 0 });
    }
  }
  const N = mobile ? 360 : 800;
  const planet = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, rad = Math.sqrt(1 - y * y), th = i * 2.399963;
    const k = 0.5 + 0.5 * Math.sin(y * 6.5 + 1.2), stripe = Math.sin(y * 13) > 0.86;
    planet.push({ x: Math.cos(th) * rad, y, z: Math.sin(th) * rad, col: stripe ? [167, 139, 250] : [108 + 147 * k, 139 + 4 * k, 255 - 78 * k] });
  }
  const stars = makeStars(w, h, mobile ? 50 : 110);
  const sx = new Float32Array(ring.length), sy = new Float32Array(ring.length);
  const sz = new Float32Array(ring.length), sd = new Float32Array(ring.length);
  const L = [-0.55, -0.5, 0.67]; // light direction (up-left, towards the viewer)
  let spin = 0, tilt = 0.42, roll = -0.38;

  return {
    draw(ctx, t, dt, m) {
      const k = Math.min(1, dt * 3);
      tilt += (0.42 + m.y * 0.2 - tilt) * k;
      roll += (-0.38 + m.x * 0.2 - roll) * k;
      const speed = 1 + m.boost * 3;
      spin += dt * 0.12 * speed;
      const ct = Math.cos(tilt), st = Math.sin(tilt), cr = Math.cos(roll), sr = Math.sin(roll);

      drawStars(ctx, stars, t);
      const glow = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 3.2);
      glow.addColorStop(0, "rgba(116,124,148,0.16)");
      glow.addColorStop(1, "rgba(116,124,148,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(cx - R * 3.2, cy - R * 3.2, R * 6.4, R * 6.4);

      // Orbit the ring particles and spring them away from the pointer.
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        p.a += (0.9 / Math.pow(p.r, 1.5)) * dt * speed;
        const x = p.r * Math.cos(p.a), z = p.r * Math.sin(p.a), y = p.y;
        const y1 = y * ct + z * st, z1 = -y * st + z * ct;
        const x2 = x * cr - y1 * sr, y2 = x * sr + y1 * cr;
        const pf = 1 / (1 - z1 * 0.08);
        const baseX = cx + x2 * R * pf, baseY = cy + y2 * R * pf;
        repel(p, baseX, baseY, m, mobile ? 86 : 132, mobile ? 48 : 72, dt);
        sx[i] = baseX + p.ox; sy[i] = baseY + p.oy; sz[i] = p.s * pf; sd[i] = z1;
      }
      const pass = (front) => {
        ctx.globalAlpha = front ? 0.95 : 0.6;
        let last = -1;
        for (let i = 0; i < ring.length; i++) {
          if ((sd[i] >= 0) !== front) continue;
          const c = ring[i].c;
          if (c !== last) { ctx.fillStyle = palette[c]; last = c; }
          ctx.fillRect(sx[i], sy[i], sz[i], sz[i]);
        }
        ctx.globalAlpha = 1;
      };

      pass(false); // ring half behind the planet

      const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      body.addColorStop(0, "#32479F"); body.addColorStop(0.55, "#121B55"); body.addColorStop(1, "#050818");
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
      const cs = Math.cos(spin), ss = Math.sin(spin);
      for (const q of planet) {
        const x1 = q.x * cs + q.z * ss, z0 = -q.x * ss + q.z * cs, y0 = q.y;
        const y1 = y0 * ct + z0 * st, z1 = -y0 * st + z0 * ct;
        if (z1 <= 0) continue;
        const x2 = x1 * cr - y1 * sr, y2 = x1 * sr + y1 * cr;
        const shade = Math.max(0, x2 * L[0] + y2 * L[1] + z1 * L[2]);
        ctx.fillStyle = `rgba(${q.col[0] | 0},${q.col[1] | 0},${q.col[2] | 0},${(0.12 + 0.85 * shade).toFixed(2)})`;
        ctx.fillRect(cx + x2 * R - 1, cy + y2 * R - 1, 2.2, 2.2);
      }

      pass(true); // ring half in front of the planet
    },
  };
}

/* ───────── Constellation: drifting dots that link up and chase the cursor ───────── */
function net(w, h) {
  const n = Math.round(Math.min(120, (w * h) / 11000));
  const P = Array.from({ length: n }, () => ({ x: rand() * w, y: rand() * h, vx: (rand() - 0.5) * 26, vy: (rand() - 0.5) * 26, ox: 0, oy: 0, s: 1 + rand() * 1.6 }));
  const dxs = new Float32Array(n), dys = new Float32Array(n);
  const LINK = Math.min(150, w * 0.2);
  return {
    draw(ctx, t, dt, m) {
      for (let i = 0; i < n; i++) {
        const p = P[i];
        p.vx += (rand() - 0.5) * 20 * dt; p.vy += (rand() - 0.5) * 20 * dt;
        const fr = 1 - Math.min(1, dt * 0.35); p.vx *= fr; p.vy *= fr;
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 70) { p.vx *= 70 / sp; p.vy *= 70 / sp; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < 0) p.x += w; else if (p.x > w) p.x -= w;
        if (p.y < 0) p.y += h; else if (p.y > h) p.y -= h;
        repel(p, p.x, p.y, m, 150, 64, dt);
        dxs[i] = p.x + p.ox; dys[i] = p.y + p.oy;
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = P[i], b = P[j], d = Math.hypot(dxs[i] - dxs[j], dys[i] - dys[j]);
          if (d < LINK) {
            ctx.strokeStyle = `rgba(143,168,255,${((1 - d / LINK) * 0.5).toFixed(3)})`;
            ctx.beginPath(); ctx.moveTo(dxs[i], dys[i]); ctx.lineTo(dxs[j], dys[j]); ctx.stroke();
          }
        }
      }
      ctx.fillStyle = "#fff";
      for (let i = 0; i < n; i++) { const p = P[i]; ctx.beginPath(); ctx.arc(dxs[i], dys[i], p.s, 0, TAU); ctx.fill(); }
    },
  };
}

/* ───────── Galaxy: a spiral of stars with differential rotation ───────── */
function galaxy(w, h) {
  const mobile = w < 760;
  const cx = mobile ? w * 0.5 : w * 0.72, cy = mobile ? h - 190 : h * 0.5;
  const Rm = mobile ? Math.min(w * 0.45, 170) : Math.min(h * 0.46, w * 0.3);
  const n = mobile ? 1100 : 2600;
  const arms = 2;
  const P = [];
  for (let i = 0; i < n; i++) {
    const type = rand();
    let r, a;
    if (type < 0.18) {
      // A rounded, dense bulge gives the center a soft galaxy glow instead of a sharp point.
      r = Math.pow(rand(), 1.55) * 0.34;
      a = rand() * TAU;
    } else if (type < 0.88) {
      // Two gently wound arms with enough scatter to keep their edges soft and rounded.
      r = 0.1 + Math.pow(rand(), 0.86) * 0.9;
      const arm = i % arms;
      const scatter = (rand() + rand() + rand() + rand() + rand() + rand() - 3) * (0.1 + r * 0.13);
      a = arm * Math.PI + r * TAU * 1.32 + scatter;
    } else {
      // The faint inter-arm stars fill the silhouette so it reads as a galaxy from frame one.
      r = Math.sqrt(rand());
      a = rand() * TAU;
    }
    P.push({ r, a, s: (0.55 + rand() * 1.15) * (r < 0.3 ? 1.12 : 1), c: r < 0.34 ? 0 : r < 0.7 ? 1 : 2, ox: 0, oy: 0 });
  }
  P.sort((p, q) => p.c - q.c);
  const cols = ["#E9E6F2", "#AC9BCF", "#8994B8"];
  const px = new Float32Array(n), py = new Float32Array(n);
  const stars = makeStars(w, h, mobile ? 40 : 90);
  let rot = 0, tilt = 0.72, roll = -0.22;
  return {
    draw(ctx, t, dt, m) {
      const k = Math.min(1, dt * 2.5);
      tilt += (0.72 + m.y * 0.08 - tilt) * k;
      roll += (-0.22 + m.x * 0.12 - roll) * k;
      rot += dt * 0.18 * (1 + m.boost * 2);
      const cr = Math.cos(roll), sr = Math.sin(roll);
      drawStars(ctx, stars, t);
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, Rm * 0.62);
      core.addColorStop(0, "rgba(230,224,247,0.27)"); core.addColorStop(0.24, "rgba(164,151,198,0.16)"); core.addColorStop(1, "rgba(164,151,198,0)");
      ctx.fillStyle = core; ctx.fillRect(cx - Rm, cy - Rm, Rm * 2, Rm * 2);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.68;
      let last = -1;
      for (let i = 0; i < n; i++) {
        const p = P[i];
        if (p.c !== last) { ctx.fillStyle = cols[p.c]; last = p.c; }
        const ang = p.a + rot;
        const x = Math.cos(ang) * p.r * Rm, y = Math.sin(ang) * p.r * Rm * tilt;
        const bx = cx + x * cr - y * sr, by = cy + x * sr + y * cr;
        repel(p, bx, by, m, mobile ? 104 : 154, mobile ? 52 : 76, dt);
        px[i] = bx + p.ox; py[i] = by + p.oy;
        ctx.globalAlpha = Math.max(0.14, 0.78 - p.r * 0.5);
        ctx.fillRect(px[i], py[i], p.s, p.s);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
  };
}

/* ───────── Warp: stars streaming towards you, steered by the cursor ───────── */
function warp(w, h) {
  const n = w < 760 ? 140 : 320;
  const S = Array.from({ length: n }, () => ({ x: (rand() - 0.5) * w * 2, y: (rand() - 0.5) * h * 2, z: rand() * w + 1, ox: 0, oy: 0 }));
  return {
    draw(ctx, t, dt, m) {
      const speed = w * 0.3 * (1 + m.boost * 4);
      const ox = w * 0.5 - m.x * w * 0.12, oy = h * 0.5 - m.y * h * 0.12;
      ctx.lineCap = "round"; ctx.strokeStyle = "#fff";
      for (const s of S) {
        const pz = s.z;
        s.z -= speed * dt;
        if (s.z < 1) { s.x = (rand() - 0.5) * w * 2; s.y = (rand() - 0.5) * h * 2; s.z = w; s.ox = 0; s.oy = 0; continue; }
        const k1 = 260 / s.z, k0 = 260 / pz, a = 1 - s.z / w;
        const x0 = ox + s.x * k0, y0 = oy + s.y * k0, x1 = ox + s.x * k1, y1 = oy + s.y * k1;
        repel(s, (x0 + x1) * 0.5, (y0 + y1) * 0.5, m, 160, 76, dt);
        ctx.globalAlpha = Math.max(0, Math.min(1, a));
        ctx.lineWidth = 0.4 + a * 1.8;
        ctx.beginPath(); ctx.moveTo(x0 + s.ox, y0 + s.oy); ctx.lineTo(x1 + s.ox, y1 + s.oy); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  };
}

export const SCENES = { saturn, net, galaxy, warp };

