/**
 * 简化物资：仅两类 — 装备（属性/AC/攻击加值）与消耗品（回复 HP）
 * 与模组剧情可能出现的奖励/搜刮对应；AI 仅可发放本表 id。
 */

export type ItemKind = 'equipment' | 'consumable';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  statBonus?: {
    str?: number;
    dex?: number;
    con?: number;
    int?: number;
    wis?: number;
    cha?: number;
    ac?: number;
    attack?: number;
  };
  healHp?: number;
}

export const ITEMS: ItemDef[] = [
  // —— 开局与基础装备 ——
  { id: 'eq_chain_mail', name: '锁甲', kind: 'equipment', statBonus: { ac: 3 } },
  { id: 'eq_shield', name: '钢盾', kind: 'equipment', statBonus: { ac: 2 } },
  { id: 'eq_longsword', name: '长剑', kind: 'equipment', statBonus: { attack: 3 } },

  // —— 武器替换/副手 ——
  { id: 'eq_rapier', name: '刺剑', kind: 'equipment', statBonus: { attack: 2, dex: 1 } },
  { id: 'eq_dagger', name: '匕首', kind: 'equipment', statBonus: { attack: 1 } },
  { id: 'eq_handaxe', name: '手斧', kind: 'equipment', statBonus: { attack: 2, str: 1 } },

  // —— 护甲与奇物（剧情/搜刮） ——
  { id: 'eq_leather_jerkin', name: '皮背心', kind: 'equipment', statBonus: { ac: 1, dex: 1 } },
  { id: 'eq_cloak_travel', name: '旅行斗篷', kind: 'equipment', statBonus: { dex: 1 } },
  { id: 'eq_ring_protection', name: '防护戒指', kind: 'equipment', statBonus: { ac: 1 } },
  { id: 'eq_amulet_insight', name: '洞悉护符', kind: 'equipment', statBonus: { wis: 1 } },
  { id: 'eq_circlet_negotiator', name: '交涉头环', kind: 'equipment', statBonus: { cha: 1 } },
  { id: 'eq_gloves_sure', name: '稳手手套', kind: 'equipment', statBonus: { dex: 1 } },
  { id: 'eq_boots_quiet', name: '静步靴', kind: 'equipment', statBonus: { dex: 1 } },
  { id: 'eq_belt_ogre', name: '巨力腰带', kind: 'equipment', statBonus: { str: 2 } },
  { id: 'eq_mizzium_charm', name: '米捷护符', kind: 'equipment', statBonus: { int: 1, ac: 1 } },

  // —— 消耗品：治疗 ——
  { id: 'con_healing_salve', name: '治疗软膏', kind: 'consumable', healHp: 10 },
  { id: 'con_rations', name: '干粮', kind: 'consumable', healHp: 5 },
  { id: 'con_strong_spirit', name: '烈酒', kind: 'consumable', healHp: 3 },
  { id: 'con_heroic_draft', name: '强效治疗剂', kind: 'consumable', healHp: 15 },
  { id: 'con_field_meal', name: '行军口粮', kind: 'consumable', healHp: 7 }
];

export const ITEMS_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
