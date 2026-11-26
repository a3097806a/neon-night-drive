/* 霓虹夜行：賽道幾何（中心線取樣、實體檢查線、起跑格、路面區域、定位） */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.NND = root.NND || {}; root.NND.track = mod; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DS = 20; // 中心線取樣間距（px）

  function catmull(points, per) {
    const out = [], n = points.length;
    for (let i = 0; i < n; i++) {
      const p0 = points[(i + n - 1) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
      for (let k = 0; k < per; k++) {
        const t = k / per, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    return out;
  }

  /** 依弧長重新取樣，讓每個樣本間距一致 */
  function resample(dense, step) {
    const n = dense.length, cum = [0];
    for (let i = 1; i <= n; i++) {
      const a = dense[i - 1], b = dense[i % n];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[n], count = Math.round(total / step), real = total / count, out = [];
    let j = 0;
    for (let k = 0; k < count; k++) {
      const s = k * real;
      while (cum[j + 1] < s) j++;
      const a = dense[j], b = dense[(j + 1) % n], t = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
      out.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t });
    }
    return { pts: out, length: total, ds: real };
  }

  function build(def) {
    const { pts, length, ds } = resample(catmull(def.points, 80), DS);
    const N = pts.length, w = def.width, half = w / 2;
    for (let i = 0; i < N; i++) {
      const a = pts[(i + N - 1) % N], b = pts[(i + 1) % N];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
      const p = pts[i];
      p.tx = dx / l; p.ty = dy / l; p.nx = -p.ty; p.ny = p.tx; // n 指向行進方向右側（y 軸朝下）
      p.s = i * ds; p.i = i;
    }
    // 曲率（dθ/ds），正值＝右彎
    for (let i = 0; i < N; i++) {
      const a = pts[(i + N - 1) % N], b = pts[(i + 1) % N];
      let d = Math.atan2(b.ty, b.tx) - Math.atan2(a.ty, a.tx);
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      pts[i].curv = d / (2 * ds);
    }
    // 平滑曲率（供 AI 與賽車線）
    const sm = pts.map((_, i) => {
      let s = 0; for (let o = -3; o <= 3; o++) s += pts[(i + o + N) % N].curv; return s / 7;
    });
    sm.forEach((c, i) => { pts[i].curvS = c; });

    // 路面區域
    const zoneIdx = Array.from({ length: N }, () => []);
    const zones = (def.zones || []).map(z => {
      const i0 = Math.floor(z.from * N), i1 = Math.ceil(z.to * N);
      let c = 0; for (let i = i0; i <= i1; i++) c += pts[i % N].curvS;
      const zone = Object.assign({}, z, { i0, i1, innerSign: c >= 0 ? 1 : -1 });
      for (let i = i0; i <= i1; i++) zoneIdx[i % N].push(zone);
      return zone;
    });

    // 實體檢查線：橫跨整個路面（僅路面寬度，草地上不算）
    const K = def.checkpoints || 8;
    const cps = [];
    for (let k = 0; k < K; k++) {
      const i = Math.round(k * N / K) % N, p = pts[i], e = half + 6;
      cps.push({ k, i, x: p.x, y: p.y, tx: p.tx, ty: p.ty,
        ax: p.x - p.nx * e, ay: p.y - p.ny * e, bx: p.x + p.nx * e, by: p.y + p.ny * e, s: p.s });
    }

    // 起跑格：位於起點線後方，左右交錯
    const grid = [];
    for (let g = 0; g < 8; g++) {
      const back = 70 + g * 58, idx = ((N - Math.round(back / ds)) % N + N) % N, p = pts[idx];
      const side = g % 2 ? 1 : -1, off = side * w * 0.24;
      grid.push({ x: p.x + p.nx * off, y: p.y + p.ny * off, a: Math.atan2(p.ty, p.tx), idx });
    }

    const sig = def.signature ? Object.assign({}, def.signature, { i: Math.round(def.signature.at * N) % N }) : null;

    const track = { def, id: def.id, pts, N, ds, length, width: w, half, cps, grid, zones, zoneIdx, signature: sig };

    /** 回傳最近的中心線位置。hint 為上次的索引，可避免交錯路段誤判 */
    track.locate = function (x, y, hint) {
      let bi = 0, bd = Infinity;
      const search = (from, to) => {
        for (let o = from; o <= to; o++) {
          const i = ((o % N) + N) % N, p = pts[i], dx = p.x - x, dy = p.y - y, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; bi = i; }
        }
      };
      if (hint == null || hint < 0) search(0, N - 1);
      else {
        search(hint - 25, hint + 25);
        if (bd > (w * 2.5) * (w * 2.5)) search(0, N - 1); // 遠離賽道時改全域搜尋
      }
      const p = pts[bi], dx = x - p.x, dy = y - p.y;
      const lat = dx * p.nx + dy * p.ny, along = dx * p.tx + dy * p.ty;
      return { i: bi, lat, along, d: Math.abs(lat), s: (p.s + along + length) % length };
    };

    /** 依位置判斷路面：road / wet / grass，並回傳下坡加速 */
    track.surface = function (i, lat) {
      if (Math.abs(lat) > half) return { type: 'grass', slope: 0 };
      let type = 'road', slope = 0, wet = 0;
      for (const z of zoneIdx[i]) {
        if (z.type === 'wet' && (z.side === 'all' || lat * z.innerSign > -12)) { type = 'wet'; wet = Math.max(wet, z.level == null ? 1 : z.level); }
        if (z.type === 'downhill') slope = 150;
      }
      return { type, slope, wet };
    };
    return track;
  }

  /** 兩線段相交檢查（p→q 與 a→b） */
  function segCross(px, py, qx, qy, ax, ay, bx, by) {
    const d1x = qx - px, d1y = qy - py, d2x = bx - ax, d2y = by - ay;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-9) return false;
    const t = ((ax - px) * d2y - (ay - py) * d2x) / den;
    const u = ((ax - px) * d1y - (ay - py) * d1x) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  const cache = {};
  function get(defs, id) { return cache[id] || (cache[id] = build(defs[id])); }

  return { build, get, segCross, DS };
});
