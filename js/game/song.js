'use strict';
// 曲式：段落表 + 和弦查询 + 小节推进（加时循环 / 尾声跳转）。
// 段落长度按 128 BPM 设计，其它曲风按 BPM 缩放到相近的时长，并取 4 的倍数。

const SECTION_TYPES = {
  intro: { name: '前奏', en: 'INTRO', color: '#3d6bff' },
  groove: { name: '律动', en: 'GROOVE', color: '#2fd6c4' },
  build: { name: '铺垫', en: 'BUILD UP', color: '#ffd23f' },
  drop: { name: '爆发', en: 'DROP', color: '#ff3c7a' },
  brk: { name: '回落', en: 'BREAKDOWN', color: '#9d5bff' },
  outro: { name: '尾声', en: 'OUTRO', color: '#7a8cff' },
  menu: { name: '', en: '', color: '#444' },
};

const FORM_128 = [
  { id: 'intro', type: 'intro', bars: 16, prog: 'main' },
  { id: 'grooveA', type: 'groove', bars: 24, prog: 'main' },
  { id: 'build1', type: 'build', bars: 8, prog: 'build' },
  { id: 'drop1', type: 'drop', bars: 32, prog: 'main', boss: 'subwoofer' },
  { id: 'break1', type: 'brk', bars: 16, prog: 'brk', elites: 1 },
  { id: 'grooveB', type: 'groove', bars: 32, prog: 'alt' },
  { id: 'build2', type: 'build', bars: 8, prog: 'build', rings: 2 },
  { id: 'drop2', type: 'drop', bars: 32, prog: 'alt', boss: 'spectrum' },
  { id: 'break2', type: 'brk', bars: 16, prog: 'brk2', elites: 2 },
  { id: 'build3', type: 'build', bars: 8, prog: 'build', rings: 3, silentEnd: true },
  { id: 'final', type: 'drop', bars: 48, prog: 'main', key: 2, boss: 'conductor', final: true },
  { id: 'outro', type: 'outro', bars: 16, prog: 'outro', key: 2 },
];

const Song = (() => {
  const S = {
    style: STYLES.house,
    sections: [],
    totalBars: 0,
    menu: false,
  };

  function build(style, opts = {}) {
    S.style = style;
    S.menu = !!opts.menu;
    S.sections = [];
    if (S.menu) {
      S.sections.push({ id: 'menu', type: 'menu', bars: 8, prog: 'menu', start: 0, idx: 0 });
      S.totalBars = 8;
      return;
    }
    const f = style.bpm / 128;
    let start = 0;
    FORM_128.forEach((sec, i) => {
      let bars = Math.max(4, Math.round((sec.bars * f) / 4) * 4);
      const s = Object.assign({}, sec, { bars, start, idx: i });
      S.sections.push(s);
      start += bars;
    });
    S.totalBars = start;
  }

  function sectionAt(bar) {
    const secs = S.sections;
    for (let i = secs.length - 1; i >= 0; i--) if (bar >= secs[i].start) return secs[i];
    return secs[0];
  }
  function byId(id) {
    return S.sections.find((s) => s.id === id);
  }

  // 某小节的和弦
  function chordAt(bar) {
    const sec = sectionAt(bar);
    const prog = S.style.prog[sec.prog] || S.style.prog.main;
    const barIn = bar - sec.start;
    let idx = barIn % prog.length;
    // 铺垫段：和弦每 2 小节换一次（8 小节走完 F F G G 的两遍）
    if (sec.type === 'build') idx = Math.floor((barIn / sec.bars) * prog.length) % prog.length;
    // 尾声最后 4 小节停在主和弦
    if (sec.type === 'outro' && barIn >= sec.bars - 4) idx = prog.length - 1;
    const [deg, q] = prog[idx];
    const key = keyAt(bar);
    return Harmony.chord(key, deg, q);
  }
  function keyAt(bar) {
    const sec = sectionAt(bar);
    return (S.style.key + (sec.key || 0)) % 12;
  }

  // 小节推进：返回下一小节号；-1 表示歌曲结束
  function nextBar(bar, flags) {
    if (S.menu) return (bar + 1) % S.totalBars;
    const sec = sectionAt(bar);
    const barIn = bar - sec.start;
    if (sec.final) {
      // 最终 Boss 已倒：在下一个 4 小节乐句开头进入尾声
      if (flags.outroRequested && barIn % 4 === 3) return byId('outro').start;
      // 打到最后一小节 Boss 还活着：循环最后 8 小节（加时）
      if (barIn === sec.bars - 1) {
        if (!flags.outroRequested) {
          flags.overtime = (flags.overtime || 0) + 1;
          return bar - 7;
        }
        return byId('outro').start;
      }
    }
    if (bar + 1 >= S.totalBars) return -1;
    return bar + 1;
  }

  function barDur() {
    return (60 / S.style.bpm) * 4;
  }

  return { S, build, sectionAt, byId, chordAt, keyAt, nextBar, barDur };
})();
