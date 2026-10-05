'use strict';
// 升级三选一 / 宝箱 / Remix 进化

const Upgrades = (() => {
  const MAX_INST = 6;
  const MAX_FX = 4;
  const INST_MAX_LV = 6;
  const FX_MAX_LV = 5;

  function unlockedInst() {
    return INST_ORDER.filter((id) => Meta.isInstUnlocked(id));
  }

  // 所有可选项
  function pool() {
    const out = [];
    const ownedInst = Object.keys(W.inst).length;
    const ownedFx = Object.keys(W.fx).length;
    for (const id of unlockedInst()) {
      if (W.banished[id]) continue;
      const lv = W.inst[id] || 0;
      if (lv === 0 && ownedInst >= MAX_INST) continue;
      if (lv >= INST_MAX_LV) continue;
      out.push({ kind: 'inst', id, lv, w: lv === 0 ? (W.level <= 6 ? 3 : 1.3) : 1.6 });
    }
    for (const id of FX_ORDER) {
      if (W.banished[id]) continue;
      const lv = W.fx[id] || 0;
      if (lv === 0 && ownedFx >= MAX_FX) continue;
      if (lv >= FX_MAX_LV) continue;
      out.push({ kind: 'fx', id, lv, w: lv === 0 ? 0.9 : 1.1 });
    }
    return out;
  }

  function remixable() {
    const out = [];
    for (const id of INST_ORDER) {
      const def = INST[id];
      if ((W.inst[id] || 0) >= INST_MAX_LV && !W.remix[id] && (W.fx[def.remix.fx] || 0) > 0) out.push({ kind: 'remix', id, lv: 6 });
    }
    return out;
  }

  // 三选一（偶尔四选一：律动 II 以上）
  function roll(n = 3) {
    const p = pool();
    const pick = [];
    // 前几级保证至少一个新乐器
    if (W.level <= 5) {
      const fresh = p.filter((o) => o.kind === 'inst' && o.lv === 0);
      if (fresh.length) {
        const f = fresh[Math.floor(Math.random() * fresh.length)];
        pick.push(f);
        p.splice(p.indexOf(f), 1);
      }
    }
    while (pick.length < n && p.length) {
      let tot = 0;
      for (const o of p) tot += o.w;
      let r = Math.random() * tot;
      let idx = 0;
      for (; idx < p.length; idx++) {
        r -= p[idx].w;
        if (r <= 0) break;
      }
      idx = Math.min(idx, p.length - 1);
      pick.push(p[idx]);
      p.splice(idx, 1);
    }
    if (!pick.length) {
      pick.push({ kind: 'heal', id: 'heal' }, { kind: 'notes', id: 'notes' });
    }
    U.shuffle(pick);
    return pick;
  }

  function apply(o) {
    if (o.kind === 'inst') W.addInst(o.id);
    else if (o.kind === 'fx') W.addFx(o.id);
    else if (o.kind === 'remix') {
      W.addRemix(o.id);
      W.flash(0.5, U.hex(INST[o.id].color, 1));
    } else if (o.kind === 'heal') W.heal(40);
    else if (o.kind === 'notes') W.bonusNotes = (W.bonusNotes || 0) + 30;
  }

  // 卡片显示数据
  function card(o) {
    if (o.kind === 'inst') {
      const d = INST[o.id];
      return {
        icon: d.icon, color: d.color, name: d.name, en: d.en,
        tag: o.lv === 0 ? '新乐器' : `Lv ${o.lv} → ${o.lv + 1}`,
        isNew: o.lv === 0,
        desc: o.lv === 0 ? d.desc : d.lv[o.lv],
        sub: o.lv === 0 ? d.lv[0] : '',
        type: '乐器',
        pips: [o.lv, INST_MAX_LV],
      };
    }
    if (o.kind === 'fx') {
      const d = FX[o.id];
      return {
        icon: d.icon, color: d.color, name: d.name, en: d.en,
        tag: o.lv === 0 ? '新效果器' : `Lv ${o.lv} → ${o.lv + 1}`,
        isNew: o.lv === 0,
        desc: d.desc,
        sub: '听觉：' + d.hear,
        type: '效果器',
        pips: [o.lv, FX_MAX_LV],
      };
    }
    if (o.kind === 'remix') {
      const d = INST[o.id];
      return { icon: d.icon, color: d.color, name: d.remix.name, en: 'REMIX · ' + d.remix.en, tag: 'REMIX', isNew: true, desc: d.remix.desc, sub: `${d.name} + ${FX[d.remix.fx].name}`, type: '进化', remix: true, pips: [6, 6] };
    }
    if (o.kind === 'heal') return { icon: '✚', color: '#5cff9d', name: '回血', en: 'HEAL', tag: '', desc: '回复 40 生命', sub: '', type: '补给', pips: null };
    return { icon: '♪', color: '#ffd84a', name: '音符', en: 'NOTES', tag: '', desc: '结算时额外获得 30 ♪', sub: '', type: '补给', pips: null };
  }

  // 宝箱：有 Remix 就必出 Remix，否则 1 / 3 个随机升级
  function chest(big) {
    const rm = remixable();
    if (rm.length) return [rm[Math.floor(Math.random() * rm.length)]];
    const r = Math.random();
    const n = big ? (r < 0.5 ? 3 : 5) : r < 0.75 ? 1 : 3;
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = pool().filter((o) => !out.some((x) => x.kind === o.kind && x.id === o.id));
      // 宝箱只升级已有的
      const owned = p.filter((o) => o.lv > 0);
      const src = owned.length ? owned : p;
      if (!src.length) break;
      out.push(src[Math.floor(Math.random() * src.length)]);
    }
    if (!out.length) out.push({ kind: 'heal', id: 'heal' });
    return out;
  }

  return { roll, apply, card, chest, remixable, MAX_INST, MAX_FX, INST_MAX_LV, FX_MAX_LV };
})();
