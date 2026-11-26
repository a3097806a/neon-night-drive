/* 霓虹夜行：Canvas 繪圖（只讀取狀態，不修改物理） */
(function () {
  'use strict';
  const NND = window.NND;
  const D = NND.data;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  const THEMES = {
    city: { bg0: '#0a0420', bg1: '#05030d', ground: 'rgba(30,12,70,.55)', edgeA: '#ff2fd6', edgeB: '#2ff3ff',
      road: '#14121f', line: '#ffe14a', lampA: '#2ff3ff', lampB: '#ff2fd6', vignette: .6 },
    harbor: { bg0: '#03101c', bg1: '#020810', ground: 'rgba(60,70,80,.55)', edgeA: '#ffb020', edgeB: '#e8f4ff',
      road: '#161a20', line: '#f0f0f0', lampA: '#ffcf70', lampB: '#7fd8ff', vignette: .65, rain: true },
    mountain: { bg0: '#3a1f3e', bg1: '#ff9a5a', ground: 'rgba(60,80,40,.8)', edgeA: '#ff6a3d', edgeB: '#ffffff',
      road: '#2a2428', line: '#ffd060', lampA: '#ffd28a', lampB: '#ffb070', vignette: .35, dawn: true },
    industrial: { bg0: '#0c1218', bg1: '#06090c', ground: 'rgba(40,50,60,.6)', edgeA: '#e8f6ff', edgeB: '#6fd0ff',
      road: '#171b20', line: '#d8f0ff', lampA: '#e8f6ff', lampB: '#9fe0ff', vignette: .55 }
  };

  /* ---------- 場景佈置（依賽道預先產生，世界座標） ---------- */
  function buildScene(track) {
    const th = THEMES[track.def.theme] || THEMES.city;
    const r = rng(track.N * 131 + track.width);
    const pts = track.pts, half = track.half;
    const minX = Math.min(...pts.map(p => p.x)) - 900, maxX = Math.max(...pts.map(p => p.x)) + 900;
    const minY = Math.min(...pts.map(p => p.y)) - 900, maxY = Math.max(...pts.map(p => p.y)) + 900;
    const far = (x, y, m) => { // 與賽道中心線距離是否足夠
      for (let i = 0; i < pts.length; i += 2) { const p = pts[i]; if ((p.x - x) ** 2 + (p.y - y) ** 2 < m * m) return false; }
      return true;
    };
    const sc = { th, lamps: [], blocks: [], props: [], water: [], bounds: { minX, maxX, minY, maxY } };
    // 路燈
    for (let i = 0; i < track.N; i += 9) {
      const p = pts[i], side = (i / 9) % 2 ? 1 : -1, off = half + 30;
      sc.lamps.push({ x: p.x + p.nx * off * side, y: p.y + p.ny * off * side, c: (i / 9) % 4 < 2 ? th.lampA : th.lampB, i });
    }
    const theme = track.def.theme;
    // 建築／貨櫃／樹木／廠房
    const tries = 700;
    for (let k = 0; k < tries; k++) {
      const x = minX + r() * (maxX - minX), y = minY + r() * (maxY - minY);
      const w = 60 + r() * 140, h = 60 + r() * 140;
      if (!far(x, y, half + 70 + Math.max(w, h) * 0.75)) continue;
      if (theme === 'city') sc.blocks.push({ x, y, w, h, c: r() < .5 ? '#190c3a' : '#120a2e', win: r() < .4 ? '#ff2fd6' : r() < .5 ? '#2ff3ff' : '#6a4aff', seed: k });
      else if (theme === 'harbor') {
        if (y < minY + (maxY - minY) * 0.15 || x < minX + 400) continue;
        const cols = ['#c0392b', '#2e86de', '#27ae60', '#e67e22', '#8e44ad', '#16a085'];
        sc.blocks.push({ x, y, w: 120, h: 40, c: cols[k % cols.length], container: true, stack: 1 + (k % 3), rot: r() < .5 ? 0 : Math.PI / 2 });
      } else if (theme === 'mountain') sc.props.push({ type: 'tree', x, y, r: 18 + r() * 26, c: r() < .5 ? '#1f4a2a' : '#2c5d2c' });
      else sc.blocks.push({ x, y, w: w * 1.3, h: h * 1.1, c: '#1b232c', win: '#cfeaff', factory: true, seed: k });
    }
    if (theme === 'harbor') {
      // 港區水面：賽道北側與西側
      sc.water.push({ x: minX - 2000, y: minY - 2000, w: maxX - minX + 4000, h: 1700 });
      sc.water.push({ x: minX - 2000, y: minY - 300, w: 1900, h: maxY - minY + 2600 });
      // 吊車
      for (let k = 0; k < 6; k++) {
        const i = Math.floor(track.N * (0.02 + k * 0.05)), p = pts[i % track.N];
        sc.props.push({ type: 'crane', x: p.x - p.nx * (half + 120), y: p.y - p.ny * (half + 120), a: Math.atan2(p.ty, p.tx) + Math.PI / 2 });
      }
    }
    if (theme === 'mountain') {
      // 山谷：下坡直線外側的深色地帶；護欄：彎道外側
      for (let i = 0; i < track.N; i += 3) {
        const p = pts[i], c = p.curvS;
        if (Math.abs(c) > 0.0012) sc.props.push({ type: 'rail', i, side: c > 0 ? -1 : 1 });
      }
      sc.valley = { x: minX - 1500, y: pts[Math.floor(track.N * 0.7)].y + 260, w: maxX - minX + 3000, h: 2000 };
    }
    if (theme === 'industrial') {
      for (let k = 0; k < 9; k++) {
        const i = Math.floor(track.N * (k / 9 + 0.03)), p = pts[i % track.N], q = pts[(i + 18) % track.N];
        sc.props.push({ type: 'pipe', x1: p.x + p.nx * (half + 90), y1: p.y + p.ny * (half + 90), x2: q.x + q.nx * (half + 90), y2: q.y + q.ny * (half + 90) });
      }
      // 高架管線跨越賽道
      for (const f of [0.12, 0.55, 0.8]) {
        const p = pts[Math.floor(track.N * f)];
        sc.props.push({ type: 'overpass', x1: p.x - p.nx * (half + 260), y1: p.y - p.ny * (half + 260), x2: p.x + p.nx * (half + 260), y2: p.y + p.ny * (half + 260) });
      }
    }
    // 煞車牌
    if (track.def.brakeBoards && track.signature) {
      const si = track.signature.i;
      // 找出招牌彎前方曲率開始變大的位置
      let apex = si;
      for (let k = -40; k < 40; k++) { const i = (si + k + track.N) % track.N; if (Math.abs(pts[i].curvS) > Math.abs(pts[apex].curvS)) apex = i; }
      let entry = apex; while (Math.abs(pts[(entry - 1 + track.N) % track.N].curvS) > 0.0009) entry = (entry - 1 + track.N) % track.N;
      sc.brakeBoards = [300, 200, 100].map(d => {
        const i = (entry - Math.round(d * 1.6 / track.ds) + track.N) % track.N, p = pts[i];
        return { d, i, x: p.x + p.nx * (half + 26), y: p.y + p.ny * (half + 26), x2: p.x - p.nx * (half + 26), y2: p.y - p.ny * (half + 26) };
      });
    }
    // 路面 Path2D
    const path = new Path2D();
    pts.forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y));
    path.closePath();
    sc.path = path;
    // 濕滑區（內側半邊或全幅）多邊形
    sc.wet = track.zones.filter(z => z.type === 'wet' && (z.level == null || z.level >= 0.8)).map(z => {
      const poly = new Path2D(), L = [], R = [];
      for (let i = z.i0; i <= z.i1; i++) {
        const p = pts[i % track.N];
        const a = z.side === 'all' ? -half : -12 * z.innerSign, b = z.side === 'all' ? half : half * z.innerSign;
        L.push([p.x + p.nx * a, p.y + p.ny * a]); R.push([p.x + p.nx * b, p.y + p.ny * b]);
      }
      L.forEach((q, n) => n ? poly.lineTo(q[0], q[1]) : poly.moveTo(q[0], q[1]));
      for (let n = R.length - 1; n >= 0; n--) poly.lineTo(R[n][0], R[n][1]);
      poly.closePath();
      return poly;
    });
    sc.down = track.zones.filter(z => z.type === 'downhill');
    return sc;
  }

  /* ---------- 車輛外型 ---------- */
  function carColors(carId, cos) {
    const spec = D.CARS[carId] || D.CARS.swift;
    const paint = (D.COSMETICS.paint.find(p => p.id === (cos && cos.paint)) || {}).color || spec.look.body;
    const tail = (D.COSMETICS.taillight.find(p => p.id === (cos && cos.taillight)) || D.COSMETICS.taillight[0]).color;
    return { body: paint, accent: spec.look.accent, light: spec.look.light, tail, rims: (cos && cos.rims) || 'basic' };
  }

  function wheel(ctx, x, y, w, h, rims, t) {
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.strokeStyle = rims === 'turbo' ? '#ffe14a' : rims === 'star' ? '#2ff3ff' : '#777';
    ctx.lineWidth = 1.5;
    if (rims === 'star') { ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.lineTo(x + w / 2, y); ctx.moveTo(x, y - h / 2); ctx.lineTo(x, y + h / 2); ctx.stroke(); }
    else if (rims === 'turbo') { ctx.beginPath(); ctx.arc(x, y, Math.min(w, h) * 0.35, t, t + 4.5); ctx.stroke(); }
    else ctx.strokeRect(x - w / 2 + 1.5, y - h / 2 + 1.5, w - 3, h - 3);
  }

  /** 以車頭朝 +x 繪製。各車有不同的俯視輪廓與車燈 */
  function drawCarShape(ctx, carId, col, braking, t, lowFx) {
    const glow = !lowFx;
    if (glow) { ctx.shadowColor = col.body; ctx.shadowBlur = 14; }
    ctx.lineJoin = 'round';
    if (carId === 'swift') { // 夜燕：開放式卡丁車，外露四輪、短軸距
      wheel(ctx, 12, -11, 9, 6, col.rims, t); wheel(ctx, 12, 11, 9, 6, col.rims, t);
      wheel(ctx, -12, -12, 11, 7, col.rims, t); wheel(ctx, -12, 12, 11, 7, col.rims, t);
      ctx.fillStyle = col.body;
      ctx.beginPath(); ctx.moveTo(21, 0); ctx.lineTo(14, -6); ctx.lineTo(-16, -7); ctx.lineTo(-19, 0); ctx.lineTo(-16, 7); ctx.lineTo(14, 6); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#111'; ctx.fillRect(-20, -10, 4, 20);          // 後保桿
      ctx.fillStyle = col.accent; ctx.beginPath(); ctx.arc(-3, 0, 5, 0, 7); ctx.fill(); // 安全帽
      ctx.fillStyle = col.light; ctx.fillRect(19, -3, 3, 6);           // 單顆前燈
      ctx.fillStyle = braking ? col.tail : shade(col.tail);
      ctx.fillRect(-21, -4, 2, 8);
    } else if (carId === 'mist') { // 海霧：方正拉力車、車頂架、四燈燈組
      ctx.fillStyle = col.body;
      roundRect(ctx, -24, -14, 48, 28, 4); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = col.accent; ctx.fillRect(-10, -10, 16, 20);        // 車頂
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1; for (let k = -8; k <= 4; k += 4) { ctx.beginPath(); ctx.moveTo(k, -10); ctx.lineTo(k, 10); ctx.stroke(); }
      ctx.fillStyle = '#9ff'; ctx.fillRect(8, -11, 5, 22);
      ctx.fillStyle = col.light; for (const y of [-11, -4, 1, 8]) ctx.fillRect(23, y, 3, 3); // 四燈
      ctx.fillStyle = '#222'; ctx.fillRect(-26, -14, 3, 6); ctx.fillRect(-26, 8, 3, 6); // 擋泥板
      ctx.fillStyle = braking ? col.tail : shade(col.tail); ctx.fillRect(-25, -12, 2, 5); ctx.fillRect(-25, 7, 2, 5);
    } else if (carId === 'shadow') { // 墨影：長車頭、寬後輪拱、尾翼
      ctx.fillStyle = col.body;
      ctx.beginPath(); ctx.moveTo(26, -8); ctx.lineTo(26, 8); ctx.lineTo(4, 12); ctx.lineTo(-14, 14); ctx.lineTo(-24, 12); ctx.lineTo(-24, -12); ctx.lineTo(-14, -14); ctx.lineTo(4, -12); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = col.accent; ctx.fillRect(-12, -9, 14, 18);
      ctx.fillStyle = '#9ff'; ctx.fillRect(2, -8, 4, 16);
      ctx.fillStyle = '#111'; ctx.fillRect(-27, -14, 4, 28);             // 尾翼
      ctx.fillStyle = col.light; ctx.beginPath(); ctx.moveTo(26, -8); ctx.lineTo(21, -9); ctx.lineTo(23, -4); ctx.fill();
      ctx.beginPath(); ctx.moveTo(26, 8); ctx.lineTo(21, 9); ctx.lineTo(23, 4); ctx.fill();
      ctx.fillStyle = braking ? col.tail : shade(col.tail); ctx.fillRect(-24, -12, 2, 24);
    } else { // 赤線：楔形原型車、長車鼻、尾鰭、座艙罩
      ctx.fillStyle = col.body;
      ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(10, -10); ctx.lineTo(-22, -13); ctx.lineTo(-26, -6); ctx.lineTo(-26, 6); ctx.lineTo(-22, 13); ctx.lineTo(10, 10); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0b0b10'; ctx.beginPath(); ctx.ellipse(-2, 0, 10, 5, 0, 0, 7); ctx.fill(); // 座艙罩
      ctx.strokeStyle = col.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-26, -9); ctx.lineTo(-14, -9); ctx.moveTo(-26, 9); ctx.lineTo(-14, 9); ctx.stroke(); // 尾鰭
      ctx.fillStyle = col.light; ctx.fillRect(14, -9, 6, 2); ctx.fillRect(14, 7, 6, 2);    // 細長燈條
      ctx.fillStyle = braking ? col.tail : shade(col.tail); ctx.fillRect(-27, -6, 2, 12);
    }
    ctx.shadowBlur = 0;
  }
  function shade(hex) { return hex + '88'; }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  /* ---------- 繪圖器 ---------- */
  function createRenderer(canvas) {
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1, scene = null, track = null;
    let particles = [], skids = [], rain = [];
    let lowFx = NND.input && NND.input.isTouchDevice();

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, lowFx ? 1.5 : 2);
      W = innerWidth; H = innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    addEventListener('resize', resize); resize();

    function setTrack(t) {
      track = t; scene = buildScene(t); particles = []; skids = [];
      rain = Array.from({ length: 120 }, () => ({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8 }));
    }

    /** 由車輛狀態產生粒子（尾流、胎痕、草地煙塵） */
    function emit(c, dt) {
      const sp = Math.hypot(c.vx, c.vy), ca = Math.cos(c.a), sa = Math.sin(c.a);
      const bx = c.x - ca * 22, by = c.y - sa * 22;
      const trail = (c.cos && c.cos.trail) || 'neon';
      if (sp > 40 && Math.abs(c.slip || 0) > 0.2 && c.surf !== 'grass') {
        skids.push({ x: bx, y: by, a: c.a, life: 3 });
      }
      if (c.surf === 'grass' && sp > 60 && Math.random() < 0.7) particles.push({ x: bx, y: by, vx: -c.vx * 0.2 + (Math.random() - .5) * 60, vy: -c.vy * 0.2 + (Math.random() - .5) * 60, life: .6, max: .6, c: '140,120,90', r: 6 });
      if (trail !== 'none' && sp > 120 && Math.random() < (lowFx ? 0.35 : 0.8)) {
        let col = '255,47,214';
        if (trail === 'neon') col = hexToRgb(carColors(c.carId, c.cos).body);
        if (trail === 'bolt') col = '255,225,74';
        if (trail === 'rainbow') { const h = (performance.now() / 6) % 360; col = hslToRgb(h); }
        particles.push({ x: bx, y: by, vx: -ca * 60 + (Math.random() - .5) * 20, vy: -sa * 60 + (Math.random() - .5) * 20, life: .4, max: .4, c: col, r: trail === 'bolt' ? 3 : 5, bolt: trail === 'bolt' });
      }
      if (c.nitro) particles.push({ x: bx, y: by, vx: -ca * 200, vy: -sa * 200, life: .25, max: .25, c: '120,200,255', r: 7 });
    }

    function draw(view, dt) {
      const th = scene.th;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, th.bg0); g.addColorStop(1, th.bg1);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      const cam = view.cam, zoom = cam.zoom * (lowFx ? 0.8 : 1) * Math.min(1.2, Math.max(0.65, Math.min(W, H) / 800));
      for (const c of view.cars) if (!c.ghostRun) emit(c, dt);
      for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
      particles = particles.filter(p => p.life > 0);
      if (particles.length > 700) particles.splice(0, particles.length - 700);
      for (const s of skids) s.life -= dt;
      skids = skids.filter(s => s.life > 0);
      if (skids.length > 400) skids.splice(0, skids.length - 400);

      ctx.save();
      ctx.translate(W / 2 + (cam.shake ? (Math.random() - .5) * cam.shake * 4 : 0), H / 2 + (cam.shake ? (Math.random() - .5) * cam.shake * 4 : 0));
      ctx.scale(zoom, zoom); ctx.translate(-cam.x, -cam.y);
      const vw = W / zoom / 2 + 200, vh = H / zoom / 2 + 200;
      const vis = (x, y, m) => Math.abs(x - cam.x) < vw + (m || 0) && Math.abs(y - cam.y) < vh + (m || 0);

      drawBackground(vis, view.time);
      drawRoad(view);
      // 胎痕
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      for (const s of skids) {
        if (!vis(s.x, s.y)) continue;
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a); ctx.globalAlpha = clamp(s.life / 3, 0, 1);
        ctx.fillRect(-4, -12, 8, 4); ctx.fillRect(-4, 8, 8, 4); ctx.restore();
      }
      ctx.globalAlpha = 1;
      drawLamps(vis, view.time);
      // 粒子
      for (const p of particles) {
        if (!vis(p.x, p.y)) continue;
        ctx.fillStyle = `rgba(${p.c},${(p.life / p.max * 0.7).toFixed(3)})`;
        if (p.bolt) { ctx.fillRect(p.x - 1, p.y - 6 * Math.random(), 3, 9); continue; }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.5 - p.life / p.max), 0, 7); ctx.fill();
      }
      // 車輛
      const t = view.time / 100;
      for (const c of view.cars) {
        if (!vis(c.x, c.y, 50)) continue;
        ctx.save(); ctx.translate(c.x, c.y);
        // 車頭燈光錐
        if (!lowFx && !c.ghostRun) {
          ctx.save(); ctx.rotate(c.a);
          const lg = ctx.createRadialGradient(30, 0, 0, 30, 0, 170);
          lg.addColorStop(0, 'rgba(255,250,220,.22)'); lg.addColorStop(1, 'rgba(255,250,220,0)');
          ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(24, -8); ctx.lineTo(190, -70); ctx.lineTo(190, 70); ctx.lineTo(24, 8); ctx.fill();
          ctx.restore();
        }
        ctx.globalAlpha = c.ghostRun ? 0.35 : c.ghosted ? 0.55 : 1;
        ctx.rotate(c.a);
        if (c.grip) { ctx.strokeStyle = 'rgba(61,255,154,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, 34, 22, 0, 0, 7); ctx.stroke(); }
        drawCarShape(ctx, c.carId, carColors(c.carId, c.cos), c.brake, t, lowFx);
        ctx.restore();
        ctx.globalAlpha = 1;
        if (c.label) {
          ctx.font = '600 13px sans-serif'; ctx.textAlign = 'center';
          ctx.fillStyle = c.me ? '#ffe14a' : 'rgba(255,255,255,.85)';
          ctx.fillText(c.label, c.x, c.y - 34);
        }
      }
      drawOverhead(vis);
      ctx.restore();

      drawScreenFx(view);
    }

    function drawBackground(vis, time) {
      const sc = scene, th = sc.th, theme = track.def.theme;
      if (sc.water.length) {
        for (const w of sc.water) { ctx.fillStyle = '#04182a'; ctx.fillRect(w.x, w.y, w.w, w.h); }
        // 水面倒影：燈光拉長的光帶
        ctx.globalAlpha = 0.35;
        for (const l of sc.lamps) {
          if (!vis(l.x, l.y)) continue;
          const wob = Math.sin(time / 300 + l.i) * 3;
          ctx.fillStyle = l.c; ctx.fillRect(l.x - 2 + wob, l.y + 10, 4, 40);
        }
        ctx.globalAlpha = 1;
      }
      if (sc.valley) {
        const v = sc.valley, gr = ctx.createLinearGradient(0, v.y, 0, v.y + 700);
        gr.addColorStop(0, 'rgba(20,10,30,0)'); gr.addColorStop(1, 'rgba(20,10,30,.85)');
        ctx.fillStyle = gr; ctx.fillRect(v.x, v.y, v.w, v.h);
      }
      // 路外地面
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = th.ground; ctx.lineWidth = track.width + 380; ctx.stroke(sc.path);
      if (theme === 'harbor') { ctx.strokeStyle = 'rgba(90,96,104,.7)'; ctx.lineWidth = track.width + 160; ctx.stroke(sc.path); }
      for (const b of sc.blocks) {
        if (!vis(b.x, b.y, 200)) continue;
        if (b.container) {
          ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
          for (let s = 0; s < b.stack; s++) {
            ctx.fillStyle = b.c; ctx.fillRect(-60, -20 + s * 44, 120, 40);
            ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2;
            for (let k = -54; k < 60; k += 10) { ctx.beginPath(); ctx.moveTo(k, -18 + s * 44); ctx.lineTo(k, 18 + s * 44); ctx.stroke(); }
          }
          ctx.restore();
          continue;
        }
        ctx.fillStyle = b.c; ctx.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
        ctx.strokeStyle = b.win; ctx.globalAlpha = 0.5; ctx.lineWidth = b.factory ? 2 : 1;
        ctx.strokeRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
        ctx.globalAlpha = 0.65; ctx.fillStyle = b.win;
        const r = rng(b.seed + 1);
        if (b.factory) { // 冷白燈帶
          ctx.fillRect(b.x - b.w / 2 + 6, b.y - 3, b.w - 12, 3);
          ctx.fillRect(b.x - b.w / 2 + 6, b.y - b.h / 2 + 8, b.w - 12, 2);
        } else {
          for (let wx = b.x - b.w / 2 + 7; wx < b.x + b.w / 2 - 4; wx += 14)
            for (let wy = b.y - b.h / 2 + 7; wy < b.y + b.h / 2 - 4; wy += 14) if (r() < 0.35) ctx.fillRect(wx, wy, 4, 4);
        }
        ctx.globalAlpha = 1;
      }
      for (const p of sc.props) {
        if (p.type === 'tree') {
          if (!vis(p.x, p.y)) continue;
          ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
          ctx.fillStyle = 'rgba(255,190,120,.25)'; ctx.beginPath(); ctx.arc(p.x - p.r * .3, p.y - p.r * .3, p.r * .5, 0, 7); ctx.fill();
        } else if (p.type === 'pipe') {
          ctx.strokeStyle = '#4a5a66'; ctx.lineWidth = 18; ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
          ctx.strokeStyle = '#8fd8ff'; ctx.lineWidth = 2; ctx.stroke();
        }
      }
    }

    function drawRoad(view) {
      const sc = scene, th = sc.th, w = track.width;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (!lowFx) { ctx.shadowColor = th.edgeA; ctx.shadowBlur = 24; }
      ctx.strokeStyle = th.edgeA; ctx.lineWidth = w + 14; ctx.stroke(sc.path);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = th.edgeB; ctx.lineWidth = w + 4; ctx.stroke(sc.path);
      ctx.strokeStyle = th.road; ctx.lineWidth = w - 4; ctx.stroke(sc.path);
      ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = w - 22; ctx.stroke(sc.path);
      ctx.strokeStyle = th.road; ctx.lineWidth = w - 26; ctx.stroke(sc.path);
      ctx.setLineDash([36, 40]); ctx.strokeStyle = th.line; ctx.lineWidth = 4; ctx.stroke(sc.path); ctx.setLineDash([]);
      // 濕滑區
      for (const poly of sc.wet) {
        ctx.fillStyle = 'rgba(80,160,255,.22)'; ctx.fill(poly);
        ctx.strokeStyle = 'rgba(160,220,255,.55)'; ctx.lineWidth = 2; ctx.setLineDash([8, 8]); ctx.stroke(poly); ctx.setLineDash([]);
      }
      // 下坡箭頭
      for (const z of sc.down) {
        for (let i = z.i0; i < z.i1; i += 12) {
          const p = track.pts[i % track.N];
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.ty, p.tx));
          ctx.strokeStyle = 'rgba(255,208,96,.55)'; ctx.lineWidth = 5;
          ctx.beginPath(); ctx.moveTo(-14, -22); ctx.lineTo(6, 0); ctx.lineTo(-14, 22); ctx.stroke(); ctx.restore();
        }
      }
      // 護欄
      for (const p of sc.props) if (p.type === 'rail') {
        const q = track.pts[p.i], o = (track.half + 12) * p.side;
        ctx.fillStyle = (p.i / 3) % 2 ? '#ffffff' : '#ff3b3b';
        ctx.fillRect(q.x + q.nx * o - 5, q.y + q.ny * o - 5, 10, 10);
      }
      // 煞車牌
      if (sc.brakeBoards) for (const b of sc.brakeBoards) for (const [x, y] of [[b.x, b.y], [b.x2, b.y2]]) {
        ctx.fillStyle = '#e8f6ff'; ctx.fillRect(x - 22, y - 14, 44, 28);
        ctx.fillStyle = '#ff2030'; ctx.font = '900 20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(b.d), x, y + 1);
        ctx.textBaseline = 'alphabetic';
      }
      // 檢查線
      const next = view.nextCp;
      for (const L of track.cps) {
        if (L.k === 0) continue;
        ctx.strokeStyle = L.k === next ? 'rgba(255,225,74,.85)' : 'rgba(47,243,255,.35)';
        ctx.lineWidth = L.k === next ? 6 : 4; ctx.setLineDash([12, 10]);
        ctx.beginPath(); ctx.moveTo(L.ax, L.ay); ctx.lineTo(L.bx, L.by); ctx.stroke(); ctx.setLineDash([]);
      }
      // 起點線與起跑格
      const p = track.pts[0], cols = 12, cs = (w - 8) / cols;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.ty, p.tx));
      for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) { ctx.fillStyle = (r + c) % 2 ? '#fff' : '#111'; ctx.fillRect(-cs + r * cs, -w / 2 + 4 + c * cs, cs, cs); }
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2;
      for (const g of track.grid) {
        ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.a);
        ctx.beginPath(); ctx.moveTo(26, -16); ctx.lineTo(30, -16); ctx.lineTo(30, 16); ctx.lineTo(26, 16); ctx.stroke(); ctx.restore();
      }
      // 招牌彎地標
      drawLandmark();
    }

    function drawLandmark() {
      const sig = track.signature; if (!sig) return;
      const p = track.pts[sig.i], side = p.curvS >= 0 ? 1 : -1; // 放在彎道內側
      const x = p.x + p.nx * side * (track.half + 150), y = p.y + p.ny * side * (track.half + 150);
      const theme = track.def.theme, t = performance.now();
      ctx.save(); ctx.translate(x, y);
      if (theme === 'city') { // 百貨霓虹招牌
        ctx.fillStyle = '#1a0830'; ctx.fillRect(-150, -90, 300, 180);
        ctx.strokeStyle = '#ff2fd6'; ctx.lineWidth = 4; ctx.shadowColor = '#ff2fd6'; ctx.shadowBlur = lowFx ? 0 : 30;
        ctx.strokeRect(-140, -80, 280, 160);
        ctx.shadowBlur = 0;
        ctx.fillStyle = (Math.floor(t / 500) % 2) ? '#ff2fd6' : '#2ff3ff';
        ctx.font = '900 54px "Microsoft JhengHei", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('霓虹百貨', 0, -10);
        ctx.font = '700 20px sans-serif'; ctx.fillStyle = '#ffe14a'; ctx.fillText('NEON DEPT.', 0, 44);
      } else if (theme === 'harbor') { // 碼頭燈塔
        ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.arc(0, 0, 40, 0, 7); ctx.fill();
        ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(0, 0, 26, 0, 7); ctx.fill();
        const a = t / 800;
        ctx.fillStyle = 'rgba(255,230,140,.25)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 420, a, a + 0.35); ctx.fill();
        ctx.fillStyle = '#ffe14a'; ctx.font = '900 26px "Microsoft JhengHei", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('第七碼頭', 0, 76);
      } else if (theme === 'mountain') { // 曙光觀景台
        ctx.fillStyle = '#ffd28a'; ctx.beginPath(); ctx.arc(0, 0, 60, 0, 7); ctx.fill();
        ctx.fillStyle = '#ff7a3d'; ctx.beginPath(); ctx.arc(0, 0, 36, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '900 26px "Microsoft JhengHei", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('曙光亭', 0, 96);
      } else { // 工業：冷卻塔
        ctx.fillStyle = '#2a3440'; ctx.beginPath(); ctx.arc(0, 0, 90, 0, 7); ctx.fill();
        ctx.strokeStyle = '#e8f6ff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 70, 0, 7); ctx.stroke();
        ctx.fillStyle = '#e8f6ff'; ctx.font = '900 24px "Microsoft JhengHei", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('第三廠', 0, 9);
      }
      ctx.restore();
    }

    function drawLamps(vis, time) {
      for (const l of scene.lamps) {
        if (!vis(l.x, l.y, 120)) continue;
        const pulse = 0.85 + 0.15 * Math.sin(time / 400 + l.i);
        if (!lowFx) {
          const gr = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, 110);
          gr.addColorStop(0, l.c + '55'); gr.addColorStop(1, l.c + '00');
          ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(l.x, l.y, 110 * pulse, 0, 7); ctx.fill();
        }
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(l.x, l.y, 6, 0, 7); ctx.fill();
        ctx.strokeStyle = l.c; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(l.x, l.y, 9, 0, 7); ctx.stroke();
      }
    }

    function drawOverhead(vis) {
      for (const p of scene.props) {
        if (p.type === 'crane') {
          if (!vis(p.x, p.y, 300)) continue;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
          ctx.strokeStyle = '#ffb020'; ctx.lineWidth = 6;
          ctx.strokeRect(-30, -30, 60, 60);
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -260); ctx.stroke();
          ctx.lineWidth = 2; for (let k = -250; k < 0; k += 20) { ctx.beginPath(); ctx.moveTo(-8, k); ctx.lineTo(8, k + 20); ctx.stroke(); }
          ctx.fillStyle = '#ff3030'; ctx.beginPath(); ctx.arc(0, -260, 6, 0, 7); ctx.fill();
          ctx.restore();
        } else if (p.type === 'overpass') {
          ctx.strokeStyle = 'rgba(90,110,125,.85)'; ctx.lineWidth = 30; ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
          ctx.strokeStyle = '#e8f6ff'; ctx.lineWidth = 3; ctx.stroke();
        }
      }
    }

    function drawScreenFx(view) {
      const th = scene.th, sp = view.speedRatio || 0;
      // 雨
      if (th.rain) {
        ctx.strokeStyle = 'rgba(170,210,255,.35)'; ctx.lineWidth = 1.2; ctx.beginPath();
        for (const d of rain) {
          d.y += 0.03 * d.s; d.x -= 0.004 * d.s; if (d.y > 1) { d.y = 0; d.x = Math.random(); } if (d.x < 0) d.x += 1;
          const x = d.x * W, y = d.y * H; ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 16 * d.s);
        }
        ctx.stroke();
      }
      // 速度線
      if (sp > 0.45 && view.velAngle != null) {
        const dx = Math.cos(view.velAngle), dy = Math.sin(view.velAngle);
        ctx.strokeStyle = `rgba(200,240,255,${((sp - 0.4) * 0.5).toFixed(3)})`; ctx.lineWidth = 2;
        const r = rng(Math.floor(view.time / 50)); ctx.beginPath();
        for (let i = 0; i < 26 * sp; i++) {
          const a = r() * 6.283, d = Math.min(W, H) * (0.38 + r() * 0.35), len = 40 + r() * 120 * sp;
          const px = W / 2 + Math.cos(a) * d * 1.3, py = H / 2 + Math.sin(a) * d;
          ctx.moveTo(px, py); ctx.lineTo(px - dx * len, py - dy * len);
        }
        ctx.stroke();
      }
      if (view.nitro) { ctx.fillStyle = 'rgba(255,47,214,.08)'; ctx.fillRect(0, 0, W, H); }
      // 暗角
      const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.4, W / 2, H / 2, Math.max(W, H) * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${th.vignette})`);
      ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    }

    return { setTrack, draw, resize, get size() { return { W, H }; }, get lowFx() { return lowFx; },
      setQuality(q) { lowFx = q === 'low' ? true : q === 'high' ? false : (NND.input && NND.input.isTouchDevice()); resize(); } };
  }

  /* ---------- 小地圖 ---------- */
  function drawMinimap(canvas, track, dots, opts) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height, pad = 8;
    const xs = track.pts.map(p => p.x), ys = track.pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const s = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxY - minY));
    const ox = (w - (maxX - minX) * s) / 2 - minX * s, oy = (h - (maxY - minY) * s) / 2 - minY * s;
    ctx.clearRect(0, 0, w, h);
    if (opts && opts.bg) { ctx.fillStyle = 'rgba(5,3,13,.6)'; ctx.fillRect(0, 0, w, h); }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = (opts && opts.color) || 'rgba(47,243,255,.85)'; ctx.lineWidth = Math.max(2, track.width * s * 0.7);
    ctx.beginPath(); track.pts.forEach((p, i) => i ? ctx.lineTo(p.x * s + ox, p.y * s + oy) : ctx.moveTo(p.x * s + ox, p.y * s + oy)); ctx.closePath(); ctx.stroke();
    // 招牌彎
    if (track.signature) {
      const p = track.pts[track.signature.i];
      ctx.fillStyle = '#ff2fd6'; ctx.beginPath(); ctx.arc(p.x * s + ox, p.y * s + oy, 4, 0, 7); ctx.fill();
    }
    const st = track.pts[0];
    ctx.fillStyle = '#fff'; ctx.fillRect(st.x * s + ox - 3, st.y * s + oy - 3, 6, 6);
    for (const d of dots || []) {
      ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(d.x * s + ox, d.y * s + oy, d.me ? 5 : 3.5, 0, 7); ctx.fill();
      if (d.me) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
  }

  /** 車庫預覽：在小 canvas 中央畫一台車 */
  function drawCarPreview(canvas, carId, cos) {
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(w / 90, w / 90); ctx.rotate(-Math.PI / 2);
    drawCarShape(ctx, carId, carColors(carId, cos), true, performance.now() / 100, false);
    ctx.restore();
  }

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '#ff2fd6');
    return m ? `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}` : '255,47,214';
  }
  function hslToRgb(h) {
    const f = n => { const k = (n + h / 30) % 12; return Math.round(255 * (0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return `${f(0)},${f(8)},${f(4)}`;
  }

  NND.render = { createRenderer, drawMinimap, drawCarPreview, carColors, THEMES };
})();
