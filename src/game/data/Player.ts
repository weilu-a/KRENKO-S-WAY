/**
 * 固定玩家基底属性（无技能、无职业能力）
 * 有效 AC/攻击/属性加值 = 基底 + 装备（见 getEffectiveCombatStats）
 */

import { ITEMS_BY_ID } from './Items';

export const PLAYER = {
  level: 3,
  proficiency: 2,

  str: { value: 16, mod: 3 },
  dex: { value: 12, mod: 1 },
  con: { value: 16, mod: 3 },
  int: { value: 10, mod: 0 },
  wis: { value: 12, mod: 1 },
  cha: { value: 10, mod: 0 },

  hpMax: 37,
  speed: 30,
} as const;

export type PlayerData = typeof PLAYER;

/** 基底攻击加值：力量调整 + 熟练 */
export function getBaseAttackBonus(): number {
  return PLAYER.str.mod + PLAYER.proficiency;
}

/** 合并装备加值 */
export function sumEquippedStatBonus(equippedIds: readonly string[]): {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  ac: number;
  attack: number;
} {
  const acc = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0, ac: 0, attack: 0 };
  for (const id of equippedIds) {
    const def = ITEMS_BY_ID[id];
    if (!def || def.kind !== 'equipment' || !def.statBonus) continue;
    const b = def.statBonus;
    acc.str += b.str ?? 0;
    acc.dex += b.dex ?? 0;
    acc.con += b.con ?? 0;
    acc.int += b.int ?? 0;
    acc.wis += b.wis ?? 0;
    acc.cha += b.cha ?? 0;
    acc.ac += b.ac ?? 0;
    acc.attack += b.attack ?? 0;
  }
  return acc;
}

/** 有效属性调整值（基底 + 装备对属性的加值） */
export function getEffectiveAttributeMod(
  equippedIds: readonly string[],
  key: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'
): number {
  const base = PLAYER[key].mod;
  const bonus = sumEquippedStatBonus(equippedIds);
  return base + bonus[key];
}

/** AC：10 + 敏捷调整 + 装备 AC 加值 */
export function getEffectiveAc(equippedIds: readonly string[]): number {
  const b = sumEquippedStatBonus(equippedIds);
  return 10 + PLAYER.dex.mod + b.ac;
}

/** 攻击加值 */
export function getEffectiveAttackBonus(equippedIds: readonly string[]): number {
  const b = sumEquippedStatBonus(equippedIds);
  return getBaseAttackBonus() + b.attack;
}

export function getWeaponDamageText(): string {
  return `1d8+${PLAYER.str.mod}`;
}
