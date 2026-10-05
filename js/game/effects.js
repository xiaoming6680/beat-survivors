'use strict';
// 效果器 = 被动。作用于整首歌的混音，所以被动也是听得见的。

const FX_ORDER = ['overdrive', 'reverb', 'delay', 'chorus', 'compressor', 'sidechain', 'metronome', 'lfo', 'exciter', 'mastering'];

const FX = {
  overdrive: { id: 'overdrive', name: '失真', en: 'OVERDRIVE', icon: '⚡', color: '#ff5a3c', desc: '所有伤害 +12%', hear: '声音变脏变暖' },
  reverb: { id: 'reverb', name: '混响', en: 'REVERB', icon: '◍', color: '#7aa8ff', desc: '攻击范围 / 弹体大小 +12%', hear: '空间变大' },
  delay: { id: 'delay', name: '延迟', en: 'DELAY', icon: '⟲', color: '#4fe0c8', desc: '20% 概率产生回声攻击（附点八分后重复一次，50% 伤害）', hear: '回声变多' },
  chorus: { id: 'chorus', name: '合唱', en: 'CHORUS', icon: '⧉', color: '#c87aff', desc: '1 / 3 / 5 级：所有乐器弹体 +1；2 / 4 级：伤害 +8%', hear: '声音变宽变厚' },
  compressor: { id: 'compressor', name: '压缩器', en: 'COMPRESSOR', icon: '▣', color: '#9aa0b8', desc: '最大生命 +20，受到伤害 −6%', hear: '混音更紧' },
  sidechain: { id: 'sidechain', name: '侧链', en: 'SIDECHAIN', icon: '⇋', color: '#5cf0ff', desc: '拾取范围 +25%；底鼓会把附近经验往里吸', hear: '泵感加深' },
  metronome: { id: 'metronome', name: '节拍器', en: 'METRONOME', icon: '♩', color: '#ffe066', desc: '完美判定窗口 +12ms，冲刺回复 −10% 时间', hear: '多一个嘀嗒声' },
  lfo: { id: 'lfo', name: '滤波 LFO', en: 'LFO', icon: '∿', color: '#5cff9d', desc: '移动速度 +8%', hear: '滤波器缓慢扫动' },
  exciter: { id: 'exciter', name: '激励器', en: 'EXCITER', icon: '✧', color: '#fff27a', desc: '暴击率 +7%（暴击 2 倍伤害）', hear: '高频更亮' },
  mastering: { id: 'mastering', name: '母带', en: 'MASTERING', icon: '◆', color: '#ffb0e0', desc: '经验获取 +10%，每小节回复 0.3 生命', hear: '整体更响更饱满' },
};
FX_ORDER.forEach((id) => { FX[id].rgb = U.hex(FX[id].color, 1); });

const Effects = {
  // 根据效果器等级、曲风被动、局外强化计算玩家属性
  compute(fx, style, meta) {
    const L = (k) => fx[k] || 0;
    const sp = (style && style.passive) || {};
    const m = meta || {};
    const ch = L('chorus');
    const st = {
      dmg: 1 + 0.12 * L('overdrive') + 0.08 * ((ch >= 2) + (ch >= 4)) + 0.05 * (m.dmg || 0) + (sp.dmg || 0),
      area: 1 + 0.12 * L('reverb') + (sp.area || 0) + 0.05 * (m.area || 0),
      echo: 0.2 * L('delay'),
      extra: (ch >= 1) + (ch >= 3) + (ch >= 5) + (sp.extra || 0),
      maxHp: 100 + 20 * L('compressor') + (sp.maxHp || 0) + 10 * (m.hp || 0),
      armor: 1 - 0.06 * L('compressor') - 0.03 * (m.armor || 0),
      pickup: 95 * (1 + 0.25 * L('sidechain') + 0.15 * (m.pickup || 0)),
      kickPull: L('sidechain') > 0,
      window: 0.07 + 0.012 * L('metronome') + (sp.window || 0),
      dashRech: 1 - 0.1 * L('metronome') - 0.08 * (m.dash || 0),
      speed: 215 * (1 + 0.08 * L('lfo') + (sp.speed || 0) + 0.04 * (m.speed || 0)),
      crit: 0.07 * L('exciter'),
      xp: 1 + 0.1 * L('mastering') + 0.05 * (m.xp || 0),
      dashMax: 2 + (sp.dash || 0),
      regen: (sp.regen || 0) + 0.3 * L('mastering'),
      grooveDecay: sp.grooveDecay || 1,
    };
    return st;
  },
};
