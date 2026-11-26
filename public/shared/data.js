/* 霓虹夜行：遊戲資料（賽道、車輛、技能、規則、升級）
 * 瀏覽器：window.NND.data；Node：require('./data.js')
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.NND = root.NND || {}; root.NND.data = mod; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GAME_VERSION = '2.0.0';
  /** 規則版本：影響計時成績的物理或計圈規則改變時要遞增，成績依此分開保存 */
  const RULES_VERSION = 2;
  const SIM_DT = 1 / 60;
  const KMH = 0.4; // 世界速度（px/s）換算成畫面顯示的 km/h

  /* ---------------- 賽道 ----------------
   * points：封閉路線的控制點（Catmull-Rom），起點線位於 points[0]，行進方向為 points[0] → points[1]
   * zones：from/to 為賽道長度比例；wet 濕滑、downhill 下坡加速
   * signature：招牌彎，at 為賽道長度比例
   */
  const TRACKS = {
    city: {
      id: 'city', name: '霓虹市區', short: '市區', width: 170, laps: 3,
      theme: 'city', checkpoints: 8,
      desc: '寬路面、中速連彎，適合練習。',
      points: [[0,0],[900,-60],[1700,0],[2300,350],[2400,900],[1900,1300],[1300,1100],
               [900,1500],[300,1750],[-400,1450],[-650,800],[-420,300]],
      signature: { name: '百貨霓虹長右彎', at: 0.25, hint: '保持油門，沿外側進、內側出' },
      zones: []
    },
    harbor: {
      id: 'harbor', name: '高雄港灣雨夜', short: '港灣', width: 150, laps: 3,
      theme: 'harbor', checkpoints: 10,
      desc: '雨夜碼頭。髮夾彎內側積水濕滑，內線較短，外線抓地較穩。',
      points: [[0,0],[800,-30],[1600,0],[2000,300],[2050,800],[1700,1100],[1100,1150],
               [720,1300],[640,1750],[440,1990],[250,1750],[230,1300],[-50,850],[-250,350]],
      signature: { name: '碼頭髮夾彎', at: 0.535, hint: '內側積水：走外線較穩，走內線較短' },
      // 全場雨天濕滑（level 0.7），髮夾彎內側積水最滑（level 1）
      zones: [{ type: 'wet', from: 0, to: 1, side: 'all', level: 0.7 },
              { type: 'wet', from: 0.49, to: 0.585, side: 'inner', level: 1 }]
    },
    mountain: {
      id: 'mountain', name: '山城曙光', short: '山城', width: 140, laps: 3,
      theme: 'mountain', checkpoints: 10,
      desc: '晨光山路。連續 S 彎考驗換向節奏，之後接長下坡直線。',
      points: [[0,0],[600,0],[900,-180],[1200,0],[1500,-180],[1800,0],[2100,-180],[2500,-40],
               [2700,350],[2500,750],[2000,950],[1200,1000],[400,1000],[-200,850],[-450,450],[-300,100]],
      signature: { name: '曙光連續 S 彎', at: 0.12, hint: '提早換向，出彎再補油' },
      zones: [{ type: 'downhill', from: 0.62, to: 0.80, side: 'all' }]
    },
    industrial: {
      id: 'industrial', name: '未來工業環線', short: '工業', width: 160, laps: 3,
      theme: 'industrial', checkpoints: 9,
      desc: '超長直線發揮極速，盡頭是重煞彎。看清 300／200／100 煞車牌。',
      points: [[0,0],[1200,0],[2400,0],[3300,0],[3600,120],[3560,420],[3200,520],[2600,560],
               [2100,850],[1500,700],[900,950],[300,900],[-250,650],[-350,250]],
      signature: { name: '盡頭重煞彎', at: 0.30, hint: '看到 100 牌前就要重煞' },
      brakeBoards: true,
      zones: []
    },
    test: {
      id: 'test', name: '試駕彎道', short: '試駕', width: 150, laps: 99,
      theme: 'city', checkpoints: 4, hidden: true,
      desc: '固定的一小段彎道，用來比較車款。',
      points: [[0,0],[700,0],[1050,200],[1000,600],[650,650],[350,500],[0,650],[-300,450],[-300,100]],
      signature: { name: '試駕組合彎', at: 0.3, hint: '比較各車的入彎與出彎' },
      zones: [{ type: 'wet', from: 0.62, to: 0.72, side: 'all', level: 1 }]
    }
  };
  const TRACK_ORDER = ['city', 'harbor', 'mountain', 'industrial'];

  /* ---------------- 車輛 ----------------
   * maxSpeed：極速 px/s；accel：基礎推力；accelCurve：越大越能維持高速段加速
   * brake：煞車減速度；latAcc：側向抓地上限；grip：側滑回正速率
   * wetGrip：濕地抓地倍率；steerRate：最大轉向角速度；steerRef：達到完整轉向所需車速
   * hsLoss：高速轉向衰減；yawResp：車身反應；powerSlide：油門甩尾程度；oversteer：滑動時車尾外甩
   */
  const CARS = {
    swift: {
      id: 'swift', name: '夜燕', type: '電動卡丁車',
      desc: '起步快、短軸距、轉向靈活，長直線較吃虧。',
      maxSpeed: 590, accel: 1000, accelCurve: 0.9, brake: 980, drag: 0.30,
      latAcc: 1300, grip: 16, wetGrip: 0.62, steerRate: 3.1, steerRef: 150, hsLoss: 0.25,
      yawResp: 16, powerSlide: 0.05, oversteer: 0.4, offRoadCap: 190, offRoadDrag: 2.4,
      radius: 16, mass: 0.8, length: 40, widthPx: 24,
      look: { body: '#20e8ff', accent: '#ffffff', light: '#bfffff' }
    },
    mist: {
      id: 'mist', name: '海霧', type: '四驅拉力車',
      desc: '濕地抓地穩、煞車好，適合港灣賽道。',
      maxSpeed: 630, accel: 690, accelCurve: 1.6, brake: 1180, drag: 0.32,
      latAcc: 1120, grip: 14, wetGrip: 0.95, steerRate: 2.6, steerRef: 180, hsLoss: 0.32,
      yawResp: 11, powerSlide: 0.12, oversteer: 0.6, offRoadCap: 240, offRoadDrag: 1.8,
      radius: 18, mass: 1.1, length: 48, widthPx: 28,
      look: { body: '#3dff9a', accent: '#103020', light: '#fff6c0' }
    },
    shadow: {
      id: 'shadow', name: '墨影', type: '後驅甩尾車',
      desc: '車尾容易滑出，可用油門與反打修正，適合靠甩尾蓄能。',
      maxSpeed: 650, accel: 620, accelCurve: 1.5, brake: 920, drag: 0.30,
      latAcc: 920, grip: 7, wetGrip: 0.6, steerRate: 2.9, steerRef: 170, hsLoss: 0.28,
      yawResp: 10, powerSlide: 0.45, oversteer: 1.3, offRoadCap: 190, offRoadDrag: 2.4,
      radius: 18, mass: 1.0, length: 50, widthPx: 26,
      look: { body: '#b04dff', accent: '#1a0a28', light: '#e8d8ff' }
    },
    redline: {
      id: 'redline', name: '赤線', type: '高速原型車',
      desc: '極速高、煞車距離長，適合抓準出彎時機的玩家。',
      maxSpeed: 705, accel: 520, accelCurve: 2.8, brake: 680, drag: 0.26,
      latAcc: 800, grip: 13, wetGrip: 0.45, steerRate: 2.5, steerRef: 190, hsLoss: 0.36,
      yawResp: 8, powerSlide: 0.1, oversteer: 0.7, offRoadCap: 170, offRoadDrag: 2.8,
      radius: 19, mass: 1.15, length: 56, widthPx: 26,
      look: { body: '#ff3048', accent: '#ffffff', light: '#ffe0e0' }
    }
  };
  const CAR_ORDER = ['swift', 'mist', 'shadow', 'redline'];

  /* ---------------- 技能 ---------------- */
  const SKILLS = {
    nitro: { id: 'nitro', name: '氮氣加速', icon: 'N', color: '#ff2fd6',
      cost: 35, cooldown: 4, duration: 1.8, accelMul: 1.75, speedMul: 1.18,
      desc: '短時間提升推力，直線和出彎最有效。' },
    grip: { id: 'grip', name: '抓地強化', icon: 'G', color: '#3dff9a',
      cost: 25, cooldown: 6, duration: 2.5, gripMul: 1.7, wetImmune: true,
      desc: '短時間提高側向抓地，濕滑彎道或車尾失控時救車。' },
    recharge: { id: 'recharge', name: '電能回充', icon: 'R', color: '#ffe14a',
      cost: 0, cooldown: 9, duration: 5, gain: 40,
      desc: '啟動後 5 秒內完成「有效煞車入彎 → 順利出彎」可回復 40 能量。' }
  };
  const SKILL_ORDER = ['nitro', 'grip', 'recharge'];
  const ENERGY = { max: 100, start: 30, cleanCornerRate: 5, driftRate: 11 };

  /* ---------------- 比賽規則 ---------------- */
  const RULES = {
    countdown: 3,            // 倒數秒數
    ghostTime: 4,            // 起跑後幾秒內車輛互相穿透
    finishTimeout: 30,       // 第一名完賽後，其他人的完賽時限
    reconnectGrace: 30,      // 斷線保留秒數
    maxPlayers: 8,
    defaultLaps: 3,
    lapsChoices: [1, 2, 3, 5]
  };

  const DIFFICULTY = {
    easy:   { name: '簡單', speedMul: 0.82, brakeEarly: 1.35, lineNoise: 34, mistakeRate: 0.05, skillUse: 0.15, steerGain: 2.0 },
    normal: { name: '普通', speedMul: 0.92, brakeEarly: 1.12, lineNoise: 16, mistakeRate: 0.02, skillUse: 0.45, steerGain: 2.4 },
    hard:   { name: '困難', speedMul: 0.99, brakeEarly: 1.0,  lineNoise: 5,  mistakeRate: 0.004, skillUse: 0.9, steerGain: 2.8 }
  };

  /* ---------------- 外觀 ---------------- */
  const COSMETICS = {
    paint: [
      { id: 'stock', name: '原廠色', color: null, level: 1 },
      { id: 'sunset', name: '霓虹橘', color: '#ff8a1f', level: 2 },
      { id: 'aurora', name: '極光綠', color: '#5dffb0', level: 6 },
      { id: 'chrome', name: '鏡面銀', color: '#d8e4f0', level: 9 }
    ],
    rims: [
      { id: 'basic', name: '基本輪框', level: 1 },
      { id: 'star', name: '星芒輪框', level: 3 },
      { id: 'turbo', name: '渦輪輪框', level: 7 }
    ],
    taillight: [
      { id: 'red', name: '經典紅', color: '#ff2030', level: 1 },
      { id: 'violet', name: '霓紫', color: '#c040ff', level: 1 },
      { id: 'amber', name: '琥珀', color: '#ffb020', level: 5 }
    ],
    trail: [
      { id: 'none', name: '無尾流', level: 1 },
      { id: 'neon', name: '霓虹尾流', level: 1 },
      { id: 'bolt', name: '雷光尾流', level: 4 },
      { id: 'rainbow', name: '彩虹尾流', level: 8 }
    ]
  };

  /* ---------------- 經驗值 ---------------- */
  const XP = { finish: 100, podiumBonus: [60, 40, 20], newRecord: 80, firstMap: 150, perPositionAhead: 10 };
  function xpForLevel(level) { return 200 + (level - 1) * 100; } // 從 level 升到 level+1 所需
  /** 技能配置欄：每一欄是一組「兩種技能」的預設 */
  const PRESET_SLOTS = [{ level: 1 }, { level: 5 }, { level: 10 }];
  const MAX_LEVEL = 20;

  return { GAME_VERSION, RULES_VERSION, SIM_DT, KMH, TRACKS, TRACK_ORDER, CARS, CAR_ORDER,
    SKILLS, SKILL_ORDER, ENERGY, RULES, DIFFICULTY, COSMETICS, XP, xpForLevel, PRESET_SLOTS, MAX_LEVEL };
});
