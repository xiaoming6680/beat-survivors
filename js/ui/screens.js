'use strict';
// 菜单与各个界面：启动、主菜单、角色、升级、宝箱、暂停、结算、工作室、唱片架、成就、设置、说明。

const Screens = (() => {
  const $ = (id) => document.getElementById(id);
  let current = null;
  const stack = [];

  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('show', s.id === id));
    current = id;
    focusFirst();
  }
  function hideAll() {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('show'));
    current = null;
  }
  function push(id) {
    stack.push(current);
    show(id);
  }
  function pop() {
    const prev = stack.pop();
    if (prev) show(prev);
    else hideAll();
    return prev;
  }

  // ---------------- 键盘导航（菜单内上下 / 左右移动焦点）----------------
  function focusables() {
    if (!current) return [];
    const root = $(current);
    return Array.from(root.querySelectorAll('button:not([disabled]), .char:not(.locked), .rec button'));
  }
  function focusFirst() {
    const f = focusables();
    const pri = f.find((b) => b.classList.contains('primary')) || f[0];
    if (pri && pri.focus) pri.focus({ preventScroll: true });
  }
  function moveFocus(d) {
    const f = focusables();
    if (!f.length) return;
    let i = f.indexOf(document.activeElement);
    i = i < 0 ? 0 : (i + d + f.length) % f.length;
    f[i].focus({ preventScroll: true });
    Synth.ui('move', 84 + (i % 5) * 2);
  }

  function bindActs(rootId, handlers) {
    $(rootId).addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const h = handlers[b.dataset.act];
      if (h) {
        Synth.ui(b.dataset.act === 'back' ? 'back' : 'select', 72);
        h(b);
      }
    });
  }

  // ---------------- 主菜单 ----------------
  function refreshMenu() {
    const D = Meta.D;
    $('menu-notes').innerHTML = `音符 <b>${D.notes} ♪</b>`;
    $('menu-best').textContent = D.stats.runs ? `演出 ${D.stats.runs} 场 · 通关 ${D.stats.clears} · 最多击杀 ${D.stats.bestKills}` : '';
  }

  // ---------------- 角色 ----------------
  let selStyle = 'house';
  function buildChars() {
    const list = $('char-list');
    list.innerHTML = '';
    selStyle = Meta.isStyleUnlocked(Meta.D.lastStyle) ? Meta.D.lastStyle : 'house';
    for (const id of STYLE_ORDER) {
      const st = STYLES[id];
      const unlocked = Meta.isStyleUnlocked(id);
      const d = document.createElement('div');
      d.className = 'char' + (unlocked ? '' : ' locked') + (id === selStyle ? ' sel' : '');
      d.tabIndex = unlocked ? 0 : -1;
      d.style.setProperty('--c', st.color);
      d.dataset.id = id;
      const best = Meta.D.best[id];
      const u = Meta.UNLOCK.style[id];
      const ach = u && Meta.ACH.find((a) => a.id === u.ach);
      d.innerHTML = `
        <div class="c-name">${st.char}</div>
        <div class="c-en">${st.charEn}</div>
        <div class="c-genre">${st.genre} · ${st.bpm} BPM</div>
        <div class="c-row">${Harmony.keyName(st.key, st.mode)}</div>
        <div class="c-desc">${st.desc}</div>
        <div class="c-row">起始乐器 <b>${INST[st.start].name}</b></div>
        <div class="c-row">被动 <b>${st.passiveText}</b></div>
        ${best ? `<div class="c-best">最佳 ${best.grade} · ${best.score}${best.clear ? ' · 已通关' : ''}</div>` : ''}
        ${unlocked ? '' : `<div class="c-lock">🔒 ${ach ? '成就「' + ach.name + '」：' + ach.desc : ''}<br>或在工作室用 ${u.price} ♪ 解锁</div>`}`;
      d.addEventListener('click', () => selectChar(id));
      d.addEventListener('focus', () => selectChar(id, true));
      d.addEventListener('dblclick', () => { if (unlocked) Game.startRun(id); });
      list.appendChild(d);
    }
  }
  function selectChar(id, quiet) {
    if (!Meta.isStyleUnlocked(id)) return;
    if (selStyle === id && quiet) return;
    selStyle = id;
    document.querySelectorAll('.char').forEach((c) => c.classList.toggle('sel', c.dataset.id === id));
    Game.setAccent(STYLES[id]);
    Game.menuMusic(STYLES[id]);
    if (!quiet) Synth.ui('move', 79);
  }

  // ---------------- 升级 / 宝箱 ----------------
  let lvOpts = [], lvSel = 0, lvOnPick = null;
  function cardHTML(c, i) {
    let pips = '';
    if (c.pips) {
      for (let k = 0; k < c.pips[1]; k++) pips += `<i class="pip${k < c.pips[0] ? ' on' : ''}${k === c.pips[0] ? ' next' : ''}"></i>`;
    }
    return `<div class="card${c.remix ? ' remix' : ''}" style="--c:${c.color}" data-i="${i}">
      <span class="k-num">${i + 1}</span><span class="k-type">${c.type}</span>
      <div class="k-icon">${c.icon}</div>
      <div class="k-name">${c.name}</div>
      <div class="k-en">${c.en}</div>
      ${c.tag ? `<span class="k-tag${c.isNew ? ' new' : ''}">${c.tag}</span>` : ''}
      <div class="k-desc">${c.desc}</div>
      ${c.sub ? `<div class="k-sub">${c.sub}</div>` : ''}
      ${pips ? `<div class="pips">${pips}</div>` : ''}
      <span class="k-listen">♪ 试听中</span>
    </div>`;
  }
  function showLevel(opts, onPick, title) {
    lvOpts = opts;
    lvOnPick = onPick;
    $('lvup-title').textContent = title || '升级';
    $('lvup-en').textContent = title ? 'BONUS' : 'LEVEL UP · Lv ' + W.level;
    const box = $('cards');
    box.innerHTML = opts.map((o, i) => cardHTML(Upgrades.card(o), i)).join('');
    box.querySelectorAll('.card').forEach((el) => {
      el.addEventListener('mouseenter', () => highlight(+el.dataset.i));
      el.addEventListener('click', () => pickLevel(+el.dataset.i));
    });
    $('lv-reroll').textContent = `R 刷新（${W.rerolls}）`;
    $('lv-reroll').classList.toggle('off', W.rerolls <= 0);
    $('lv-banish').textContent = `X 放逐（${W.banishes}）`;
    $('lv-banish').classList.toggle('off', W.banishes <= 0);
    show('scr-level');
    lvSel = -1;
    highlight(0);
  }
  function highlight(i) {
    if (i === lvSel || i < 0 || i >= lvOpts.length) return;
    lvSel = i;
    document.querySelectorAll('#cards .card').forEach((el) => el.classList.toggle('sel', +el.dataset.i === i));
    Game.previewOption(lvOpts[i]);
    Synth.ui('move', 86 + i * 3);
  }
  function pickLevel(i) {
    if (!lvOnPick || i < 0 || i >= lvOpts.length) return;
    const cb = lvOnPick;
    lvOnPick = null;
    Synth.ui('select', 74);
    cb(lvOpts[i]);
  }
  function levelKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') highlight((lvSel - 1 + lvOpts.length) % lvOpts.length);
    else if (k === 'arrowright' || k === 'd') highlight((lvSel + 1) % lvOpts.length);
    else if (k >= '1' && k <= '4') { highlight(+k - 1); pickLevel(+k - 1); }
    else if (k === ' ' || k === 'enter') pickLevel(lvSel);
    else if (k === 'r') Game.reroll();
    else if (k === 'x') Game.banish(lvOpts[lvSel]);
    else return false;
    return true;
  }

  let chestCb = null, chestReady = false;
  function showChest(items, onDone) {
    const box = $('chest-items');
    box.innerHTML = '';
    chestCb = onDone;
    chestReady = false;
    $('chest-hint').style.visibility = 'hidden';
    show('scr-chest');
    const bd = Seq.beatDur();
    items.forEach((o, i) => {
      setTimeout(() => {
        box.insertAdjacentHTML('beforeend', cardHTML(Upgrades.card(o), i));
        const el = box.lastElementChild;
        el.classList.add('reveal', 'sel');
        el.querySelector('.k-listen').textContent = '已获得';
        Synth.crash(AE.Clock.sched() + 0.01, 0.4, {});
        Synth.ui('select', 72 + i * 4);
      }, (i + 1) * bd * 1000);
    });
    setTimeout(() => { chestReady = true; $('chest-hint').style.visibility = 'visible'; }, (items.length + 1) * bd * 1000);
  }
  function chestKey(e) {
    if ((e.key === ' ' || e.key === 'Enter') && chestReady && chestCb) {
      const cb = chestCb;
      chestCb = null;
      cb();
      return true;
    }
    return false;
  }

  // ---------------- 暂停 ----------------
  function showPause() {
    const ids = INST_ORDER.filter((id) => W.inst[id]);
    $('pause-build').innerHTML = ids.map((id) => `<span class="fxchip" style="--c:${INST[id].color}">${INST[id].icon} ${INST[id].name}<b>${W.inst[id]}</b></span>`).join('') +
      FX_ORDER.filter((id) => W.fx[id]).map((id) => `<span class="fxchip" style="--c:${FX[id].color}">${FX[id].icon} ${FX[id].name}<b>${W.fx[id]}</b></span>`).join('');
    show('scr-pause');
  }

  // ---------------- 结算 ----------------
  function drawArrangement(canvas, data, playhead) {
    const secs = data.sections;
    const total = data.totalBars;
    const lanes = data.lanes; // [{id, name, color, from, levels:[{bar,lv}], remixBar}]
    const W0 = Math.min(980, window.innerWidth * 0.82);
    const laneH = 18;
    const H0 = 26 + lanes.length * (laneH + 4) + 8;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W0 * dpr;
    canvas.height = H0 * dpr;
    canvas.style.width = W0 + 'px';
    canvas.style.height = H0 + 'px';
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W0, H0);
    const left = 86, right = W0 - 8, w = right - left;
    const x = (bar) => left + (Math.min(bar, total) / total) * w;
    // 段落条
    for (const s of secs) {
      c.fillStyle = SECTION_TYPES[s.type].color;
      c.globalAlpha = 0.6;
      c.fillRect(x(s.start), 4, x(s.start + s.bars) - x(s.start) - 1, 12);
      c.globalAlpha = 0.07;
      c.fillRect(x(s.start), 20, x(s.start + s.bars) - x(s.start) - 1, H0 - 24);
    }
    c.globalAlpha = 1;
    c.font = '12px "Microsoft YaHei UI", sans-serif';
    c.textBaseline = 'middle';
    lanes.forEach((L, i) => {
      const y = 24 + i * (laneH + 4);
      c.fillStyle = L.color;
      c.fillText(L.name, 6, y + laneH / 2);
      const end = data.endBar;
      for (let k = 0; k < L.levels.length; k++) {
        const a = L.levels[k];
        const b = k + 1 < L.levels.length ? L.levels[k + 1].bar : end;
        const bright = 0.25 + (a.lv / L.max) * 0.65;
        c.globalAlpha = bright;
        c.fillStyle = L.color;
        c.shadowColor = L.color;
        c.shadowBlur = 6;
        c.fillRect(x(a.bar), y, Math.max(1, x(b) - x(a.bar) - 1), laneH);
        c.shadowBlur = 0;
        c.globalAlpha = 1;
        c.fillStyle = '#05040d';
        if (x(b) - x(a.bar) > 16) c.fillText(String(a.lv), x(a.bar) + 3, y + laneH / 2 + 1);
      }
      if (L.remixBar !== undefined) {
        c.fillStyle = '#ffd84a';
        c.fillText('★', x(L.remixBar) - 6, y + laneH / 2);
      }
    });
    if (playhead !== undefined) {
      c.fillStyle = '#fff';
      c.shadowColor = '#fff';
      c.shadowBlur = 8;
      c.fillRect(x(playhead), 2, 2, H0 - 4);
      c.shadowBlur = 0;
    }
  }

  function showResults(r, gain) {
    $('res-title').textContent = r.clear ? '演出完成 · ENCORE' : '演出中断 · CUT';
    $('res-song').textContent = `《${r.name}》`;
    $('res-meta').textContent = `${STYLES[r.style].char} · ${STYLES[r.style].genre} · ${Harmony.keyName(STYLES[r.style].key, STYLES[r.style].mode)} · ${STYLES[r.style].bpm} BPM · ${U.fmtTime(r.time)}`;
    $('res-grade').textContent = r.grade;
    drawArrangement($('res-canvas'), r.arr);
    const st = [
      ['时长', U.fmtTime(r.time)], ['击杀', r.kills], ['等级', r.level], ['Boss', `${r.bossKills.length} / 3`],
      ['完美冲刺', r.perfects], ['最长连击', r.maxCombo], ['最高律动', ['—', 'I', 'II', 'III'][r.maxGroove]], ['受到伤害', Math.round(r.dmgTaken)],
    ];
    $('res-stats').innerHTML = st.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    let g = `<div>获得 <span class="notes">+${gain.notes} ♪</span>　·　分数 ${r.score}</div>`;
    for (const a of gain.newAch) g += `<div class="gain-ach">★ 成就「${a.name}」${a.unlock ? ' — ' + a.unlock : ''}</div>`;
    $('res-gain').innerHTML = g;
    show('scr-results');
  }

  // ---------------- 工作室 ----------------
  function buildShop() {
    const D = Meta.D;
    $('shop-notes').textContent = `${D.notes} ♪`;
    const list = $('shop-list');
    list.innerHTML = '';
    for (const item of Meta.SHOP) {
      const lv = D.shop[item.id] || 0;
      const max = lv >= item.max;
      const cost = Meta.shopCost(item);
      let pips = '';
      for (let i = 0; i < item.max; i++) pips += `<i class="pip${i < lv ? ' on' : ''}"></i>`;
      const row = document.createElement('div');
      row.className = 'shop-item' + (max ? ' done' : '');
      row.innerHTML = `<div><div class="s-name">${item.name}</div><div class="s-desc">${item.desc}</div></div><div class="pips">${pips}</div>
        <button ${max || D.notes < cost ? 'disabled' : ''}>${max ? '已满' : cost + ' ♪'}</button>`;
      row.querySelector('button').addEventListener('click', () => {
        if (Meta.buyShop(item.id)) { Synth.ui('coin', 84); buildShop(); } else Synth.ui('deny');
      });
      list.appendChild(row);
    }
    const ul = $('unlock-list');
    ul.innerHTML = '';
    const add = (kind, id, name, desc) => {
      const u = Meta.UNLOCK[kind][id];
      const have = kind === 'style' ? Meta.isStyleUnlocked(id) : Meta.isInstUnlocked(id);
      const ach = Meta.ACH.find((a) => a.id === u.ach);
      const row = document.createElement('div');
      row.className = 'shop-item' + (have ? ' done' : '');
      row.innerHTML = `<div><div class="s-name">${name}</div><div class="s-desc">${desc}${have ? '' : '<br>或达成成就「' + ach.name + '」：' + ach.desc}</div></div><div></div>
        <button ${have || D.notes < u.price ? 'disabled' : ''}>${have ? '已解锁' : u.price + ' ♪'}</button>`;
      row.querySelector('button').addEventListener('click', () => {
        if (Meta.buyUnlock(kind, id)) { Synth.ui('coin', 79); buildShop(); } else Synth.ui('deny');
      });
      ul.appendChild(row);
    };
    for (const id of Object.keys(Meta.UNLOCK.style)) add('style', id, `角色：${STYLES[id].char}`, `${STYLES[id].genre} · ${STYLES[id].bpm} BPM`);
    for (const id of Object.keys(Meta.UNLOCK.inst)) add('inst', id, `乐器：${INST[id].name}`, INST[id].desc);
  }

  // ---------------- 唱片架 ----------------
  function buildRecords() {
    const list = $('rec-list');
    const recs = Meta.D.records.slice().reverse();
    if (!recs.length) {
      list.innerHTML = '<div class="empty">还没有唱片。打一局超过 2 分钟的演出吧。</div>';
      return;
    }
    list.innerHTML = '';
    recs.forEach((r) => {
      const st = STYLES[r.style];
      const row = document.createElement('div');
      row.className = 'rec';
      row.dataset.id = r.id;
      const d = new Date(r.date);
      row.innerHTML = `<div><div class="r-name">《${r.name}》</div><div class="r-meta">${st.char} · ${st.genre} · ${U.fmtTime(r.time)} · 击杀 ${r.kills} · ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}${r.clear ? ' · 通关' : ''}</div></div>
        <div class="r-grade">${r.grade}</div><div class="r-btns"><button data-r="play">▶ 播放</button><button data-r="wav">导出 WAV</button></div>`;
      row.querySelector('[data-r=play]').addEventListener('click', () => Game.playRecord(r));
      row.querySelector('[data-r=wav]').addEventListener('click', (e) => Game.exportRecord(r, e.target));
      list.appendChild(row);
    });
  }

  // ---------------- 成就 ----------------
  function buildAch() {
    const D = Meta.D;
    const n = Meta.ACH.filter((a) => D.ach[a.id]).length;
    $('ach-count').textContent = `${n} / ${Meta.ACH.length}`;
    $('ach-list').innerHTML = Meta.ACH.map((a) => `<div class="ach${D.ach[a.id] ? ' on' : ''}"><div class="a-name">${D.ach[a.id] ? '★' : '☆'} ${a.name}</div><div class="a-desc">${a.desc}</div>${a.unlock ? `<div class="a-unlock">${a.unlock}</div>` : ''}</div>`).join('');
  }

  // ---------------- 设置 ----------------
  function buildSettings() {
    const s = Meta.D.settings;
    const box = $('settings-list');
    const slider = (key, label, min, max, step, fmt) => `<div class="set-row"><label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-k="${key}"><span class="val" data-v="${key}">${fmt(s[key])}</span></div>`;
    const seg = (key, label, opts) => `<div class="set-row"><label>${label}</label><div class="seg">${opts.map(([v, t]) => `<button data-seg="${key}" data-val="${v}" class="${String(s[key]) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div><span></span></div>`;
    const pct = (v) => Math.round(v * 100) + '%';
    box.innerHTML =
      slider('master', '总音量', 0, 1, 0.01, pct) +
      slider('music', '音乐', 0, 1, 0.01, pct) +
      slider('sfx', '音效', 0, 1, 0.01, pct) +
      slider('latency', '音频延迟补偿', -150, 250, 5, (v) => v + 'ms') +
      seg('flash', '闪光', [['normal', '正常'], ['reduced', '减弱']]) +
      seg('fxAlpha', '玩家特效', [[1, '100%'], [0.85, '85%'], [0.6, '60%'], [0.4, '40%']]) +
      seg('shake', '屏幕震动', [[true, '开'], [false, '关']]) +
      seg('quality', '画质', [['high', '高'], ['low', '性能']]) +
      seg('showFps', '显示帧率', [[true, '开'], [false, '关']]);
    box.querySelectorAll('input[type=range]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.k;
        s[k] = parseFloat(inp.value);
        box.querySelector(`[data-v="${k}"]`).textContent = k === 'latency' ? s[k] + 'ms' : pct(s[k]);
        Game.applySettings();
      });
      inp.addEventListener('change', () => Meta.save());
    });
    box.querySelectorAll('[data-seg]').forEach((b) => {
      b.addEventListener('click', () => {
        const k = b.dataset.seg;
        let v = b.dataset.val;
        if (v === 'true') v = true;
        else if (v === 'false') v = false;
        else if (!isNaN(parseFloat(v))) v = parseFloat(v);
        s[k] = v;
        box.querySelectorAll(`[data-seg="${k}"]`).forEach((x) => x.classList.toggle('on', x === b));
        Game.applySettings();
        Meta.save();
        Synth.ui('move', 84);
      });
    });
  }

  return {
    show, hideAll, push, pop, moveFocus, bindActs, refreshMenu, buildChars, showLevel, levelKey, highlight, showChest, chestKey,
    showPause, showResults, drawArrangement, buildShop, buildRecords, buildAch, buildSettings,
    get current() { return current; },
    get selStyle() { return selStyle; },
  };
})();
