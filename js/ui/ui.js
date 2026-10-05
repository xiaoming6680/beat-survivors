'use strict';
// 游戏内 HUD：时间轴、调音台、律动 VU 表、横幅、倒数、判定、Boss 血条。只在数值变化时写 DOM。

const UI = (() => {
  const $ = (id) => document.getElementById(id);
  const cache = {};
  function setText(el, key, v) {
    if (cache[key] !== v) {
      cache[key] = v;
      el.textContent = v;
    }
  }
  function setStyle(el, key, prop, v) {
    if (cache[key] !== v) {
      cache[key] = v;
      el.style[prop] = v;
    }
  }
  let els = null;
  let vuCtx = null;
  let vuNeedle = 0;
  let mixerKey = '';
  let fxKey = '';
  const meters = {};
  let hintTimer = 0;

  function init() {
    els = {
      hud: $('hud'), tlSecs: $('tl-secs'), tlHead: $('tl-head'), tlSec: $('tl-sec'), tlInfo: $('tl-info'),
      bossBar: $('boss-bar'), bossName: $('boss-name'), bossFill: $('boss-fill'),
      hpFill: $('hp-fill'), hpText: $('hp-text'), lv: $('lv'), combo: $('combo'), vuLabel: $('vu-label'),
      mixer: $('mixer'), fxrack: $('fxrack'), time: $('time'), kills: $('kills'), key: $('keyinfo'), chord: $('chord'),
      xp: $('xp-fill'), banner: $('banner'), count: $('count'), judge: $('judge'), toast: $('toast'), hint: $('hint'),
    };
    vuCtx = $('vu').getContext('2d');
  }

  function show(on) {
    els.hud.classList.toggle('show', on);
  }

  function restart(el) {
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }

  function banner(cn, en, big) {
    els.banner.querySelector('.b-cn').textContent = cn;
    els.banner.querySelector('.b-en').textContent = en;
    els.banner.classList.toggle('big', !!big);
    restart(els.banner);
  }
  function countdown(n) {
    if (!n) return;
    els.count.textContent = n;
    restart(els.count);
  }
  function judge(grade, off, combo) {
    const ms = Math.round(off * 1000);
    let txt;
    if (grade === 'perfect') txt = combo > 1 ? `完美 ×${combo}` : '完美';
    else if (grade === 'good') txt = ms < 0 ? '好 · 偏早' : '好 · 偏晚';
    else txt = ms < 0 ? '早了' : '晚了';
    if (Game.debug) txt += `  ${ms > 0 ? '+' : ''}${ms}ms`;
    els.judge.textContent = txt;
    els.judge.className = 'judge ' + grade;
    restart(els.judge);
  }
  function toastBig(cn, en) {
    els.toast.innerHTML = `<div class="t-cn">${cn}</div><div class="t-en">${en}</div>`;
    restart(els.toast);
  }
  function hint(html, sec = 5) {
    els.hint.innerHTML = html;
    els.hint.classList.add('show');
    hintTimer = sec;
  }
  function grooveUp(tier) {
    toastBig(`律动 ${['', 'I', 'II', 'III'][tier]}`, 'GROOVE');
  }

  // 时间轴
  function buildTimeline() {
    const secs = Song.S.sections;
    const total = Song.S.totalBars;
    els.tlSecs.innerHTML = '';
    for (const s of secs) {
      const d = document.createElement('div');
      d.className = 'tl-sec' + (s.boss ? ' boss' : '');
      d.style.left = (s.start / total) * 100 + '%';
      d.style.width = (s.bars / total) * 100 + '%';
      d.style.background = SECTION_TYPES[s.type].color;
      d.title = SECTION_TYPES[s.type].name;
      d.dataset.idx = s.idx;
      els.tlSecs.appendChild(d);
    }
    mixerKey = '';
    fxKey = '';
    els.bossBar.classList.remove('show');
  }
  function section(sec) {
    els.tlSecs.querySelectorAll('.tl-sec').forEach((d) => d.classList.toggle('past', +d.dataset.idx < sec.idx));
  }

  // Boss
  let bossShown = null;
  function bossIn(def) {
    bossShown = def;
    els.bossName.textContent = `${def.name} · ${def.en}`;
    els.bossBar.classList.add('show');
    toastBig(def.name, def.en);
  }
  function bossDown(def) {
    toastBig(`${def.name} 击破`, 'DEFEATED');
  }
  function bossGone() {
    els.bossBar.classList.remove('show');
  }

  function buildMixer() {
    const ids = INST_ORDER.filter((id) => W.inst[id]);
    const key = ids.map((id) => id + W.inst[id] + (W.remix[id] ? 'r' : '')).join(',');
    if (key === mixerKey) return;
    mixerKey = key;
    els.mixer.innerHTML = '';
    for (const id of ids) {
      const d = INST[id];
      const lv = W.inst[id];
      const row = document.createElement('div');
      row.className = 'ch';
      row.style.setProperty('--c', d.color);
      let pips = '';
      for (let i = 0; i < 6; i++) pips += `<i class="pip${i < lv ? ' on' : ''}"></i>`;
      row.innerHTML = `<span class="ic">${d.icon}</span><span class="nm">${W.remix[id] ? d.remix.name : d.name}${W.remix[id] ? '<span class="rm">REMIX</span>' : ''}</span><span class="pips">${pips}</span><span class="meter"><i></i></span>`;
      els.mixer.appendChild(row);
      meters[id] = row.querySelector('.meter i');
    }
  }
  function buildFx() {
    const ids = FX_ORDER.filter((id) => W.fx[id]);
    const key = ids.map((id) => id + W.fx[id]).join(',');
    if (key === fxKey) return;
    fxKey = key;
    els.fxrack.innerHTML = ids.map((id) => `<span class="fxchip" style="--c:${FX[id].color}">${FX[id].icon} ${FX[id].name}<b>${W.fx[id]}</b></span>`).join('');
  }

  function drawVU(dt) {
    const c = vuCtx;
    const w = 180, h = 96;
    c.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h - 14, r = 70;
    const a0 = Math.PI * 1.1, a1 = Math.PI * 1.9;
    // 刻度弧
    const zones = [[0, 30, '#3d6bff'], [30, 60, '#2fd6c4'], [60, 90, '#ffd23f'], [90, 100, '#ff3c7a']];
    for (const [s, e, col] of zones) {
      c.beginPath();
      c.arc(cx, cy, r, a0 + (a1 - a0) * (s / 100), a0 + (a1 - a0) * (e / 100));
      c.strokeStyle = col;
      c.globalAlpha = W.groove >= s ? 0.95 : 0.25;
      c.lineWidth = 5;
      c.shadowColor = col;
      c.shadowBlur = W.groove >= s ? 8 : 0;
      c.stroke();
    }
    c.globalAlpha = 1;
    c.shadowBlur = 0;
    for (let i = 0; i <= 10; i++) {
      const a = a0 + (a1 - a0) * (i / 10);
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10));
      c.lineTo(cx + Math.cos(a) * (r - (i % 5 ? 14 : 18)), cy + Math.sin(a) * (r - (i % 5 ? 14 : 18)));
      c.strokeStyle = 'rgba(200,210,255,0.4)';
      c.lineWidth = 1;
      c.stroke();
    }
    // 指针（带一点物理惯性 + 随拍子抖）
    const target = W.groove / 100 + W.kick * 0.03;
    vuNeedle += (target - vuNeedle) * Math.min(1, dt * 10);
    const a = a0 + (a1 - a0) * U.clamp(vuNeedle, 0, 1.02);
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    c.shadowColor = '#fff';
    c.shadowBlur = 8;
    c.stroke();
    c.shadowBlur = 0;
    c.beginPath();
    c.arc(cx, cy, 4, 0, TAU);
    c.fillStyle = '#fff';
    c.fill();
  }

  function update(dt) {
    if (!els) return;
    const p = W.player;
    const S = Seq.S;
    const sd = Seq.stepDur();
    // 时间轴
    const total = Song.S.totalBars;
    const bar = Math.max(0, W.bar);
    const pos = W.curI ? W.curI.pos : 0;
    const frac = (bar + pos / 16) / total;
    setStyle(els.tlHead, 'tlh', 'left', (Math.min(1, frac) * 100).toFixed(2) + '%');
    const I = W.curI;
    if (I) {
      const st = SECTION_TYPES[I.type];
      setText(els.tlSec, 'tls', `${st.name} ${st.en}`);
      let info = '';
      // 下一个 Drop 还有几小节
      const next = Song.S.sections.find((s) => s.type === 'drop' && s.start > bar);
      if (I.type === 'build' || (next && next.start - bar <= 8)) {
        const n = next ? next.start - bar : 0;
        info = n > 0 ? `距 爆发 <b>${n}</b> 小节` : '';
      } else if (I.sec.final && S.flags.overtime) info = `加时 ×${S.flags.overtime}`;
      else info = `第 ${bar + 1} / ${total} 小节`;
      if (cache.tli !== info) {
        cache.tli = info;
        els.tlInfo.innerHTML = info;
      }
      setText(els.chord, 'chd', Harmony.chordName(I.chord));
      setText(els.key, 'key', `${Harmony.keyName(I.key, W.style.mode)} · ${W.style.bpm} BPM`);
    }
    // 生命 / 等级
    setStyle(els.hpFill, 'hpf', 'width', ((p.hp / p.maxHp) * 100).toFixed(1) + '%');
    setText(els.hpText, 'hpt', `${Math.ceil(p.hp)} / ${p.maxHp}`);
    setText(els.lv, 'lv', `Lv ${W.level}`);
    setText(els.combo, 'cmb', W.combo >= 2 ? `完美连击 ${W.combo}` : '');
    setText(els.vuLabel, 'vul', W.grooveTier ? `律动 ${['', 'I', 'II', 'III'][W.grooveTier]}` : '律动');
    setStyle(els.xp, 'xpw', 'width', ((W.xp / W.xpNext) * 100).toFixed(1) + '%');
    setText(els.time, 'tm', U.fmtTime(S.songSteps * sd));
    setText(els.kills, 'kl', String(W.kills));
    buildMixer();
    buildFx();
    for (const id in meters) {
      const f = W.instFlash[id] || 0;
      meters[id].style.transform = `scaleY(${f.toFixed(2)})`;
      W.instFlash[id] = f * Math.exp(-dt * 9);
    }
    drawVU(dt);
    // Boss 血条
    const bosses = W.enemies.filter((e) => e.boss && !e.leaving);
    if (bosses.length) {
      const b = bosses[0];
      setStyle(els.bossFill, 'bf', 'width', Math.max(0, (b.hp / b.maxHp) * 100).toFixed(1) + '%');
    } else if (els.bossBar.classList.contains('show') && !W.enemies.some((e) => e.boss)) {
      els.bossBar.classList.remove('show');
    }
    if (hintTimer > 0) {
      hintTimer -= dt;
      if (hintTimer <= 0) els.hint.classList.remove('show');
    }
  }

  return { init, show, banner, countdown, judge, toastBig, hint, grooveUp, buildTimeline, section, bossIn, bossDown, bossGone, update };
})();
