'use strict';
// 乐器 = 武器。每件乐器定义：节奏型（按等级 / 段落 / 曲风）、音符、发声、攻击。
// 节奏型字符：. 休止  x 普通  X 重音  o 交替（开镲 / 高八度）  g 鬼音  2-9 长音（步数）

const INST_ORDER = ['kick', 'snare', 'hat', 'bass', 'pad', 'arp', 'stab', 'bell', 'toms', 'lead'];

const VEL = { X: 1, x: 0.8, o: 0.85, O: 1, g: 0.45 };
function patHits(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) if (str[i] !== '.') n++;
  return n;
}
function charDur(ch) {
  const d = ch.charCodeAt(0) - 48;
  return d >= 2 && d <= 9 ? d : 1;
}
// 铺垫段的滚奏：按段落进度加密
function rollPattern(I, base) {
  const p = I.p;
  if (I.lastBar) return 'XxxxXxxxXxxx....';
  if (p < 0.5) return base;
  if (p < 0.75) return 'X.x.x.x.x.x.x.x.';
  return 'Xxxxxxxxxxxxxxxx';
}
// 攻击目标方向：最近敌人，没有就用玩家朝向
function aimAt(x, y, range) {
  const e = W.nearestEnemy(x, y, range);
  if (e) return Math.atan2(e.y - y, e.x - x);
  return W.player.face;
}

const INST = {
  // ---------------------------------------------------------------- 底鼓
  kick: {
    id: 'kick', name: '底鼓', en: 'KICK', color: '#7ff6ff', icon: '◉', voice: 'kick', ref: 4,
    desc: '以你为中心的冲击波，范围伤害 + 击退',
    lv: [
      '每拍一圈冲击波',
      '冲击波伤害 +35%',
      '范围 +25%；每小节末加一个切分踢',
      '伤害 +35%，击退加强',
      '每小节第 1 拍变重拍：二次扩散',
      '范围 +30%，重拍让敌人减速',
    ],
    remix: { fx: 'overdrive', name: '硬核底鼓', en: 'HARDSTYLE', desc: '失真底鼓，冲击环留下灼烧圈' },
    bar(lv, I) {
      if (I.type === 'brk') return 'X...............';
      const f = I.feel.kick;
      let b;
      if (f === 'dnb') b = lv >= 3 ? 'X.x.......x...x.' : 'X.........x.....';
      else if (f === 'boombap') b = lv >= 3 ? 'X......x.xx.....' : 'X......x..x.....';
      else if (f === 'chip') b = lv >= 3 ? 'X...x...x...x.xx' : 'X...x...x...x...';
      else b = lv >= 3 ? 'X...x...x...x.x.' : 'X...x...x...x...';
      if (I.type === 'build') return rollPattern(I, b);
      return b;
    },
    notes(ch, lv, I) {
      return [{ vel: VEL[ch] || 0.8, heavy: lv >= 5 && I.pos === 0, big: I.type === 'brk' }];
    },
    sound(t, n, lv, I, P, rm) {
      const p = Object.assign({}, P);
      if (n.heavy || n.big) p.boom = 0.45;
      if (rm) { p.boom = 0.6; p.decay = (p.decay || 0.42) * 1.25; p.f0 = (p.f0 || 165) * 1.15; }
      Synth.kick(t, n.vel, p);
      if (rm) Synth.kick(t, n.vel * 0.35, Object.assign({}, p, { wave: 'square', click: 0 }));
      AE.duck(t, n.big ? 1.3 : 1);
    },
    fire(n, lv, ev) {
      const st = W.stats;
      const dmgMul = [1, 1.35, 1.35, 1.8, 1.8, 1.8][lv - 1];
      const radMul = [1, 1, 1.25, 1.25, 1.25, 1.6][lv - 1];
      const knock = lv >= 4 ? 420 : 260;
      const roll = ev.hits > 4;
      const R = 125 * radMul * st.area * (roll ? 0.75 : 1) * (n.big ? 1.5 : 1);
      const dmg = 12 * dmgMul * ev.norm * W.dmgMul() * ev.scale;
      const p = W.player;
      W.spawnWave({ x: p.x, y: p.y, maxR: R, dur: 0.24, dmg, knock, color: INST.kick.rgb, slow: lv >= 6 && n.heavy, burn: ev.remix, inst: 'kick', ghost: ev.ghost });
      if (n.heavy) {
        W.later(0.12, () => W.spawnWave({ x: p.x, y: p.y, maxR: R * 1.4, dur: 0.3, dmg: dmg * 0.6, knock, color: INST.kick.rgb, inst: 'kick', burn: ev.remix }));
      }
      W.kickPulse(n.vel * (n.big ? 1.6 : 1));
    },
  },

  // ---------------------------------------------------------------- 军鼓
  snare: {
    id: 'snare', name: '军鼓', en: 'SNARE', color: '#ff5fb4', icon: '✸', voice: 'snare', ref: 2,
    desc: '2、4 拍朝移动方向打出扇形碎片，穿透',
    lv: [
      '2、4 拍打出 5 片扇形碎片',
      '伤害 +35%',
      '碎片 +2；每小节末加一个鬼音',
      '碎拍鬼音型：更多小碎片',
      '碎片穿透 +3，射程 +30%',
      '重音时向身后也打出一扇',
    ],
    remix: { fx: 'reverb', name: '门限军鼓', en: 'GATED', desc: '碎片停下时炸开一圈门限混响冲击' },
    bar(lv, I) {
      if (I.type === 'brk') return '........X.......';
      if (I.type === 'build') return rollPattern(I, '....X.......X...');
      const f = I.feel.snare;
      if (f === 'dnb') {
        if (lv >= 4) return '..g.X..g.g..X.g.';
        if (lv >= 3) return '....X..g.g..X...';
        return '....X.......X...';
      }
      if (lv >= 4) return '....X..g....X.g.';
      if (lv >= 3) return '....X.......X..g';
      return '....X.......X...';
    },
    notes(ch, lv, I) {
      return [{ vel: VEL[ch] || 0.8, ghost: ch === 'g', acc: ch === 'X' }];
    },
    sound(t, n, lv, I, P, rm) {
      const p = rm ? Object.assign({}, P, { gated: true }) : P;
      Synth.snare(t, n.vel, p);
    },
    fire(n, lv, ev) {
      const st = W.stats;
      const p = W.player;
      const cnt = (n.ghost ? 3 : lv >= 3 ? 8 : 6) + st.extra;
      const dmg = 14 * (lv >= 2 ? 1.35 : 1) * ev.norm * W.dmgMul() * ev.scale * (n.ghost ? 0.5 : 1);
      const spread = 1.0;
      const life = 0.55 * (lv >= 5 ? 1.3 : 1);
      const base = p.moving ? p.face : aimAt(p.x, p.y, 500);
      const fan = (dir) => {
        for (let i = 0; i < cnt; i++) {
          const a = dir + (cnt === 1 ? 0 : (i / (cnt - 1) - 0.5) * spread);
          W.spawnShot({
            x: p.x, y: p.y, ang: a, speed: 720 + (i % 2) * 60, r: 7 * st.area, len: 20, dmg,
            pierce: 2 + (lv >= 5 ? 3 : 0), life, color: INST.snare.rgb, shape: 3, inst: 'snare',
            gated: ev.remix, ghost: ev.ghost,
          });
        }
      };
      fan(base);
      if (lv >= 6 && n.acc) fan(base + Math.PI);
    },
  },

  // ---------------------------------------------------------------- 踩镲
  hat: {
    id: 'hat', name: '踩镲', en: 'HI-HAT', color: '#ffd84a', icon: '⁂', voice: 'hat', ref: 8,
    desc: '朝最近的敌人连射光弹；开镲弹更大并穿透',
    lv: [
      '反拍开镲：每小节 4 发',
      '加入 8 分闭镲：每小节 8 发',
      '每发变 2 发散射',
      '16 分闭镲：每小节 16 发',
      '伤害 +40%',
      '开镲弹命中后分裂成 4 片',
    ],
    remix: { fx: 'delay', name: '幽灵镲', en: 'GHOST HATS', desc: '每发光弹都带两发延迟回声' },
    bar(lv, I) {
      const f = I.feel.hat;
      if (I.type === 'brk') return lv >= 4 ? 'x.o.x.o.x.o.x.o.' : '..o...o...o...o.';
      if (lv >= 4) {
        if (f === 'lofi') return 'x.xox.xox.xox.xo';
        if (f === 'synth' || f === 'dnb') return 'xxxxxxoxxxxxxxox';
        return 'xxoxxxoxxxoxxxox';
      }
      if (lv >= 2) {
        if (f === 'synth' || f === 'dnb' || f === 'lofi') return 'x.x.x.o.x.x.x.o.';
        return 'x.o.x.o.x.o.x.o.';
      }
      return '..o...o...o...o.';
    },
    notes(ch) {
      return [{ vel: VEL[ch] || 0.8, open: ch === 'o' || ch === 'O' }];
    },
    sound(t, n, lv, I, P) {
      Synth.hat(t, n.vel, n.open, P);
    },
    fire(n, lv, ev) {
      const st = W.stats;
      const p = W.player;
      const ang = aimAt(p.x, p.y, 700);
      const per = (lv >= 3 ? 2 : 1) + st.extra;
      const dmg = (n.open ? 9 : 6) * (lv >= 5 ? 1.4 : 1) * ev.norm * W.dmgMul() * ev.scale;
      for (let i = 0; i < per; i++) {
        const a = ang + (per === 1 ? 0 : (i / (per - 1) - 0.5) * 0.24) + (Math.random() - 0.5) * 0.04;
        const shot = {
          x: p.x, y: p.y, ang: a, speed: n.open ? 820 : 980, r: (n.open ? 7 : 5) * st.area, len: n.open ? 26 : 18,
          dmg, pierce: n.open ? 1 : 0, life: 0.9, color: INST.hat.rgb, shape: 6, inst: 'hat',
          split: lv >= 6 && n.open, ghost: ev.ghost,
        };
        W.spawnShot(shot);
        if (ev.remix && !ev.ghost) {
          [3, 6].forEach((k, j) => W.later(Seq.stepDur() * k, () => {
            W.spawnShot(Object.assign({}, shot, { x: W.player.x, y: W.player.y, ang: aimAt(W.player.x, W.player.y, 700), dmg: dmg * 0.6, ghost: true }));
          }));
        }
      }
    },
  },

  // ---------------------------------------------------------------- 贝斯
  bass: {
    id: 'bass', name: '贝斯', en: 'BASS', color: '#a66bff', icon: '≋', voice: 'bass', ref: 4,
    desc: '从你身上射出的穿透激光；长音会扫过一段弧',
    lv: [
      '反拍根音：每个音一道激光',
      '激光长度 +30%',
      '滚动贝斯型，音符更多',
      '长音变扫射：激光扫过 100° 弧',
      '伤害 +40%，激光变粗',
      '高八度同时朝反方向再射一道',
    ],
    remix: { fx: 'sidechain', name: '摇摆贝斯', en: 'WOBBLE', desc: '所有激光随 LFO 摆动，并把敌人吸向光束' },
    bar(lv, I) {
      const f = I.feel.bass;
      if (I.type === 'brk') return '8.......8.......';
      if (I.type === 'build') {
        if (I.p >= 0.75) return 'xxxxxxxxxxxxxxxx';
        if (I.p >= 0.5) return 'x.x.x.x.x.x.x.x.';
      }
      const even = I.barIn % 2 === 0;
      if (f === 'octave') {
        if (lv >= 4 && even) return '4...x.o.4...x.o.';
        if (lv >= 3) return 'xoxoxoxoxoxoxoxo';
        return 'x.o.x.o.x.o.x.o.';
      }
      if (f === 'dnb') {
        if (lv >= 3) return '6.....x.6.....xo';
        return '8.......4...x.x.';
      }
      if (f === 'chip') {
        if (lv >= 4 && even) return '4...x.o.x.o.x.o.';
        if (lv >= 3) return 'x.xox.xox.xox.xo';
        return 'x.x.x.x.x.x.x.x.';
      }
      if (f === 'lofi') {
        if (lv >= 3) return '3......2..3...o.';
        return '3......2..3.....';
      }
      if (lv >= 4 && even) return '4.....xo..xo..xo';
      if (lv >= 3) return '..xo..xo..xo..xo';
      return '..x...x...x...x.';
    },
    notes(ch, lv, I) {
      const root = Harmony.rootIn(I.chord, 31);
      const chip = I.feel.bass === 'chip';
      const up = ch === 'o' ? (chip ? 7 : 12) : 0;
      return [{ midi: root + up, dur: charDur(ch), vel: VEL[ch] || 0.85 }];
    },
    sound(t, n, lv, I, P, rm) {
      const dur = n.dur * I.stepDur * 0.92;
      const wob = rm ? I.bpm / 60 * 2 : (lv >= 4 && n.dur >= 3 ? I.bpm / 60 : 0);
      Synth.bass(t, n.midi, dur, n.vel, P, { wobble: wob });
      if (lv >= 6) Synth.bass(t, n.midi + 12, dur, n.vel * 0.35, Object.assign({}, P, { sub: null }));
    },
    fire(n, lv, ev) {
      const st = W.stats;
      const p = W.player;
      const len = 390 * (lv >= 2 ? 1.3 : 1) * st.area;
      const width = 16 * (lv >= 5 ? 1.5 : 1) * Math.sqrt(st.area);
      const dmg = 14 * (lv >= 5 ? 1.4 : 1) * ev.norm * W.dmgMul() * ev.scale;
      const long = n.dur >= 3;
      const dur = long ? n.dur * Seq.stepDur() : 0.13;
      const a0 = aimAt(p.x, p.y, len + 80);
      const sweep = long && lv >= 4 ? 1.75 * (Math.random() < 0.5 ? 1 : -1) : 0;
      // 激光很占画面：合唱最多多一道（其余合唱加成折算成伤害）
      const beams = 1 + Math.min(1, st.extra);
      const extraDmg = 1 + 0.35 * Math.max(0, st.extra - 1);
      for (let i = 0; i < beams; i++) {
        const off = beams === 1 ? 0 : (i / (beams - 1) - 0.5) * 0.7;
        const b = { ang: a0 + off - sweep / 2, sweep, len, width, dmg: dmg * extraDmg, tick: long ? 0.12 : 0, tickDmg: dmg * extraDmg * 0.25, dur, color: INST.bass.rgb, inst: 'bass', wobble: ev.remix, pull: ev.remix, ghost: ev.ghost };
        W.spawnBeam(b);
        if (lv >= 6) W.spawnBeam(Object.assign({}, b, { ang: b.ang + Math.PI, width: width * 0.7, dmg: dmg * 0.7, tickDmg: b.tickDmg * 0.7 }));
      }
    },
  },

  // ---------------------------------------------------------------- 铺底 Pad
  pad: {
    id: 'pad', name: '铺底', en: 'PAD', color: '#ff8ad8', icon: '◌', voice: 'pad', noNorm: true, ignoreSilent: true,
    desc: '周身光环随八分音符跳动伤害；换和弦时脉冲并给护盾',
    lv: [
      '光环每 8 分音符造成伤害，换和弦时脉冲',
      '光环范围 +20%',
      '换和弦时获得护盾（抵挡一次伤害）',
      '光环伤害 +50%',
      '范围 +25%，光环内敌人减速',
      '和弦脉冲伤害翻倍并回复 2 生命',
    ],
    remix: { fx: 'compressor', name: '天穹', en: 'DOME', desc: '光环 +40%，护盾可叠 2 层' },
    bar() {
      return 'X.x.x.x.x.x.x.x.';
    },
    notes(ch, lv, I) {
      return [{ chord: ch === 'X' && (I.pos === 0), vel: 0.8 }];
    },
    sound(t, n, lv, I, P) {
      if (!n.chord) return;
      const v = Harmony.voice(I.chord, Seq.S.padVoice, 52, 74);
      Seq.S.padVoice = v;
      Synth.pad(t, v, I.barDur * 0.98, 1.25, P, (P.cutoff || 1500) * 1.4);
    },
    fire(n, lv, ev) {
      W.padTick(n.chord, lv, ev);
    },
  },

  // ---------------------------------------------------------------- 琶音
  arp: {
    id: 'arp', name: '琶音', en: 'ARP', color: '#5cff9d', icon: '♪', voice: 'pluck', ref: 8,
    desc: '每个音发一颗追踪音符，颜色由音高决定',
    lv: [
      '8 分音符琶音，每音一发追踪弹',
      '音域扩到 2 个八度',
      '16 分音符门控节奏型',
      '伤害 +35%，追踪转向更快',
      '每个音叠高八度，多发一颗',
      '命中后弹射到下一个敌人，弹射音高上行',
    ],
    remix: { fx: 'chorus', name: '超锯齿琶音', en: 'SUPERSAW', desc: '每个音分裂成 3 颗扇形追踪弹' },
    bar(lv, I) {
      if (I.type === 'build' && I.p >= 0.75) return 'xxxxxxxxxxxxxxxx';
      if (lv >= 3) return I.feel.kick === 'chip' ? 'xxxxxxxxxxxxxxxx' : 'xx.x.xx.xx.x.xx.';
      return 'x.x.x.x.x.x.x.x.';
    },
    notes(ch, lv, I) {
      const S = Seq.S;
      const oct = lv >= 2 ? 2 : 1;
      const lo = 57 + (((I.key - 57) % 12) + 12) % 12; // 主音落在 A3–G#4 之间
      const list = Harmony.arpNotes(I.chord, lo, oct);
      list.push(list[0] + 12 * oct);
      const seq = list.concat(list.slice(1, -1).reverse()); // 上下行
      const m = seq[S.arpCount++ % seq.length];
      const out = [{ midi: m, vel: VEL[ch] || 0.8 }];
      if (lv >= 5) out.push({ midi: m + 12, vel: 0.45, dbl: true });
      return out;
    },
    sound(t, n, lv, I, P, rm) {
      const panV = ((n.midi % 24) / 24 - 0.5) * 0.9;
      const p = rm ? Object.assign({}, P, { detune: 22 }) : P;
      Synth.pluck(t, n.midi, I.stepDur * 0.9, n.vel * (n.dbl ? 0.6 : 1), p, panV);
      if (rm) Synth.pluck(t, n.midi + 12, I.stepDur * 0.9, n.vel * 0.3, p, -panV);
    },
    fire(n, lv, ev) {
      const st = W.stats;
      const p = W.player;
      const pf = U.clamp(1.25 - (n.midi - 60) * 0.015, 0.8, 1.3);
      const dmg = 7 * (lv >= 4 ? 1.35 : 1) * ev.norm * W.dmgMul() * ev.scale * pf;
      const count = (ev.remix ? 3 : 1) + (n.dbl ? 0 : st.extra);
      const base = (Seq.S.arpCount * 2.39996) % TAU;
      for (let i = 0; i < count; i++) {
        W.spawnHomer({
          x: p.x, y: p.y, ang: base + i * (ev.remix ? 0.5 : TAU / count), speed: 340 + (n.midi - 60) * 8,
          turn: lv >= 4 ? 11 : 7, r: 6.5 * Math.sqrt(st.area) * (n.dbl ? 0.75 : 1), dmg: n.dbl ? dmg * 0.6 : dmg,
          life: 2.3, midi: n.midi, color: U.pitchColor(n.midi, 1), bounce: lv >= 6 ? 2 : 0, inst: 'arp', ghost: ev.ghost,
        });
      }
    },
  },

  // ---------------------------------------------------------------- 和弦 Stab
  stab: {
    id: 'stab', name: '和弦 Stab', en: 'CHORD STAB', color: '#ff7a4a', icon: '✦', voice: 'stab', ref: 2,
    desc: '每个和弦音向一个方向射出重型光束，环形散开',
    lv: [
      '切分位置的和弦，每个和弦音一发重弹',
      '伤害 +40%',
      '更密的切分节奏型',
      '每次打出两圈（交错）',
      '穿透无限，弹体变大',
      '弹体在射程尽头爆炸',
    ],
    remix: { fx: 'exciter', name: '锐舞和弦', en: 'RAVE STAB', desc: '每发重弹沿途留下爆炸火花' },
    bar(lv, I) {
      if (I.type === 'brk') return '.......X........';
      if (lv >= 3) return '...X..X....X..X.';
      return '......X.......X.';
    },
    notes(ch, lv, I) {
      return [{ vel: VEL[ch] || 0.85 }];
    },
    sound(t, n, lv, I, P) {
      const v = Harmony.voice(I.chord, null, 62, 79);
      Synth.stab(t, v, n.vel, P);
    },
    fire(n, lv, ev) {
      const st = W.stats;
      const p = W.player;
      const tones = ev.I.chord.iv.length;
      const rings = lv >= 4 ? 2 : 1;
      const dmg = 16 * (lv >= 2 ? 1.4 : 1) * ev.norm * W.dmgMul() * ev.scale;
      const rot = (Seq.S.stabCount++ * 2.39996) % TAU;
      const cnt = tones + st.extra;
      for (let r = 0; r < rings; r++) {
        for (let i = 0; i < cnt; i++) {
          const a = rot + (i + r * 0.5) / cnt * TAU;
          const midi = 60 + ev.I.chord.pc + ev.I.chord.iv[i % tones];
          W.spawnShot({
            x: p.x, y: p.y, ang: a, speed: 560 - r * 80, r: 10 * st.area * (lv >= 5 ? 1.35 : 1), len: 30, dmg,
            pierce: lv >= 5 ? 999 : 3, life: 0.9, color: U.pitchColor(midi, 1.2), shape: 7, inst: 'stab', spin: 9,
            explode: lv >= 6 ? 70 * st.area : 0, sparks: ev.remix, ghost: ev.ghost,
          });
        }
      }
    },
  },

  // ---------------------------------------------------------------- 钟琴
  bell: {
    id: 'bell', name: '钟琴', en: 'BELL', color: '#9fe8ff', icon: '⌁', voice: 'bell', ref: 2,
    desc: '链式闪电在敌人之间弹跳，每跳一次音高上行',
    lv: [
      '每小节 2 次，弹跳 3 次',
      '弹跳 +1',
      '伤害 +40%；每小节 3 次',
      '弹跳 +2；每小节 5 次',
      '每次弹跳附带小范围爆裂',
      '弹跳 +2，伤害 +30%',
    ],
    remix: { fx: 'lfo', name: '风铃', en: 'CHIMES', desc: '每次闪电分叉成两条链' },
    bar(lv, I) {
      if (lv >= 4) return 'x..x..x...x..x..';
      if (lv >= 3) return 'x.....x.....x...';
      return 'x.......x.......';
    },
    notes(ch, lv, I) {
      const S = Seq.S;
      const pent = Harmony.pentaNotes(I.key, I.mode, 74, 93);
      if (S.bellIdx === undefined) S.bellIdx = 3;
      S.bellIdx = U.clamp(S.bellIdx + [-2, -1, 1, 2, 1][Math.floor(Math.random() * 5)], 0, pent.length - 6);
      // 强拍落和弦音
      let m = pent[S.bellIdx];
      if (I.pos % 8 === 0) {
        const ct = Harmony.chordNotesInRange(I.chord, 74, 93);
        m = ct.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a), ct[0]);
      }
      return [{ midi: m, vel: VEL[ch] || 0.8, pent, idx: pent.indexOf(m) }];
    },
    sound(t, n, lv, I, P) {
      Synth.bell(t, n.midi, n.vel, P);
    },
    fire(n, lv, ev) {
      const jumps = [3, 4, 4, 6, 6, 8][lv - 1];
      const dmg = 14 * (lv >= 3 ? 1.4 : 1) * (lv >= 6 ? 1.3 : 1) * ev.norm * W.dmgMul() * ev.scale;
      W.spawnChain({ jumps, dmg, splash: lv >= 5 ? 45 : 0, fork: ev.remix, midi: n.midi, pent: n.pent, idx: n.idx, ghost: ev.ghost });
    },
  },

  // ---------------------------------------------------------------- 嗵鼓
  toms: {
    id: 'toms', name: '嗵鼓', en: 'TOMS', color: '#ffae3c', icon: '⬢', voice: 'tom', noNorm: true,
    desc: '乐句末的过门：光柱从天而降轰击敌群',
    lv: [
      '每 4 小节末一段过门，4 道光柱',
      '光柱范围 +25%',
      '每 2 小节一段过门',
      '光柱伤害 +50%',
      '光柱落点留下燃烧地面',
      '每小节都有过门，光柱成对落下',
    ],
    remix: { fx: 'metronome', name: '定音鼓', en: 'TIMPANI', desc: '光柱变巨大，并让敌人眩晕一拍' },
    bar(lv, I) {
      const every = lv >= 6 ? 1 : lv >= 3 ? 2 : 4;
      const fill = (I.barIn + 1) % every === 0 || I.lastBar;
      if (!fill) return lv >= 4 ? '..........x.....' : '................';
      if (I.type === 'brk') return '........x...x...';
      return lv >= 4 ? '........x.x.xxxx' : '............xxxx';
    },
    notes(ch, lv, I) {
      const S = Seq.S;
      const pent = Harmony.pentaNotes(I.key, I.mode, 40, 60);
      const k = (S.tomIdx = ((S.tomIdx || 0) + 1) % 4);
      const m = pent[Math.max(0, pent.length - 2 - (I.pos % 4) * 2 - (k % 2))];
      return [{ midi: m, vel: VEL[ch] || 0.85 }];
    },
    sound(t, n, lv, I, P) {
      Synth.tom(t, n.midi, n.vel, P);
    },
    fire(n, lv, ev) {
      const st = W.stats;
      const r = 72 * (lv >= 2 ? 1.25 : 1) * st.area * (ev.remix ? 1.6 : 1);
      const dmg = 34 * (lv >= 4 ? 1.5 : 1) * W.dmgMul() * ev.scale * (128 / Seq.S.bpm);
      const k = (lv >= 6 ? 2 : 1) + st.extra;
      for (let i = 0; i < k; i++) {
        const e = W.randomEnemyNear(W.player.x, W.player.y, 620);
        const x = e ? e.x : W.player.x + (Math.random() - 0.5) * 600;
        const y = e ? e.y : W.player.y + (Math.random() - 0.5) * 400;
        W.spawnPillar({ x, y, r, dmg, burn: lv >= 5, stun: ev.remix, color: INST.toms.rgb, ghost: ev.ghost });
      }
    },
  },

  // ---------------------------------------------------------------- 主旋律
  lead: {
    id: 'lead', name: '主旋律', en: 'LEAD', color: '#ffffff', icon: '♫', voice: 'lead', ref: 4,
    desc: '旋律音符沿正弦轨迹飞行，穿透一切；长音更大更痛',
    lv: [
      '每 2 小节一句旋律，每个音一发',
      '伤害 +35%',
      '旋律更密',
      '加三度和声：第二条镜像轨迹',
      '音符更大，飞得更远',
      '音符留下闪光拖尾，持续伤害',
    ],
    remix: { fx: 'mastering', name: '独奏', en: 'SOLO', desc: '每个音符同时射向四个方向' },
    bar(lv, I) {
      const S = Seq.S;
      const dense = lv >= 3;
      const T = dense
        ? ['2.x.x.2.x.4.....', '4...x.x.2.2.x...', 'x.x.2.x.x.x.4...', '2.2.x.x.4...x.x.']
        : ['4.......2.2.....', '4...2...4.......', '2.2.4.......2...', '6.......2.2.....'];
      const k = (I.bar * 7 + S.seed) % T.length;
      if (I.type === 'brk') return I.barIn % 2 ? '................' : '8.......4...2...';
      if (!dense && I.barIn % 2 === 1) return T[(k + 1) % T.length].replace(/./g, (c, i) => (i < 8 ? c : '.'));
      return T[k];
    },
    notes(ch, lv, I) {
      const S = Seq.S;
      const pent = Harmony.pentaNotes(I.key, I.mode, 67, 88);
      if (S.leadIdx === undefined) S.leadIdx = Math.floor(pent.length / 2);
      const stepMove = [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)];
      S.leadIdx = U.clamp(S.leadIdx + stepMove, 1, pent.length - 2);
      let m = pent[S.leadIdx];
      if (I.pos % 4 === 0) {
        const ct = Harmony.chordNotesInRange(I.chord, 67, 88);
        m = ct.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a), ct[0]);
        S.leadIdx = pent.indexOf(m) >= 0 ? pent.indexOf(m) : S.leadIdx;
      }
      const prev = S.leadPrev;
      S.leadPrev = m;
      const out = [{ midi: m, dur: charDur(ch), vel: VEL[ch] || 0.85, glide: prev }];
      if (lv >= 4) {
        const ct = Harmony.chordNotesInRange(I.chord, m - 9, m - 1);
        if (ct.length) out.push({ midi: ct[ct.length - 1], dur: charDur(ch), vel: 0.5, harm: true });
      }
      return out;
    },
    sound(t, n, lv, I, P) {
      Synth.lead(t, n.midi, n.dur * I.stepDur * 0.95, n.vel * (n.harm ? 0.6 : 1), P, n.harm ? null : n.glide);
    },
    fire(n, lv, ev) {
      const st = W.stats;
      const p = W.player;
      const dmg = 12 * (lv >= 2 ? 1.35 : 1) * ev.norm * W.dmgMul() * ev.scale * (0.8 + n.dur * 0.2);
      const a0 = aimAt(p.x, p.y, 700);
      const dirs = ev.remix ? 4 : 1;
      for (let d = 0; d < dirs; d++) {
        for (let i = 0; i < 1 + st.extra; i++) {
          W.spawnShot({
            x: p.x, y: p.y, ang: a0 + d * (TAU / 4) + i * 0.25, speed: 480, r: (8 + n.dur * 1.5) * st.area * (lv >= 5 ? 1.3 : 1),
            len: 10, dmg, pierce: 999, life: 1.4 * (lv >= 5 ? 1.35 : 1), color: U.pitchColor(n.midi, 1.3), shape: 0, inst: 'lead',
            wave: n.harm ? -1 : 1, waveAmp: 38, trail: lv >= 6, ghost: ev.ghost,
          });
        }
      }
    },
  },
};

INST_ORDER.forEach((id) => {
  INST[id].rgb = U.hex(INST[id].color, 1);
});
