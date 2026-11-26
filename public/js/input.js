/* 霓虹夜行：輸入（鍵盤 + 觸控）。輸出統一格式 { throttle, brake, steer, s1, s2 } */
(function () {
  'use strict';
  const NND = window.NND = window.NND || {};

  const keys = Object.create(null);
  const edges = { s1: false, s2: false };
  const touch = { steer: 0, throttle: false, brake: false };
  let autoThrottle = false;
  let enabled = true;
  const listeners = { key: [] };

  const GAME_CODES = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);

  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  addEventListener('keydown', e => {
    if (isTyping(e)) return;
    if (GAME_CODES.has(e.code) && enabled && document.body.classList.contains('racing')) e.preventDefault();
    if (!e.repeat) {
      if (e.code === 'KeyQ') edges.s1 = true;
      if (e.code === 'KeyE') edges.s2 = true;
    }
    keys[e.code] = true;
    for (const fn of listeners.key) fn(e);
  });
  addEventListener('keyup', e => { keys[e.code] = false; });

  /** 清除所有輸入（切換視窗、來電、手勢中斷時） */
  function clearAll() {
    for (const k in keys) keys[k] = false;
    touch.steer = 0; touch.throttle = false; touch.brake = false;
    edges.s1 = edges.s2 = false;
    document.querySelectorAll('.tbtn.on').forEach(b => b.classList.remove('on'));
    const knob = document.getElementById('steerKnob'); if (knob) knob.style.transform = '';
  }
  addEventListener('blur', clearAll);
  addEventListener('pagehide', clearAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearAll(); });

  /* ---------- 觸控 ---------- */
  function setupTouch() {
    const pad = document.getElementById('steerPad'), knob = document.getElementById('steerKnob');
    let padId = null, ox = 0;
    const RANGE = 70;
    pad.addEventListener('pointerdown', e => {
      e.preventDefault();
      padId = e.pointerId; ox = e.clientX;
      try { pad.setPointerCapture(e.pointerId); } catch (err) { /* 指標已失效時略過 */ }
      const r = pad.getBoundingClientRect();
      knob.style.left = (e.clientX - r.left) + 'px'; knob.style.top = (e.clientY - r.top) + 'px';
      pad.classList.add('on');
    });
    pad.addEventListener('pointermove', e => {
      if (e.pointerId !== padId) return;
      const dx = Math.max(-RANGE, Math.min(RANGE, e.clientX - ox));
      touch.steer = dx / RANGE;
      knob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`;
    });
    const end = e => {
      if (e.pointerId !== padId) return;
      padId = null; touch.steer = 0; knob.style.transform = ''; pad.classList.remove('on');
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    pad.addEventListener('lostpointercapture', end);

    document.querySelectorAll('.tbtn').forEach(btn => {
      const act = btn.dataset.act;
      const down = e => {
        e.preventDefault();
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* 指標已失效時略過 */ }
        btn.classList.add('on');
        if (act === 'throttle') touch.throttle = true;
        else if (act === 'brake') touch.brake = true;
        else if (act === 's1') edges.s1 = true;
        else if (act === 's2') edges.s2 = true;
      };
      const up = () => {
        btn.classList.remove('on');
        if (act === 'throttle') touch.throttle = false;
        else if (act === 'brake') touch.brake = false;
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
      btn.addEventListener('contextmenu', e => e.preventDefault());
    });
    document.getElementById('touch').addEventListener('contextmenu', e => e.preventDefault());
  }

  /** 讀取目前輸入；consumeEdges 為 true 時會清除技能按下旗標 */
  function read(consumeEdges) {
    const up = keys.ArrowUp || keys.KeyW || touch.throttle;
    const dn = keys.ArrowDown || keys.KeyS || touch.brake;
    let steer = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
    if (!steer && touch.steer) steer = touch.steer;
    const out = {
      throttle: (up || (autoThrottle && !dn)) ? 1 : 0,
      brake: dn ? 1 : 0,
      steer: Math.max(-1, Math.min(1, steer)),
      s1: edges.s1, s2: edges.s2
    };
    if (consumeEdges) edges.s1 = edges.s2 = false;
    return out;
  }

  const isTouchDevice = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

  NND.input = {
    setupTouch, read, clearAll, isTouchDevice,
    keys,
    onKey(fn) { listeners.key.push(fn); },
    setAutoThrottle(v) { autoThrottle = !!v; },
    get autoThrottle() { return autoThrottle; },
    setEnabled(v) { enabled = v; if (!v) clearAll(); }
  };
})();
