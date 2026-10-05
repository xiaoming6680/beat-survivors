'use strict';
// 局外成长与存档：设置、音符货币、工作室强化、解锁、成就、唱片架。全部存 localStorage。

const Meta = (() => {
  const KEY = 'beat-survivors-v1';

  const SHOP = [
    { id: 'hp', name: '生命', desc: '最大生命 +10', max: 5, base: 60 },
    { id: 'dmg', name: '力量', desc: '所有伤害 +5%', max: 5, base: 90 },
    { id: 'area', name: '范围', desc: '攻击范围 +5%', max: 3, base: 90 },
    { id: 'speed', name: '移速', desc: '移动速度 +4%', max: 3, base: 70 },
    { id: 'pickup', name: '拾取', desc: '拾取范围 +15%', max: 3, base: 50 },
    { id: 'xp', name: '经验', desc: '经验获取 +5%', max: 5, base: 90 },
    { id: 'armor', name: '护甲', desc: '受到伤害 −3%', max: 3, base: 100 },
    { id: 'dash', name: '冲刺', desc: '冲刺回复 −8% 时间', max: 2, base: 110 },
    { id: 'reroll', name: '刷新', desc: '每局升级刷新 +1 次', max: 3, base: 120 },
    { id: 'banish', name: '放逐', desc: '每局放逐 +1 次（移出卡池）', max: 3, base: 120 },
    { id: 'revive', name: '安可', desc: '阵亡时复活一次（50% 生命）', max: 1, base: 700 },
  ];

  const ACH = [
    { id: 'first_run', name: '首演', desc: '完成第一局演出' },
    { id: 'beat_subwoofer', name: '拆掉低音炮', desc: '击败 Boss「低音炮」', unlock: '解锁乐器：和弦 Stab' },
    { id: 'beat_spectrum', name: '频谱分析', desc: '击败 Boss「频谱」', unlock: '解锁角色：霓虹（Synthwave）' },
    { id: 'clear_any', name: '谢幕', desc: '通关一次（击败指挥家）', unlock: '解锁角色：雾（Lo-fi）、乐器：主旋律' },
    { id: 'kills_run_1500', name: '千人斩', desc: '单局击杀 1500', unlock: '解锁乐器：钟琴' },
    { id: 'kills_total_3000', name: '降噪', desc: '累计击杀 3000', unlock: '解锁角色：方波（Chiptune）' },
    { id: 'perfect_40', name: '踩点大师', desc: '单局完美冲刺 40 次', unlock: '解锁角色：碎拍（DnB）' },
    { id: 'six_inst', name: '满编乐队', desc: '单局拥有 6 件乐器', unlock: '解锁乐器：嗵鼓' },
    { id: 'remix', name: '混音师', desc: '第一次获得 Remix 进化' },
    { id: 'groove3', name: '入迷', desc: '达到律动 III' },
    { id: 'grade_s', name: '神级现场', desc: '拿到 S 评级' },
    { id: 'all_styles', name: '全曲风', desc: '用全部 5 个角色各通关一次' },
  ];

  // 解锁条件：成就或购买
  const UNLOCK = {
    style: {
      chip: { ach: 'kills_total_3000', price: 400 },
      synthwave: { ach: 'beat_spectrum', price: 500 },
      dnb: { ach: 'perfect_40', price: 500 },
      lofi: { ach: 'clear_any', price: 600 },
    },
    inst: {
      stab: { ach: 'beat_subwoofer', price: 200 },
      bell: { ach: 'kills_run_1500', price: 250 },
      toms: { ach: 'six_inst', price: 250 },
      lead: { ach: 'clear_any', price: 350 },
    },
  };

  const defaults = () => ({
    v: 1,
    settings: { master: 0.8, music: 1, sfx: 0.8, flash: 'normal', quality: 'high', latency: 0, shake: true, showFps: false, fxAlpha: 0.85 },
    notes: 0,
    totalNotes: 0,
    shop: {},
    bought: { style: [], inst: [] },
    ach: {},
    stats: { runs: 0, clears: 0, kills: 0, bestTime: 0, bestKills: 0, bestLevel: 0, perfects: 0 },
    best: {},
    clearedStyles: {},
    records: [],
    seenTutorial: false,
    lastStyle: 'house',
  });

  let D = defaults();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const o = JSON.parse(raw);
        D = Object.assign(defaults(), o);
        D.settings = Object.assign(defaults().settings, o.settings || {});
        D.stats = Object.assign(defaults().stats, o.stats || {});
        D.bought = Object.assign({ style: [], inst: [] }, o.bought || {});
      }
    } catch (e) {
      D = defaults();
    }
    return D;
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(D));
    } catch (e) {
      // 存满了：丢掉最老的唱片再试
      if (D.records.length > 3) {
        D.records.splice(0, Math.ceil(D.records.length / 3));
        try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e2) { /* 放弃 */ }
      }
    }
  }

  function isStyleUnlocked(id) {
    if (id === 'house') return true;
    const u = UNLOCK.style[id];
    return !u || !!D.ach[u.ach] || D.bought.style.includes(id) || Game.devUnlock;
  }
  function isInstUnlocked(id) {
    const u = UNLOCK.inst[id];
    return !u || !!D.ach[u.ach] || D.bought.inst.includes(id) || Game.devUnlock;
  }

  function shopCost(item) {
    const lv = D.shop[item.id] || 0;
    return Math.round((item.base * Math.pow(1 + lv, 1.45)) / 5) * 5;
  }
  function buyShop(id) {
    const item = SHOP.find((s) => s.id === id);
    const lv = D.shop[id] || 0;
    if (!item || lv >= item.max) return false;
    const c = shopCost(item);
    if (D.notes < c) return false;
    D.notes -= c;
    D.shop[id] = lv + 1;
    save();
    return true;
  }
  function refundShop() {
    let back = 0;
    for (const item of SHOP) {
      const lv = D.shop[item.id] || 0;
      for (let i = 0; i < lv; i++) back += Math.round((item.base * Math.pow(1 + i, 1.45)) / 5) * 5;
    }
    D.notes += back;
    D.shop = {};
    save();
    return back;
  }
  function buyUnlock(kind, id) {
    const u = UNLOCK[kind][id];
    if (!u || D.notes < u.price) return false;
    D.notes -= u.price;
    D.bought[kind].push(id);
    save();
    return true;
  }

  // 局内用的局外加成
  function runMeta() {
    return Object.assign({}, D.shop);
  }

  function grant(id, out) {
    if (D.ach[id]) return;
    D.ach[id] = Date.now();
    const a = ACH.find((x) => x.id === id);
    if (a) out.push(a);
  }

  // 一局结束：结算货币、成就、纪录、唱片
  function finishRun(r) {
    const out = { newAch: [], notes: 0 };
    const S = D.stats;
    S.runs++;
    S.kills += r.kills;
    S.perfects += r.perfects;
    S.bestKills = Math.max(S.bestKills, r.kills);
    S.bestLevel = Math.max(S.bestLevel, r.level);
    S.bestTime = Math.max(S.bestTime, r.time);
    if (r.clear) {
      S.clears++;
      D.clearedStyles[r.style] = true;
    }
    grant('first_run', out.newAch);
    if (r.bossKills.includes('subwoofer')) grant('beat_subwoofer', out.newAch);
    if (r.bossKills.includes('spectrum')) grant('beat_spectrum', out.newAch);
    if (r.clear) grant('clear_any', out.newAch);
    if (r.kills >= 1500) grant('kills_run_1500', out.newAch);
    if (S.kills >= 3000) grant('kills_total_3000', out.newAch);
    if (r.perfects >= 40) grant('perfect_40', out.newAch);
    if (r.instCount >= 6) grant('six_inst', out.newAch);
    if (r.remixes > 0) grant('remix', out.newAch);
    if (r.maxGroove >= 3) grant('groove3', out.newAch);
    if (r.grade === 'S') grant('grade_s', out.newAch);
    if (STYLE_ORDER.every((s) => D.clearedStyles[s])) grant('all_styles', out.newAch);
    const notes = Math.round(r.kills / 40 + 30 * r.bossKills.length + (r.clear ? 90 : 0) + r.level * 2 + r.perfects * 0.5 + (r.bonusNotes || 0));
    out.notes = notes;
    D.notes += notes;
    D.totalNotes += notes;
    const b = D.best[r.style] || {};
    if (!b.score || r.score > b.score) D.best[r.style] = { score: r.score, grade: r.grade, time: r.time, clear: r.clear };
    // 唱片（2 分钟以上才收）
    if (r.time >= 120 && r.record) {
      D.records.push(r.record);
      if (D.records.length > 24) D.records.shift();
    }
    save();
    return out;
  }

  return {
    load, save, SHOP, ACH, UNLOCK, isStyleUnlocked, isInstUnlocked, shopCost, buyShop, refundShop, buyUnlock, runMeta, finishRun,
    get D() { return D; },
  };
})();
